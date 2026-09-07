"""Authenticate an administrator-selected release before any archive extraction."""

import os, json, tarfile, stat, tempfile, shutil, hashlib, platform
from pathlib import PurePosixPath
from common import digest
from config import BASE, DIGEST, trusted

MAX_BYTES = 2 * 1024**3
MAX_FILES = 250000


def relative(value):
    p = PurePosixPath(value)
    if not value or p.is_absolute() or ".." in p.parts or str(p) != value:
        raise ValueError("Unsafe release entry")
    return value


def verify(root, expected=None):
    trusted(root)
    with open(root + "/release.json") as stream:
        m = json.load(stream)
    artifact = m.pop("artifact", None)
    calculated = hashlib.sha256(
        json.dumps(m, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    m["artifact"] = artifact
    if artifact != calculated or expected and artifact != expected:
        raise ValueError("Release identity mismatch")
    if (
        m["format"] != 1
        or m["architecture"] != platform.machine()
        or m["node"] != "24.11.1"
        or m["restic"] != "0.19.1"
        or m["codex"] != "0.153.4"
    ):
        raise ValueError("Unsupported release compatibility")
    if len(m["files"]) > MAX_FILES:
        raise ValueError("Release inventory limit")
    seen = set()
    for base, dirs, names in os.walk(root, followlinks=False):
        for name in dirs + names:
            p = base + "/" + name
            rel = os.path.relpath(p, root)
            s = os.lstat(p)
            if s.st_uid != 0 or (not stat.S_ISLNK(s.st_mode) and s.st_mode & 0o022):
                raise ValueError("Mutable or unowned release path")
            if stat.S_ISDIR(s.st_mode):
                continue
            if rel == "release.json":
                continue
            item = m["files"].get(rel)
            if item is None:
                raise ValueError("Unmanifested release file")
            seen.add(rel)
            if "link" in item:
                if (
                    not stat.S_ISLNK(s.st_mode)
                    or os.readlink(p) != item["link"]
                    or os.path.commonpath([root, os.path.realpath(p)]) != root
                ):
                    raise ValueError("Release symlink mismatch")
            elif (
                not stat.S_ISREG(s.st_mode)
                or s.st_nlink != 1
                or s.st_size != item["size"]
                or digest(p) != item["sha256"]
                or bool(s.st_mode & 0o111) != item["executable"]
            ):
                raise ValueError("Release content mismatch")
    if seen != set(m["files"]):
        raise ValueError("Incomplete release inventory")
    return m


def install(archive, sha256):
    if os.stat(archive).st_size > MAX_BYTES + MAX_FILES * 2048:
        raise ValueError("Release archive byte bound")
    if not DIGEST.fullmatch(sha256) or digest(archive) != sha256:
        raise ValueError("Administrator artifact digest mismatch")
    # The archive hash is the authority; extraction still refuses links as parents,
    # devices, hardlinks, ownership, xattrs and archive-selected absolute locations.
    os.makedirs(BASE + "/releases", mode=0o755, exist_ok=True)
    trusted(BASE + "/releases")
    with tempfile.TemporaryDirectory(
        prefix=".install-", dir=BASE + "/releases"
    ) as staging:
        with tarfile.open(archive, "r:") as tar:
            entries = {}
            total = 0
            for entry in tar:
                total += entry.size
                if len(entries) >= MAX_FILES or total > MAX_BYTES:
                    raise ValueError("Release extraction bound")
                name = relative(entry.name)
                if name != "payload" and not name.startswith("payload/"):
                    raise ValueError("Invalid release root")
                if name in entries or not (
                    entry.isdir() or entry.isfile() or entry.issym()
                ):
                    raise ValueError("Unsupported or duplicate release member")
                entries[name] = entry
            for name, entry in entries.items():
                parent = PurePosixPath(name).parent
                while str(parent) != ".":
                    if str(parent) not in entries or not entries[str(parent)].isdir():
                        raise ValueError("Unsafe release parent")
                    parent = parent.parent
                if entry.issym():
                    target = os.path.normpath(
                        os.path.join(os.path.dirname(name), entry.linkname)
                    )
                    if os.path.isabs(entry.linkname) or not target.startswith(
                        "payload/"
                    ):
                        raise ValueError("Escaping release link")
            for name, entry in sorted(
                entries.items(), key=lambda pair: len(PurePosixPath(pair[0]).parts)
            ):
                target = staging + "/" + name
                if entry.isdir():
                    os.mkdir(target, 0o755)
                elif entry.isfile():
                    fd = os.open(
                        target,
                        os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                        0o755 if entry.mode & 0o111 else 0o644,
                    )
                    with os.fdopen(fd, "wb") as dest, tar.extractfile(entry) as source:
                        shutil.copyfileobj(source, dest)
                        dest.flush()
                        os.fsync(dest.fileno())
                else:
                    os.symlink(entry.linkname, target)
        payload = staging + "/payload"
        manifest = verify(payload)
        destination = BASE + "/releases/" + manifest["artifact"]
        if os.path.exists(destination):
            verify(destination, manifest["artifact"])
            return destination, manifest
        # Files are immutable to all services, including the API. Administrator root is
        # trusted; this does not pretend chmod constrains the administrator itself.
        for base, dirs, names in os.walk(payload, topdown=False, followlinks=False):
            for name in names:
                p = base + "/" + name
                if not os.path.islink(p):
                    os.chmod(p, 0o555 if os.stat(p).st_mode & 0o111 else 0o444)
            os.chmod(base, 0o555)
            fd = os.open(base, os.O_DIRECTORY)
            os.fsync(fd)
            os.close(fd)
        os.rename(payload, destination)
        fd = os.open(BASE + "/releases", os.O_DIRECTORY)
        os.fsync(fd)
        os.close(fd)
        return destination, manifest
