"""Trusted four-slot ledger. flock covers every read/CAS/write; no Docker authority here."""

import fcntl
import json
import os
import re
import stat
import sys
import time

base, action, operation_id, owner_pid = sys.argv[1:]
if action not in ["claim", "release"] or not re.fullmatch(
    r"[a-f0-9-]{36}", operation_id
):
    raise ValueError("Invalid slot request")
owner_pid = int(owner_pid)
if owner_pid < 1:
    raise ValueError("Invalid slot process")
root = os.open(base, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
info = os.fstat(root)
if info.st_uid != os.getuid() or info.st_mode & 0o077:
    raise ValueError("Unsafe slot authority")
fd = os.open(
    "file-slots.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600, dir_fd=root
)
try:
    fcntl.flock(fd, fcntl.LOCK_EX)
    info = os.fstat(fd)
    if (
        not stat.S_ISREG(info.st_mode)
        or info.st_nlink != 1
        or info.st_uid != os.getuid()
        or info.st_mode & 0o077
    ):
        raise ValueError("Unsafe slot ledger")
    try:
        ledger = os.open("file-slots.json", os.O_RDONLY | os.O_NOFOLLOW, dir_fd=root)
    except FileNotFoundError:
        raw = b""
    else:
        try:
            info = os.fstat(ledger)
            if (
                not stat.S_ISREG(info.st_mode)
                or info.st_nlink != 1
                or info.st_uid != os.getuid()
                or info.st_mode & 0o077
            ):
                raise ValueError("Unsafe slot ledger")
            raw = os.read(ledger, 8193)
        finally:
            os.close(ledger)
    if len(raw) > 8192:
        raise ValueError("Slot ledger limit")
    rows = json.loads(raw) if raw else []
    if not isinstance(rows, list) or len(rows) > 4:
        raise ValueError("Invalid slot ledger")
    for row in rows:
        if (
            set(row) != {"id", "pid", "createdAt"}
            or not re.fullmatch(r"[a-f0-9-]{36}", row["id"])
            or not isinstance(row["pid"], int)
            or row["pid"] < 1
            or not isinstance(row["createdAt"], (float, int))
        ):
            raise ValueError("Invalid slot owner")
    changed = False
    if action == "release":
        kept = [row for row in rows if row["id"] != operation_id]
        changed = len(kept) != len(rows)
        rows = kept
        result = {"released": changed}
    elif any(row["id"] == operation_id for row in rows):
        # Even the same process cannot start two helpers for one durable operation.
        result = {"claimed": False, "stale": []}
    elif len(rows) < 4:
        rows.append({"id": operation_id, "pid": owner_pid, "createdAt": time.time()})
        changed = True
        result = {"claimed": True}
    else:
        stale = []
        for row in rows:
            if time.time() - row["createdAt"] < 120:
                continue
            try:
                os.kill(row["pid"], 0)
            except ProcessLookupError:
                stale.append(row["id"])
            except PermissionError:
                pass
        # Caller must confirm exact labeled container absence before releasing a stale row.
        result = {"claimed": False, "stale": stale}
    if changed:
        encoded = json.dumps(rows, separators=(",", ":")).encode()
        temporary = ".file-slots-" + str(os.getpid())
        out = os.open(
            temporary,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            0o600,
            dir_fd=root,
        )
        try:
            os.write(out, encoded)
            os.fsync(out)
            os.rename(temporary, "file-slots.json", src_dir_fd=root, dst_dir_fd=root)
            os.fsync(root)
        finally:
            os.close(out)
            try:
                os.unlink(temporary, dir_fd=root)
            except FileNotFoundError:
                pass
    print(json.dumps(result))
finally:
    os.close(fd)
    os.close(root)
