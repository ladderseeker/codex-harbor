"""Fresh managed-unit publication under administrator-owned destination parents."""

import os, stat, re, json, shutil, importlib.util, ctypes, multiprocessing, fcntl
from config import layout, trusted
from common import atomic

NATIVE = re.compile(r"^(?:terminal-)?[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$")
UUID = re.compile(r"^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$")


def identity(path):
    s = os.lstat(path)
    if not stat.S_ISDIR(s.st_mode) or os.path.realpath(path) != path:
        raise ValueError("Published directory identity unavailable")
    return {"canonical": path, "device": str(s.st_dev), "inode": str(s.st_ino)}


def flush(path):
    def worker():
        fd = os.open(path, os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            if ctypes.CDLL(None, use_errno=True).syncfs(fd):
                os._exit(1)
        finally:
            os.close(fd)

    child = multiprocessing.Process(target=worker)
    child.start()
    child.join(12)
    if child.is_alive():
        child.terminate()
        child.join()
        raise ValueError("Project durability barrier timed out")
    if child.exitcode:
        raise ValueError("Project durability barrier failed")


def owner(relative, item):
    parts = relative.split("/")
    if relative == ".":
        return 0, 0o700
    if parts[0] == "workspace":
        return 10001, (item.get("mode", 0o700) & 0o777)
    if parts[0] == "git-common":
        return 10001, (item.get("mode", 0o700) & 0o777)
    if parts[0] == "native":
        if len(parts) == 1:
            return 0, 0o700
        if not NATIVE.fullmatch(parts[1]):
            raise ValueError("Invalid native-home identity")
        return 10001, (item.get("mode", 0o700) & 0o777)
    if parts[0] == "workspaces":
        if len(parts) == 1:
            return 0, 0o700
        if not UUID.fullmatch(parts[1]):
            raise ValueError("Invalid derived-workspace identity")
        if len(parts) == 2:
            return 0, 0o700
        if parts[2] != "checkout":
            raise ValueError("Unknown derived-workspace unit")
        return 10001, (item.get("mode", 0o700) & 0o777)
    if parts[0] == "attachments":
        if len(parts) > 1 and not UUID.fullmatch(parts[1]):
            raise ValueError("Invalid attachment session identity")
        if len(parts) > 2 and (not UUID.fullmatch(parts[2]) or len(parts) != 3):
            raise ValueError("Invalid attachment file identity")
        return 0, 0o755 if item["type"] == "directory" else 0o444
    raise ValueError("Unregistered project filesystem class")


def copy_unit(source, target, inventory):
    # Only this operation owns the fresh quota unit. Existing project data is never
    # emptied, and source symlinks are copied without following them.
    for relative, item in sorted(
        inventory.items(), key=lambda pair: len(pair[0].split("/"))
    ):
        if relative == ".":
            continue
        dest = target + "/" + relative
        src = source + "/" + relative
        uid, mode = owner(relative, item)
        if item["type"] == "symlink":
            continue
        if item["type"] == "directory":
            if not os.path.exists(dest):
                os.mkdir(dest, 0o700)
            if not stat.S_ISDIR(os.lstat(dest).st_mode):
                raise ValueError("Restore directory conflict")
        else:
            with open(src, "rb") as stream:
                fd = os.open(
                    dest, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600
                )
                with os.fdopen(fd, "wb") as output:
                    shutil.copyfileobj(stream, output)
                    output.flush()
                    os.fsync(output.fileno())
        os.chown(dest, uid, uid)
        os.chmod(dest, mode)
    for relative, item in inventory.items():
        if item["type"] == "symlink":
            uid, _ = owner(relative, item)
            os.symlink(item["target"], target + "/" + relative)
            os.chown(target + "/" + relative, uid, uid, follow_symlinks=False)


def empty_slot(path):
    # A prepared quota ID is not proof that unknown bytes are disposable.
    if set(os.listdir(path)) != {"workspace", "native"}:
        raise ValueError("Restore requires an empty prepared quota slot")
    for name, uid in [("workspace", 10001), ("native", 0)]:
        child = path + "/" + name
        info = os.lstat(child)
        if (
            not stat.S_ISDIR(info.st_mode)
            or info.st_uid != uid
            or info.st_mode & 0o700 != 0o700
            or os.listdir(child)
        ):
            raise ValueError("Restore requires an empty prepared quota slot")


def publish(
    c, release, registry, staging, journal, journal_path, native_probe_started=False
):
    state = layout(c["instance"])["state"] + "/launcher"
    trusted(state, private=True)
    with open(state + "/storage.lock", "a") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError(
                "Storage authority busy; restore remains pending"
            ) from None
        return _publish(
            c, release, registry, staging, journal, journal_path, native_probe_started
        )


def _publish(
    c, release, registry, staging, journal, journal_path, native_probe_started=False
):
    spec = importlib.util.spec_from_file_location(
        "harbor_restore_quota", release + "/infra/storage/quota.py"
    )
    quota = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(quota)
    projects = []
    workspaces = []
    attachments = []
    attachment_files = []
    native = []
    for project in registry["database"]["projects"]:
        if not UUID.fullmatch(project["id"]):
            raise ValueError("Invalid project identity")
        root = next(
            (r for r in c["xfsProfile"]["roots"] if r["id"] == project["root_id"]), None
        )
        unit = next(
            (
                u
                for u in registry["units"]
                if u["class"] == "project" and u["id"] == project["id"]
            ),
            None,
        )
        if not root or not unit:
            raise ValueError("Destination root/project registry absent")
        name = os.path.basename(unit["path"])
        if not re.fullmatch("[A-Za-z0-9][A-Za-z0-9_-]{0,63}", name):
            raise ValueError("Invalid managed project name")
        target = root["path"] + "/" + name
        plans = journal.setdefault("projects", {})
        plan = plans.get(project["id"])
        if plan is None:
            if os.path.lexists(target):
                raise ValueError("Restore cannot adopt an existing project")
            slots = sorted(os.listdir(root["pool"]))
            if not slots:
                raise ValueError("Destination quota pool exhausted")
            slot = root["pool"] + "/" + slots[0]
            quota.verify(slot, c["xfsProfile"])
            empty_slot(slot)
            claimed = (
                os.path.dirname(root["pool"])
                + "/restore-claim-"
                + c["instance"]
                + "-"
                + project["id"]
            )
            if os.path.lexists(claimed):
                raise ValueError("Unknown restore claim exists")
            plan = {
                "claimVersion": 1,
                "claimed": claimed,
                "slot": slot,
                "target": target,
                **identity(slot),
                "state": "planned",
            }
            plans[project["id"]] = plan
            atomic(journal_path, journal)
        if plan.get("claimVersion") != 1:
            raise ValueError(
                "Restore claim predates exclusive publication; administrator recovery required"
            )
        if not os.path.lexists(target) and not os.path.lexists(plan["claimed"]):
            # Before the atomic move no unknown slot content is owned by restore.
            candidate = identity(plan["slot"])
            if (candidate["device"], candidate["inode"]) != (
                plan["device"],
                plan["inode"],
            ):
                raise ValueError("Restore slot changed before claim")
            empty_slot(plan["slot"])
            os.rename(plan["slot"], plan["claimed"])
            flush(os.path.dirname(root["pool"]))
        current = target if os.path.lexists(target) else plan["claimed"]
        actual = identity(current)
        if (actual["device"], actual["inode"]) != (plan["device"], plan["inode"]):
            raise ValueError("Restore unit changed")
        if plan["state"] != "published":
            if current == target:
                # A lost rename acknowledgement may be reconciled only against the exact
                # planned inode after content equality and quota validation below.
                pass
            else:
                for child in os.listdir(current):
                    path = current + "/" + child
                    if stat.S_ISDIR(os.lstat(path).st_mode):
                        shutil.rmtree(path)
                    else:
                        os.unlink(path)
                copy_unit(staging + unit["path"], current, unit["inventory"]["files"])
                quota.verify(current, c["xfsProfile"])
                flush(current)
                os.rename(current, target)
                flush(root["path"])
        from backup import inventory

        observed = inventory(target, True)
        expected = unit["inventory"]
        compared = lambda files: {
            path: item
            for path, item in files.items()
            if not (
                native_probe_started
                and (path == "native" or path.startswith("native/"))
            )
        }
        if set(compared(observed["files"])) != set(compared(expected["files"])):
            raise ValueError("Restored unit content incomplete")
        for path, item in compared(expected["files"]).items():
            other = observed["files"][path]
            if any(
                other.get(k) != item.get(k)
                for k in ["type", "size", "sha256", "target"]
            ):
                raise ValueError("Restored unit content mismatch")
        quota.verify(target, c["xfsProfile"])
        flush(target)
        plan["state"] = "published"
        atomic(journal_path, journal)
        if os.path.isdir(target + "/native"):
            for home in sorted(os.listdir(target + "/native")):
                if not NATIVE.fullmatch(home):
                    raise ValueError("Invalid native directory identity")
                native.append(
                    {
                        "projectId": project["id"],
                        "sessionId": home,
                        **identity(target + "/native/" + home),
                    }
                )
        local = identity(target + "/workspace")
        projects.append(
            {
                "id": project["id"],
                "rootId": root["id"],
                "relativePath": name + "/workspace",
                **local,
            }
        )
        for w in registry["database"]["workspaces"]:
            if w["project_id"] != project["id"]:
                continue
            if w["state"] == "removed":
                continue
            dest = (
                target + "/workspace"
                if w["kind"] == "local"
                else target + "/workspaces/" + w["id"] + "/checkout"
            )
            value = {
                "id": w["id"],
                "relativePath": os.path.relpath(dest, root["path"]),
                **identity(dest),
            }
            if w.get("common_path"):
                value["common"] = identity(target + "/git-common")
            workspaces.append(value)
        for a in registry["database"].get("attachments", []):
            if a.get("project_id") == project["id"]:
                attachments.append(
                    {
                        "sessionId": a["session_id"],
                        **identity(target + "/attachments/" + a["session_id"]),
                    }
                )
        for a in registry["database"].get("attachmentFiles", []):
            if a["project_id"] != project["id"]:
                continue
            path = target + "/attachments/" + a["session_id"] + "/" + a["id"]
            s = os.lstat(path)
            if not stat.S_ISREG(s.st_mode) or s.st_uid != 0 or s.st_mode & 0o222:
                raise ValueError("Restored attachment ownership mismatch")
            from common import digest

            if a.get("digest") and digest(path) != a["digest"]:
                raise ValueError("Restored attachment digest mismatch")
            attachment_files.append(
                {"id": a["id"], "device": str(s.st_dev), "inode": str(s.st_ino)}
            )
    return {
        "projects": projects,
        "workspaces": workspaces,
        "attachments": attachments,
        "attachmentFiles": attachment_files,
        "nativeIdentities": native,
    }
