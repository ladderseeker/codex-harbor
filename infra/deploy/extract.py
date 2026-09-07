"""Reconstruct authenticated ordinary data; snapshot paths never become host authority."""

import os, json, stat, time, hashlib, re, subprocess, tempfile
from pathlib import PurePosixPath
from config import DIGEST
from common import digest
from backup import restic

from bounds import MAX_FILES, MAX_BYTES, MAX_FILE_BYTES


def safe(path):
    p = PurePosixPath(path)
    if not path.startswith("/") or str(p) != path or ".." in p.parts or "\x00" in path:
        raise ValueError("Unsafe snapshot path")
    return path


def extract(c, release, snapshot, expected_registry, destination, verify_only=False):
    if not DIGEST.fullmatch(snapshot) or not DIGEST.fullmatch(expected_registry):
        raise ValueError("Authenticated checkpoint identities required")
    if not verify_only and os.listdir(destination):
        raise ValueError("Fresh restore staging required")
    deadline = time.monotonic() + 1800
    listing = [
        json.loads(line)
        for line in restic(
            c, release, ["ls", "--json", snapshot], capture_limit=64 * 1024 * 1024
        ).splitlines()
        if line
    ]
    headers = [x for x in listing if x.get("struct_type") == "snapshot"]
    if len(headers) != 1 or headers[0]["id"] != snapshot:
        raise ValueError("Snapshot identity mismatch")
    nodes = {}
    for item in listing:
        if item.get("struct_type") != "node":
            continue
        path = safe(item["path"])
        if path in nodes or item["type"] not in ["file", "dir", "symlink"]:
            raise ValueError("Unsupported snapshot inode")
        nodes[path] = item
    if len(nodes) > MAX_FILES:
        raise ValueError("Snapshot inode bound")
    # Only a dedicated top-level backup source may identify the checkpoint
    # registry. Ordinary project/native descendants may share this filename.
    source_paths = headers[0].get("paths")
    if not isinstance(source_paths, list) or not all(
        isinstance(p, str) for p in source_paths
    ):
        raise ValueError("Snapshot source inventory unavailable")
    candidates = [
        safe(p)
        for p in source_paths
        if p.endswith("/registry.json") and nodes.get(p, {}).get("type") == "file"
    ]
    if len(candidates) != 1:
        raise ValueError("Unique checkpoint registry required")
    registry_bytes = restic(c, release, ["dump", snapshot, candidates[0]]).encode()
    if hashlib.sha256(registry_bytes).hexdigest() != expected_registry:
        raise ValueError("Checkpoint registry authentication failed")
    registry = json.loads(registry_bytes)
    if registry.get("format") != 1 or registry.get("backupSchema") != 1:
        raise ValueError("Unsupported checkpoint schema")
    expected = {}
    total = 0
    for unit in registry["units"]:
        base = safe(unit["path"])
        for relative, item in unit["inventory"]["files"].items():
            if relative != "." and (
                str(PurePosixPath(relative)) != relative
                or PurePosixPath(relative).is_absolute()
                or ".." in PurePosixPath(relative).parts
            ):
                raise ValueError("Unsafe registry relative path")
            path = base if relative == "." else base + "/" + relative
            if path in expected:
                raise ValueError("Overlapping registry units")
            expected[path] = item
    dump = registry["dump"]
    expected[safe(dump["path"])] = {
        "type": "file",
        "size": dump["size"],
        "sha256": dump["sha256"],
        "mode": 0o600,
    }
    expected[candidates[0]] = {
        "type": "file",
        "size": len(registry_bytes),
        "sha256": expected_registry,
        "mode": 0o600,
    }
    ancestors = set()
    for path, item in expected.items():
        parent = PurePosixPath(path).parent
        while str(parent) != "/":
            ancestors.add(str(parent))
            parent = parent.parent
        actual = nodes.get(path)
        if not actual or actual["type"] != {
            "directory": "dir",
            "file": "file",
            "symlink": "symlink",
        }.get(item["type"]):
            raise ValueError("Missing registry inode")
        if item["type"] == "file":
            if (
                not isinstance(item["size"], int)
                or item["size"] < 0
                or item["size"] > MAX_FILE_BYTES
                or actual.get("size") != item["size"]
                or not DIGEST.fullmatch(item["sha256"])
            ):
                raise ValueError("Registry file mismatch")
            total += item["size"]
        if item["type"] == "symlink" and (
            not isinstance(item.get("target"), str)
            or len(item["target"]) > 4096
            or "\x00" in item["target"]
        ):
            raise ValueError("Invalid symlink target")
    if total > MAX_BYTES or len(expected) > MAX_FILES:
        raise ValueError("Restore byte/inode bound")
    for path, item in nodes.items():
        if path not in expected and not (path in ancestors and item["type"] == "dir"):
            raise ValueError("Unregistered snapshot content")
    # `ls --json` in pinned Restic 0.19.1 omits symlink targets. Read the
    # authenticated parent tree instead; never interpret a target as a host path.
    link_parents = {}
    for path, item in expected.items():
        if item["type"] == "symlink":
            link_parents.setdefault(str(PurePosixPath(path).parent), []).append(path)
    for parent, paths in link_parents.items():
        if time.monotonic() > deadline:
            raise ValueError("Snapshot verification deadline exceeded")
        tree = json.loads(
            restic(
                c,
                release,
                ["cat", "tree", snapshot + ":" + parent],
                timeout=30,
                capture_limit=64 * 1024 * 1024,
            )
        )
        entries = tree.get("nodes")
        if not isinstance(entries, list) or len(entries) > MAX_FILES:
            raise ValueError("Invalid authenticated tree")
        by_name = {}
        for entry in entries:
            name = entry.get("name")
            if not isinstance(name, str) or name in by_name:
                raise ValueError("Invalid authenticated tree entry")
            by_name[name] = entry
        for path in paths:
            entry = by_name.get(PurePosixPath(path).name, {})
            if (
                entry.get("type") != "symlink"
                or entry.get("linktarget") != expected[path]["target"]
            ):
                raise ValueError("Snapshot symlink mismatch")
    if verify_only:
        for path, item in expected.items():
            if time.monotonic() > deadline:
                raise ValueError("Snapshot verification deadline exceeded")
            if item["type"] != "file":
                continue
            with tempfile.TemporaryFile() as stream:
                restic(
                    c,
                    release,
                    ["dump", snapshot, path],
                    timeout=30,
                    output=stream,
                    output_limit=item["size"],
                )
                if stream.tell() != item["size"]:
                    raise ValueError("Snapshot content size mismatch")
                stream.seek(0)
                actual_hash = hashlib.sha256()
                while chunk := stream.read(1048576):
                    actual_hash.update(chunk)
                if actual_hash.hexdigest() != item["sha256"]:
                    raise ValueError("Snapshot content mismatch")
        return registry
    root = os.open(destination, os.O_DIRECTORY | os.O_NOFOLLOW)

    def parentfd(path):
        parts = PurePosixPath(path).parts[1:]
        fd = os.dup(root)
        try:
            for part in parts[:-1]:
                try:
                    os.mkdir(part, 0o700, dir_fd=fd)
                except FileExistsError:
                    pass
                nxt = os.open(part, os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                os.close(fd)
                fd = nxt
            return fd, parts[-1]
        except:
            os.close(fd)
            raise

    try:
        for path, item in sorted(
            expected.items(),
            key=lambda pair: (len(PurePosixPath(pair[0]).parts), pair[0]),
        ):
            if time.monotonic() > deadline:
                raise ValueError("Restore deadline exceeded")
            if item["type"] == "symlink":
                continue
            fd, name = parentfd(path)
            try:
                if item["type"] == "directory":
                    try:
                        os.mkdir(name, 0o700, dir_fd=fd)
                    except FileExistsError:
                        check = os.open(name, os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                        os.close(check)
                else:
                    # The Restic subprocess receives no destination path. The trusted parent owns
                    # this exact no-follow file descriptor and checks the returned content.
                    output = os.open(
                        name,
                        os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                        0o600,
                        dir_fd=fd,
                    )
                    try:
                        with os.fdopen(os.dup(output), "wb") as stream:
                            restic(
                                c,
                                release,
                                ["dump", snapshot, path],
                                timeout=30,
                                output=stream,
                                output_limit=item["size"],
                            )
                        if os.fstat(output).st_size != item["size"]:
                            raise ValueError("Restored content size mismatch")
                        os.lseek(output, 0, os.SEEK_SET)
                        hash = hashlib.sha256()
                        while chunk := os.read(output, 1048576):
                            hash.update(chunk)
                        if hash.hexdigest() != item["sha256"]:
                            raise ValueError("Restored content mismatch")
                        os.fsync(output)
                    finally:
                        os.close(output)
            finally:
                os.close(fd)
        for path, item in expected.items():
            if item["type"] == "symlink":
                fd, name = parentfd(path)
                try:
                    os.symlink(item["target"], name, dir_fd=fd)
                finally:
                    os.close(fd)
        os.fsync(root)
    finally:
        os.close(root)
    return registry
