"""Sanitized Git plumbing and exact selected-index publication inside the helper."""

import os, sys, stat, json, hashlib, subprocess, shutil, tempfile, re, difflib, selectors, time

H = None
ENV = {
    "PATH": "/usr/bin:/bin",
    "HOME": "/tmp",
    "GIT_CONFIG_NOSYSTEM": "1",
    "GIT_CONFIG_GLOBAL": "/dev/null",
    "GIT_TERMINAL_PROMPT": "0",
    "GIT_ATTR_NOSYSTEM": "1",
    "GIT_LITERAL_PATHSPECS": "1",
    "GIT_OPTIONAL_LOCKS": "0",
    "LC_ALL": "C",
}
OPTIONS = {
    "core.hooksPath": "/dev/null",
    "core.fsmonitor": "false",
    "core.pager": "cat",
    "core.sshCommand": "false",
    "credential.helper": "",
    "maintenance.auto": "false",
    "gc.auto": "0",
    "protocol.allow": "never",
    "core.bare": "false",
    "core.quotePath": "true",
    "diff.external": "",
    "filter.lfs.required": "false",
}
ENV["GIT_CONFIG_COUNT"] = str(len(OPTIONS))
for i, (k, v) in enumerate(OPTIONS.items()):
    ENV["GIT_CONFIG_KEY_" + str(i)] = k
    ENV["GIT_CONFIG_VALUE_" + str(i)] = v


def read_at(fd, name, limit=16777216, optional=False):
    try:
        f = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
    except FileNotFoundError:
        if optional:
            return None
        raise
    try:
        s = os.fstat(f)
        if not stat.S_ISREG(s.st_mode) or s.st_nlink != 1 or s.st_size > limit:
            H.fail("GIT_METADATA")
        chunks = []
        n = 0
        while True:
            b = os.read(f, 65536)
            if not b:
                break
            n += len(b)
            if n > limit:
                H.fail("GIT_METADATA_LIMIT")
            chunks.append(b)
        if H.metadata(s) != H.metadata(os.fstat(f)):
            H.fail("GIT_CHANGED")
        return b"".join(chunks)
    finally:
        os.close(f)


def copy_metadata(fd, dest, depth=0, counter=None):
    counter = counter if counter is not None else [0, 0]
    if depth > 32:
        H.fail("GIT_METADATA_LIMIT")
    for name in H.names(fd):
        counter[0] += 1
        if counter[0] > 10000:
            H.fail("GIT_METADATA_LIMIT")
        info = os.stat(name, dir_fd=fd, follow_symlinks=False)
        if stat.S_ISLNK(info.st_mode):
            H.fail("GIT_METADATA")
        if stat.S_ISDIR(info.st_mode):
            child = os.open(
                name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd
            )
            try:
                os.mkdir(os.path.join(dest, name))
                copy_metadata(child, os.path.join(dest, name), depth + 1, counter)
            finally:
                os.close(child)
        elif stat.S_ISREG(info.st_mode):
            data = read_at(fd, name)
            counter[1] += len(data)
            if counter[1] > 16777216:
                H.fail("GIT_METADATA_LIMIT")
            with open(os.path.join(dest, name), "xb") as out:
                out.write(data)
        else:
            H.fail("GIT_METADATA")


def setup():
    root = H.directory([])
    try:
        info = os.stat(b".git", dir_fd=root, follow_symlinks=False)
        if stat.S_ISDIR(info.st_mode):
            common = os.open(
                b".git", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=root
            )
            admin = os.dup(common)
        elif stat.S_ISREG(info.st_mode):
            value = read_at(root, b".git", 512).strip()
            prefix = b"gitdir: /git-common/worktrees/"
            if not value.startswith(prefix):
                H.fail("GIT_EXTERNAL_METADATA")
            name = value[len(prefix) :]
            if not re.fullmatch(b"[A-Za-z0-9_-]{1,128}", name):
                H.fail("GIT_EXTERNAL_METADATA")
            common = os.open(
                "/git-common", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
            )
            worktrees = os.open(
                b"worktrees",
                os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                dir_fd=common,
            )
            try:
                admin = os.open(
                    name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=worktrees
                )
            finally:
                os.close(worktrees)
            if read_at(admin, b"commondir", 512).strip() != b"../..":
                H.fail("GIT_EXTERNAL_METADATA")
        else:
            H.fail("GIT_METADATA")
    finally:
        os.close(root)
    view = b"/tmp/file-git-view"
    if os.path.exists(view):
        shutil.rmtree(view)
    os.mkdir(view)
    # Pin metadata directories with inherited descriptors; no project configuration is loaded.
    objects = os.open(
        b"objects", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=common
    )
    try:
        inf = os.open(
            b"info", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=objects
        )
        try:
            if read_at(inf, b"alternates", 4096, True):
                H.fail("GIT_ALTERNATES")
        finally:
            os.close(inf)
    except FileNotFoundError:
        pass
    # Descriptors are deliberately inherited by fixed Git subprocesses only.
    for fd in [common, admin, objects]:
        os.set_inheritable(fd, True)
    os.symlink(os.fsencode("/proc/self/fd/" + str(objects)), view + b"/objects")
    refs = os.open(b"refs", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=common)
    try:
        os.mkdir(view + b"/refs")
        copy_metadata(refs, view + b"/refs")
    finally:
        os.close(refs)
    for name, parent in [
        (b"HEAD", admin),
        (b"index", admin),
        (b"packed-refs", common),
        (b"shallow", common),
    ]:
        data = read_at(parent, name, optional=True)
        if data is not None:
            with open(view + b"/" + name, "wb") as out:
                out.write(data)
    with open(view + b"/config", "wb") as out:
        out.write(
            b"[core]\nrepositoryformatversion = 0\nbare = false\nhooksPath = /dev/null\n"
        )
    return common, admin, objects


# Popen closes all other descriptors; the only passed descriptors are selected metadata.
FDS = ()


def git(*args, data=None, allow=False, env=None, max_output=2097152):
    p = subprocess.Popen(
        ["git", "--git-dir=/tmp/file-git-view", "--work-tree=/workspace", *args],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=dict(ENV, **(env or {})),
        pass_fds=FDS,
    )
    selector = selectors.DefaultSelector()
    out = []
    outBytes = 0
    errBytes = 0
    pending = memoryview(data or b"")
    offset = 0
    deadline = time.monotonic() + 20
    try:
        for stream in [p.stdin, p.stdout, p.stderr]:
            os.set_blocking(stream.fileno(), False)
        selector.register(p.stdout, selectors.EVENT_READ)
        selector.register(p.stderr, selectors.EVENT_READ)
        if len(pending):
            selector.register(p.stdin, selectors.EVENT_WRITE)
        else:
            p.stdin.close()
        while selector.get_map():
            if time.monotonic() > deadline:
                H.fail("GIT_TIMEOUT")
            for key, events in selector.select(0.1):
                stream = key.fileobj
                if stream == p.stdin:
                    try:
                        offset += os.write(
                            stream.fileno(), pending[offset : offset + 65536]
                        )
                    except BrokenPipeError:
                        offset = len(pending)
                    if offset == len(pending):
                        selector.unregister(stream)
                        stream.close()
                else:
                    chunk = os.read(stream.fileno(), 65536)
                    if not chunk:
                        selector.unregister(stream)
                        stream.close()
                        continue
                    if stream == p.stdout:
                        outBytes += len(chunk)
                        if outBytes > max_output:
                            H.fail("GIT_OUTPUT_LIMIT")
                        out.append(chunk)
                    else:
                        errBytes += len(chunk)
                        if errBytes > 65536:
                            H.fail("GIT_OUTPUT_LIMIT")
        p.wait(timeout=max(0.01, deadline - time.monotonic()))
        if p.returncode and not allow:
            H.fail("GIT_UNAVAILABLE")
        return b"".join(out)
    finally:
        selector.close()
        if p.poll() is None:
            p.kill()
            p.wait()
        for stream in [p.stdin, p.stdout, p.stderr]:
            stream.close()


def head_state():
    raw = open("/tmp/file-git-view/HEAD", "rb").read(1024).strip()
    if raw.startswith(b"ref: "):
        ref = raw[5:]
        if not re.fullmatch(b"refs/heads/[A-Za-z0-9_./-]{1,200}", ref) or any(
            p in [b"", b".", b".."] for p in ref.split(b"/")
        ):
            H.fail("GIT_REF")
        target = ref.decode()
    else:
        if not re.fullmatch(b"[a-f0-9]{40}", raw):
            H.fail("GIT_HEAD")
        target = "HEAD"
    oid = git("rev-parse", "--verify", "HEAD", allow=True).strip().decode()
    if oid and not re.fullmatch("[a-f0-9]{40}", oid):
        H.fail("GIT_HEAD")
    return {"target": target, "oid": oid or None, "headBytes": raw.decode()}


def status():
    head = head_state()
    index = read_at(FDS[1], b"index", optional=True) or b""
    raw = git(
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
        "--ignore-submodules=none",
    )
    fields = raw.split(b"\0")
    entries = []
    complete = True
    i = 0
    while i < len(fields) and fields[i]:
        if len(entries) >= 10000:
            complete = False
            break
        item = fields[i]
        i += 1
        xy = item[:2].decode("ascii")
        name = item[3:]
        source = None
        if "R" in xy or "C" in xy:
            source = fields[i]
            i += 1
        parts = H.parts_for(H.ref_for(name.split(b"/")))
        info = {
            "ref": H.ref_for(parts),
            "path": H.label(name),
            "index": xy[0],
            "worktree": xy[1],
            "conflict": xy in ["DD", "AU", "UD", "UA", "DU", "AA", "UU"],
        }
        if source:
            info["renameFrom"] = H.ref_for(source.split(b"/"))
        try:
            data, revision, s = H.read(parts, H.DOWNLOAD)
            info.update(
                fileRevision=revision,
                sha256=H.digest(data),
                size=len(data),
                mode=oct(s.st_mode & 0o777),
            )
        except FileNotFoundError:
            info["fileRevision"] = "missing"
        except H.Denied as e:
            info["unavailable"] = e.code
        except OSError:
            info["unavailable"] = "FILE_KIND"
        entries.append(info)
    result = {
        "head": head,
        "indexRevision": H.digest(index),
        "entries": entries,
        "complete": complete,
    }
    result["revision"] = H.digest(
        json.dumps(result, sort_keys=True, separators=(",", ":")).encode()
    )
    return result


def versioned_blob(name, tree=None):
    # Missing path is established from an exact, NUL-delimited index/tree entry.
    # A missing/corrupt object after that is an error, never an empty file.
    rows = (
        git("ls-tree", "-z", tree, "--", os.fsdecode(name))
        if tree
        else git("ls-files", "--stage", "-z", "--", os.fsdecode(name))
    )
    exact = [
        row for row in rows.split(b"\0") if row and row.split(b"\t", 1)[-1] == name
    ]
    if not exact:
        return b"", None
    if len(exact) != 1:
        H.fail("GIT_CONFLICT")
    fields = exact[0].split(b"\t", 1)[0].split()
    mode, oid = fields[0], fields[2] if tree else fields[1]
    if mode not in [b"100644", b"100755"] or (not tree and fields[2] != b"0"):
        H.fail("GIT_UNSUPPORTED_MODE")
    data = git("cat-file", "blob", oid.decode(), max_output=H.DOWNLOAD)
    if (
        hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data)
        .hexdigest()
        .encode()
        != oid
    ):
        H.fail("GIT_OBJECT_CHANGED")
    return data, mode.decode()


def diff(payload, snapshot):
    ref = payload["ref"]
    parts = H.parts_for(ref)
    name = b"/".join(parts)
    side = payload.get("side", "unstaged")
    if side not in ["staged", "unstaged"]:
        H.fail("GIT_SIDE")
    entry = next((e for e in snapshot["entries"] if e["ref"] == ref), None)
    if not entry:
        H.fail("GIT_CHANGED")
    if entry.get("unavailable"):
        return {
            "status": "unavailable",
            "reason": entry["unavailable"],
            "ref": ref,
            "revision": snapshot["revision"],
            "hunks": [],
        }
    if entry["conflict"]:
        return {
            "status": "conflict",
            "ref": ref,
            "revision": snapshot["revision"],
            "hunks": [],
        }
    if side == "staged":
        oldName = (
            b"/".join(H.parts_for(entry["renameFrom"]))
            if entry.get("renameFrom")
            else name
        )
        old, oldMode = (
            versioned_blob(oldName, snapshot["head"]["oid"])
            if snapshot["head"]["oid"]
            else (b"", None)
        )
        new, newMode = versioned_blob(name)
    else:
        old, oldMode = versioned_blob(name)
        try:
            new, _, info = H.read(parts, H.DOWNLOAD)
            newMode = "100755" if info.st_mode & 0o111 else "100644"
        except FileNotFoundError:
            new, newMode = b"", None
    result = {
        "ref": ref,
        "revision": snapshot["revision"],
        "side": side,
        "oldMode": oldMode,
        "newMode": newMode,
        "wholeFileOnly": bool(entry.get("renameFrom"))
        or (oldMode is not None and newMode is not None and oldMode != newMode),
        "oldSha256": H.digest(old),
        "newSha256": H.digest(new),
        "hunks": [],
        "oldText": None,
        "newText": None,
        "status": "text",
    }
    if len(old) > H.TEXT or len(new) > H.TEXT:
        result["status"] = "oversized"
        return result
    try:
        a = old.decode("utf-8")
        b = new.decode("utf-8")
        if "\0" in a or "\0" in b:
            raise ValueError()
    except (UnicodeDecodeError, ValueError):
        result["status"] = "binary"
        return result
    result["oldText"] = a
    result["newText"] = b
    lines = []
    for line in difflib.unified_diff(a.splitlines(True), b.splitlines(True), n=3):
        if not line.endswith("\n"):
            lines.extend([line + "\n", "\\ No newline at end of file\n"])
        else:
            lines.append(line)
    if len(lines) > 20000 or sum(len(x.encode()) for x in lines) > H.TEXT:
        H.fail("GIT_DIFF_LIMIT")
    blocks = []
    for line in lines[2:]:
        if line.startswith("@@"):
            blocks.append([])
        if blocks:
            blocks[-1].append(line)
    for block in blocks:
        value = "".join(block)
        result["hunks"].append(
            {
                "id": H.digest((snapshot["revision"] + ref + side + value).encode()),
                "text": value,
            }
        )
    if len(result["hunks"]) > 2000:
        H.fail("GIT_DIFF_LIMIT")
    return result


def verify_objects(result):
    stack = [(result["tree"], "tree", 0)]
    seen = set()
    total = 0
    for key in ["commitOid", "parent"]:
        if result.get(key):
            stack.append((result[key], "commit", 0))
    while stack:
        oid, kind, depth = stack.pop()
        if oid in seen:
            continue
        if not re.fullmatch("[a-f0-9]{40}", oid) or depth > 32 or len(seen) >= 10000:
            H.fail("GIT_OBJECT_LIMIT")
        seen.add(oid)
        size = git("cat-file", "-s", oid).strip()
        if not size.isdigit() or int(size) > min(16777216, 33554432 - total):
            H.fail("GIT_OBJECT_LIMIT")
        if git("cat-file", "-t", oid).strip().decode() != kind:
            H.fail("GIT_OBJECT_INVALID")
        data = git("cat-file", kind, oid, max_output=16777216)
        total += len(data)
        if (
            hashlib.sha1(
                (kind + " " + str(len(data))).encode() + b"\0" + data
            ).hexdigest()
            != oid
        ):
            H.fail("GIT_OBJECT_INVALID")
        if kind == "tree":
            at = 0
            while at < len(data):
                split = data.find(b" ", at)
                end = data.find(b"\0", split + 1)
                if split < 0 or end < 0 or end + 21 > len(data):
                    H.fail("GIT_OBJECT_INVALID")
                mode = data[at:split]
                name = data[split + 1 : end]
                if not name or name in [b".", b".."] or b"/" in name:
                    H.fail("GIT_OBJECT_INVALID")
                childKind = (
                    "tree"
                    if mode == b"40000"
                    else "blob" if mode in [b"100644", b"100755", b"120000"] else None
                )
                if childKind is None:
                    H.fail("GIT_UNSUPPORTED_OBJECT")
                stack.append((data[end + 1 : end + 21].hex(), childKind, depth + 1))
                at = end + 21
    return {"objects": len(seen), "bytes": total}


def publish_index(data, expected):
    admin = FDS[1]
    fd = os.open(
        b"index.lock",
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
        0o600,
        dir_fd=admin,
    )
    try:
        if H.digest(read_at(admin, b"index", optional=True) or b"") != expected:
            H.fail("GIT_CHANGED")
        at = 0
        while at < len(data):
            at += os.write(fd, data[at:])
        os.fsync(fd)
        os.rename(b"index.lock", b"index", src_dir_fd=admin, dst_dir_fd=admin)
        os.fsync(admin)
    finally:
        os.close(fd)
        try:
            os.unlink(b"index.lock", dir_fd=admin)
        except FileNotFoundError:
            pass


def stage(payload, snapshot, reverse=False):
    if payload.get("expectedRevision") != snapshot["revision"]:
        H.fail("GIT_STALE")
    selections = payload.get("selections")
    if not isinstance(selections, list) or not 1 <= len(selections) <= 100:
        H.fail("GIT_SELECTION")
    seen = set()
    total = 0
    for selection in selections:
        ref = selection["ref"]
        if ref in seen:
            H.fail("GIT_SELECTION")
        seen.add(ref)
        parts = H.parts_for(ref)
        name = b"/".join(parts)
        entry = next((e for e in snapshot["entries"] if e["ref"] == ref), None)
        if not entry or entry["conflict"] or entry.get("unavailable"):
            H.fail("GIT_SELECTION")
        if entry.get("renameFrom") and not selection.get("wholeFile"):
            H.fail("GIT_RENAME_WHOLE")
        if selection.get("wholeFile"):
            paths = [name]
            if reverse and entry.get("renameFrom"):
                paths.append(b"/".join(H.parts_for(entry["renameFrom"])))
            for selectedName in paths:
                if reverse:
                    row = (
                        git(
                            "ls-tree",
                            snapshot["head"]["oid"],
                            "--",
                            os.fsdecode(selectedName),
                        )
                        if snapshot["head"]["oid"]
                        else b""
                    )
                    exists = bool(row)
                    data = (
                        git(
                            "show",
                            snapshot["head"]["oid"] + ":" + os.fsdecode(selectedName),
                        )
                        if exists
                        else b""
                    )
                else:
                    try:
                        data, _, s = H.read(selectedName.split(b"/"), H.DOWNLOAD)
                        exists = True
                    except FileNotFoundError:
                        data = b""
                        exists = False
                total += len(data)
                if total > 2097152:
                    H.fail("GIT_SELECTION_LIMIT")
                if exists:
                    oid = git("hash-object", "-w", "--stdin", data=data).strip()
                    mode = b"100755" if not reverse and s.st_mode & 0o111 else b"100644"
                    if reverse:
                        mode = row.split(b" ", 1)[0]
                    if mode not in [b"100644", b"100755"]:
                        H.fail("GIT_SELECTION")
                    git(
                        "update-index",
                        "--add",
                        "--cacheinfo",
                        mode.decode(),
                        oid.decode(),
                        os.fsdecode(selectedName),
                    )
                else:
                    git(
                        "update-index",
                        "--force-remove",
                        "--",
                        os.fsdecode(selectedName),
                    )
        else:
            d = diff(dict(ref=ref, side="staged" if reverse else "unstaged"), snapshot)
            if d["status"] != "text" or d["wholeFileOnly"]:
                H.fail("GIT_SELECTION")
            ids = selection.get("hunkIds", [])
            chosen = [h for h in d["hunks"] if h["id"] in ids]
            if not ids or len(chosen) != len(set(ids)) or len(ids) != len(set(ids)):
                H.fail("GIT_SELECTION")
            # Fixed quoted patch paths preserve exact bytes, never command syntax.
            quoted = (
                lambda prefix: '"'
                + "".join(
                    chr(c) if 32 <= c < 127 and c not in [34, 92] else "\\%03o" % c
                    for c in prefix.encode() + name
                )
                + '"'
            )
            oldPath = (
                "/dev/null"
                if not d["oldText"]
                and (entry["index"] in ["A", "?"] if reverse else entry["index"] == "?")
                else quoted("a/")
            )
            newPath = (
                "/dev/null"
                if (entry["index"] == "D" if reverse else entry["worktree"] == "D")
                else quoted("b/")
            )
            patch = (
                "--- "
                + oldPath
                + "\n+++ "
                + newPath
                + "\n"
                + "".join(h["text"] for h in chosen)
            )
            total += len(patch.encode())
            if total > 2097152:
                H.fail("GIT_SELECTION_LIMIT")
            git(
                "apply",
                "--cached",
                "--whitespace=nowarn",
                *(["--reverse"] if reverse else []),
                "-",
                data=patch.encode()
            )
    tree = git("write-tree").strip().decode()
    data = open("/tmp/file-git-view/index", "rb").read()
    result = {
        "indexRevision": H.digest(data),
        "tree": tree,
        "selectedRefs": sorted(seen),
    }
    verify_objects(result)
    H.publication(result)
    publish_index(data, snapshot["indexRevision"])
    return result


def commit(payload, snapshot):
    if payload.get("expectedRevision") != snapshot["revision"]:
        H.fail("GIT_STALE")
    staged = [e["ref"] for e in snapshot["entries"] if e["index"] not in [" ", "?"]]
    if not staged or sorted(payload.get("selectedRefs", [])) != sorted(staged):
        H.fail("GIT_COMPLETE_REVIEW")
    if any(e["conflict"] for e in snapshot["entries"]):
        H.fail("GIT_CONFLICT")
    message = payload.get("message")
    author = payload.get("author", {})
    when = payload.get("timestamp")
    if (
        not isinstance(message, str)
        or not message.strip()
        or len(message.encode()) > 8192
        or "\0" in message
    ):
        H.fail("GIT_MESSAGE")
    if not re.fullmatch(
        r"[^<>\r\n\0]{1,120}", author.get("name", "")
    ) or not re.fullmatch(
        r"[^<>\s\0]{1,200}@[^<>\s\0]{1,200}", author.get("email", "")
    ):
        H.fail("GIT_AUTHOR")
    if not isinstance(when, int) or when < 0:
        H.fail("GIT_TIMESTAMP")
    tree = git("write-tree").strip().decode()
    parent = snapshot["head"]["oid"]
    env = {
        "GIT_AUTHOR_NAME": author["name"],
        "GIT_AUTHOR_EMAIL": author["email"],
        "GIT_COMMITTER_NAME": author["name"],
        "GIT_COMMITTER_EMAIL": author["email"],
        "GIT_AUTHOR_DATE": "@" + str(when) + " +0000",
        "GIT_COMMITTER_DATE": "@" + str(when) + " +0000",
    }
    oid = (
        git(
            "commit-tree",
            tree,
            *(["-p", parent] if parent else []),
            data=message.encode(),
            env=env
        )
        .strip()
        .decode()
    )
    target = snapshot["head"]["target"]
    prepared = {
        "commitOid": oid,
        "tree": tree,
        "parent": parent,
        "target": target,
        "indexRevision": snapshot["indexRevision"],
    }
    verify_objects(prepared)
    H.publication(prepared)
    base = FDS[1] if target == "HEAD" else FDS[0]
    parts = target.encode().split(b"/")
    fd = os.dup(base)
    try:
        for part in parts[:-1]:
            child = os.open(
                part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd
            )
            os.close(fd)
            fd = child
        lock = parts[-1] + b".lock"
        out = os.open(
            lock, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd
        )
        try:
            # Compare authoritative HEAD/ref/index again while owning Git's publication lock.
            if (
                read_at(FDS[1], b"HEAD").strip().decode()
                != snapshot["head"]["headBytes"]
                or H.digest(read_at(FDS[1], b"index", optional=True) or b"")
                != snapshot["indexRevision"]
            ):
                H.fail("GIT_CHANGED")
            current = read_at(fd, parts[-1], optional=True)
            if current is not None and current.strip().decode() != (parent or ""):
                H.fail("GIT_CHANGED")
            if current is None and parent:
                packed = read_at(FDS[0], b"packed-refs", optional=True) or b""
                if (parent + " " + target).encode() not in packed.splitlines():
                    H.fail("GIT_CHANGED")
            os.write(out, (oid + "\n").encode())
            os.fsync(out)
            os.rename(lock, parts[-1], src_dir_fd=fd, dst_dir_fd=fd)
            os.fsync(fd)
        finally:
            os.close(out)
            try:
                os.unlink(lock, dir_fd=fd)
            except FileNotFoundError:
                pass
    finally:
        os.close(fd)
    return {
        "commitOid": oid,
        "tree": tree,
        "parent": parent,
        "target": target,
        "indexRevision": snapshot["indexRevision"],
    }


def execute(request):
    global H, FDS
    H = sys.modules["__main__"]
    FDS = setup()
    try:
        action = request["action"]
        payload = request["payload"]
        snapshot = status()
        if action == "status":
            return snapshot
        if action == "verify":
            expected = payload["result"]
            if snapshot["indexRevision"] != expected["indexRevision"] or (
                expected.get("commitOid")
                and snapshot["head"]["oid"] != expected["commitOid"]
            ):
                H.fail("GIT_CHANGED")
            return {"verified": True, **verify_objects(expected)}
        if action == "diff":
            return diff(payload, snapshot)
        if action in ["stage", "unstage", "commit"] and not snapshot["complete"]:
            H.fail("GIT_STATUS_LIMIT")
        if action in ["stage", "unstage"]:
            return stage(payload, snapshot, action == "unstage")
        if action == "commit":
            return commit(payload, snapshot)
        if action == "inspect":
            return snapshot
        H.fail("FILE_ACTION")
    finally:
        for fd in FDS:
            os.close(fd)
