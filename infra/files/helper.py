"""Fixed nonroot file/Git helper; receives no host paths or executable options."""

import os, sys, json, stat, hashlib, base64, time, re

ROOT = "/workspace"
TEXT = 1048576
DOWNLOAD = 16777216
publicationAuthorized = False


class Denied(Exception):
    def __init__(self, code):
        self.code = code


def fail(code):
    raise Denied(code)


def digest(value):
    return hashlib.sha256(value).hexdigest()


def ref_for(parts):
    return (
        request["workspaceId"]
        + ":"
        + base64.urlsafe_b64encode(b"/".join(parts)).decode().rstrip("=")
    )


def parts_for(ref):
    if not isinstance(ref, str) or not ref.startswith(request["workspaceId"] + ":"):
        fail("FILE_REFERENCE")
    try:
        encoded = ref.split(":", 1)[1]
        raw = base64.b64decode(
            encoded + "=" * (-len(encoded) % 4), altchars=b"-_", validate=True
        )
    except Exception:
        fail("FILE_REFERENCE")
    if len(raw) > 4096 or b"\0" in raw or b"\\" in raw or raw.startswith(b"/"):
        fail("FILE_PATH")
    parts = raw.split(b"/") if raw else []
    if len(parts) > 32 or any(
        p in [b"", b".", b"..", b".git"] or p.startswith(b".harbor-") for p in parts
    ):
        fail("FILE_PATH")
    return parts


def directory(parts):
    fd = os.open(ROOT, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for p in parts:
            child = os.open(p, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
        return fd
    except BaseException:
        os.close(fd)
        raise


def label(raw):
    try:
        text = raw.decode("utf-8")
        return "".join(
            (
                "\\u%04x" % ord(c)
                if ord(c) < 32
                or 127 <= ord(c) <= 159
                or 0x202A <= ord(c) <= 0x202E
                or 0x2066 <= ord(c) <= 0x2069
                else c
            )
            for c in text
        )
    except UnicodeDecodeError:
        return "".join(
            chr(b) if 32 <= b < 127 and b != 92 else "\\x%02x" % b for b in raw
        )


def names(fd):
    out = []
    with os.scandir(fd) as entries:
        for e in entries:
            b = os.fsencode(e.name)
            if b == b".git" or b.startswith(b".harbor-"):
                continue
            out.append(b)
            if len(out) > 10000:
                fail("DIRECTORY_LIMIT")
    return sorted(out)


def metadata(s):
    return [
        str(x)
        for x in [
            s.st_dev,
            s.st_ino,
            s.st_mode,
            s.st_nlink,
            s.st_size,
            s.st_mtime_ns,
            s.st_ctime_ns,
        ]
    ]


def read(parts, limit=TEXT):
    if not parts:
        fail("FILE_PATH")
    parent = directory(parts[:-1])
    fd = None
    try:
        fd = os.open(
            parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent
        )
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode):
            fail("FILE_KIND")
        if before.st_nlink != 1:
            fail("FILE_HARDLINK")
        if before.st_size > limit:
            fail("FILE_TOO_LARGE")
        chunks = []
        total = 0
        while True:
            b = os.read(fd, min(65536, limit + 1 - total))
            if not b:
                break
            chunks.append(b)
            total += len(b)
            if total > limit:
                fail("FILE_TOO_LARGE")
        data = b"".join(chunks)
        if metadata(before) != metadata(os.fstat(fd)):
            fail("FILE_CHANGED")
        revision = digest(
            request["workspaceId"].encode()
            + b"\0"
            + b"/".join(parts)
            + b"\0"
            + json.dumps(metadata(before)).encode()
            + b"\0"
            + data
        )
        return data, revision, before
    finally:
        if fd is not None:
            os.close(fd)
        os.close(parent)


def tree(payload):
    parts = parts_for(payload.get("ref", ref_for([])))
    fd = directory(parts)
    try:
        before = os.fstat(fd)
        entries = []
        for name in names(fd):
            try:
                s = os.stat(name, dir_fd=fd, follow_symlinks=False)
            except FileNotFoundError:
                fail("FILE_CHANGED")
            kind = (
                "directory"
                if stat.S_ISDIR(s.st_mode)
                else (
                    "file"
                    if stat.S_ISREG(s.st_mode)
                    else "symlink" if stat.S_ISLNK(s.st_mode) else "unavailable"
                )
            )
            entries.append(
                {
                    "ref": ref_for(parts + [name]),
                    "name": label(name),
                    "kind": kind,
                    "size": s.st_size,
                    "revision": digest(json.dumps(metadata(s)).encode()),
                }
            )
        if metadata(before) != metadata(os.fstat(fd)):
            fail("FILE_CHANGED")
        revision = digest(
            json.dumps([metadata(before), entries], sort_keys=True).encode()
        )
        if payload.get("revision") and payload["revision"] != revision:
            fail("FILE_CHANGED")
        offset = payload.get("offset", 0)
        limit = payload.get("limit", 200)
        if (
            not isinstance(offset, int)
            or offset < 0
            or not isinstance(limit, int)
            or not 1 <= limit <= 200
        ):
            fail("FILE_PAGE")
        return {
            "entries": entries[offset : offset + limit],
            "revision": revision,
            "nextOffset": offset + limit if offset + limit < len(entries) else None,
            "truncated": offset + limit < len(entries),
        }
    finally:
        os.close(fd)


def content(payload, download=False):
    parts = parts_for(payload["ref"])
    try:
        data, revision, s = read(parts, DOWNLOAD if download else TEXT)
    except Denied as e:
        if not download and e.code in ["FILE_TOO_LARGE", "FILE_KIND", "FILE_HARDLINK"]:
            return {"status": "unavailable", "reason": e.code}
        raise
    if payload.get("revision") and payload["revision"] != revision:
        fail("FILE_CHANGED")
    result = {
        "revision": revision,
        "size": len(data),
        "name": label(parts[-1]),
        "ref": ref_for(parts),
    }
    if download:
        return dict(result, data=base64.b64encode(data).decode(), status="available")
    try:
        text = data.decode("utf-8")
        if "\0" in text:
            raise UnicodeDecodeError("utf8", data, 0, 1, "binary")
    except UnicodeDecodeError:
        return dict(result, status="binary")
    return dict(result, status="text", text=text)


def search(payload):
    q = payload.get("q")
    mode = payload.get("mode", "filename")
    if (
        not isinstance(q, str)
        or not 1 <= len(q) <= 120
        or mode not in ["filename", "text"]
    ):
        fail("SEARCH_QUERY")
    budget = payload.get("budget", {"entries": 10000, "bytes": 33554432, "ms": 2000})
    if any(
        not isinstance(budget.get(k), int) or not 0 <= budget[k] <= v
        for k, v in [("entries", 10000), ("bytes", 33554432), ("ms", 2000)]
    ):
        fail("SEARCH_BUDGET")
    start = time.monotonic()
    visited = 0
    used = 0
    matches = []
    skipped = 0
    position = 0
    offset = payload.get("offset", 0)
    lineOffset = payload.get("lineOffset", 0)
    rootRevision = tree({"limit": 1})["revision"]
    if payload.get("revision") and payload["revision"] != rootRevision:
        fail("FILE_CHANGED")
    stack = [[]]
    nextPage = None
    truncated = False

    def remaining():
        return {
            "entries": max(0, budget["entries"] - visited),
            "bytes": max(0, budget["bytes"] - used),
            "ms": max(0, budget["ms"] - max(1, int((time.monotonic() - start) * 1000))),
        }

    def outcome():
        return {
            "matches": matches,
            "visited": visited,
            "inspectedBytes": used,
            "skipped": skipped,
            "truncated": truncated,
            "revision": rootRevision,
            "nextPage": nextPage,
        }

    while stack:
        parts = stack.pop()
        fd = directory(parts)
        try:
            for name in names(fd):
                if (
                    visited >= budget["entries"]
                    or used >= budget["bytes"]
                    or (time.monotonic() - start) * 1000 >= budget["ms"]
                ):
                    truncated = True
                    return outcome()
                visited += 1
                p = parts + [name]
                if len(p) > 32:
                    skipped += 1
                    continue
                s = os.stat(name, dir_fd=fd, follow_symlinks=False)
                if stat.S_ISDIR(s.st_mode):
                    stack.append(p)
                position += 1
                if position <= offset:
                    continue
                if mode == "filename":
                    if q in label(name):
                        matches.append({"ref": ref_for(p), "path": label(b"/".join(p))})
                elif stat.S_ISREG(s.st_mode):
                    if s.st_size > min(TEXT, budget["bytes"] - used):
                        skipped += 1
                        continue
                    try:
                        data, rev, _ = read(p)
                        used += len(data)
                        text = data.decode("utf-8")
                    except (Denied, UnicodeDecodeError, OSError):
                        skipped += 1
                        continue
                    if "\0" in text:
                        skipped += 1
                        continue
                    lines = text.splitlines()
                    for n, line in enumerate(lines, 1):
                        if position == offset + 1 and n <= lineOffset:
                            continue
                        if q in line:
                            at = line.find(q)
                            matches.append(
                                {
                                    "ref": ref_for(p),
                                    "path": label(b"/".join(p)),
                                    "line": n,
                                    "snippet": line[max(0, at - 120) : at + 240],
                                    "revision": rev,
                                }
                            )
                            if len(matches) >= 200:
                                truncated = True
                                left = remaining()
                                if all(left.values()):
                                    nextPage = {
                                        "offset": position - 1,
                                        "lineOffset": n,
                                        "budget": left,
                                        "revision": rootRevision,
                                    }
                                return outcome()
                if len(matches) >= 200:
                    truncated = True
                    left = remaining()
                    if all(left.values()):
                        nextPage = {
                            "offset": position,
                            "lineOffset": 0,
                            "budget": left,
                            "revision": rootRevision,
                        }
                    return outcome()
        finally:
            os.close(fd)
    return outcome()


def publication(result):
    global publicationAuthorized
    print(
        json.dumps({"phase": "prepared", "result": result}, separators=(",", ":")),
        flush=True,
    )
    if sys.stdin.buffer.readline(65) != b'{"publish":true}\n':
        fail("PUBLICATION_UNCONFIRMED")
    publicationAuthorized = True


def save(payload):
    parts = parts_for(payload["ref"])
    text = payload.get("text")
    if not isinstance(text, str) or "\0" in text:
        fail("FILE_TEXT")
    data = text.encode("utf-8")
    if len(data) > TEXT:
        fail("FILE_TOO_LARGE")
    old, revision, s = read(parts)
    if revision != payload.get("expectedRevision"):
        fail("FILE_STALE")
    parent = directory(parts[:-1])
    temporary = b".harbor-save-" + request["operationId"].encode()
    fd = None
    try:
        fd = os.open(
            temporary,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            s.st_mode & 0o777,
            dir_fd=parent,
        )
        # open() applies umask; restore only the previously inspected rwx bits.
        os.fchmod(fd, s.st_mode & 0o777)
        at = 0
        while at < len(data):
            at += os.write(fd, data[at:])
        os.fsync(fd)
        os.close(fd)
        fd = None
        publication(
            {
                "ref": ref_for(parts),
                "sha256": digest(data),
                "size": len(data),
                "expectedRevision": revision,
            }
        )
        latest = os.stat(parts[-1], dir_fd=parent, follow_symlinks=False)
        if metadata(latest) != metadata(s):
            fail("FILE_CHANGED")
        os.replace(temporary, parts[-1], src_dir_fd=parent, dst_dir_fd=parent)
        os.fsync(parent)
        current, newRevision, after = read(parts)
        if current != data:
            fail("FILE_CHANGED")
        return {
            "ref": ref_for(parts),
            "revision": newRevision,
            "sha256": digest(data),
            "size": len(data),
            "identity": metadata(after),
        }
    finally:
        if fd is not None:
            os.close(fd)
        try:
            os.unlink(temporary, dir_fd=parent)
        except FileNotFoundError:
            pass
        os.close(parent)


def main():
    global request
    raw = sys.stdin.buffer.readline(2097153)
    if len(raw) > 2097152:
        fail("FILE_INPUT_LIMIT")
    request = json.loads(raw)
    if not re.fullmatch(r"[a-f0-9-]{36}", request.get("workspaceId", "")):
        fail("FILE_IDENTITY")
    action = request["action"]
    payload = request.get("payload", {})
    if action == "tree":
        result = tree(payload)
    elif action == "search":
        result = search(payload)
    elif action in ["content", "download"]:
        result = content(payload, action == "download")
    elif action == "save":
        result = save(payload)
    else:
        from git_actions import execute

        result = execute(request)
    print(json.dumps(result, ensure_ascii=True, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except Denied as e:
        print(
            json.dumps(
                {
                    "error": e.code,
                    "phase": (
                        "uncertain" if publicationAuthorized else "before-publication"
                    ),
                }
            )
        )
        sys.exit(2)
    except FileNotFoundError:
        print(
            json.dumps(
                {
                    "error": "FILE_MISSING",
                    "phase": (
                        "uncertain" if publicationAuthorized else "before-publication"
                    ),
                }
            )
        )
        sys.exit(2)
    except BaseException:
        print(
            json.dumps(
                {
                    "error": "FILE_UNAVAILABLE",
                    "phase": (
                        "uncertain" if publicationAuthorized else "before-publication"
                    ),
                }
            )
        )
        sys.exit(2)
