"""Quiesced encrypted checkpoints. Completion is published only after full verification."""

import os, json, stat, time, uuid, hashlib, shlex, shutil
from common import run, atomic, digest
from config import layout, trusted
from control import maintenance, service, db
from artifact import verify
from bounds import MAX_BYTES, MAX_FILES, MAX_FILE_BYTES


def restic(
    c,
    release,
    args,
    timeout=180,
    output=None,
    output_limit=512 * 1024 * 1024,
    capture_limit=8 * 1024 * 1024,
):
    # Immutable snapshot reads use authenticated IDs and run under the Harbor
    # administrator lock. Avoid repository lock writes under a tiny dump FSIZE
    # bound; concurrent removal/corruption fails content verification closed.
    snapshot_read = args[0] in {"ls", "dump"} or args[:2] == ["cat", "tree"]
    b = c["backup"]
    ssh = [
        "ssh",
        "-F",
        "/dev/null",
        "-o",
        "BatchMode=yes",
        "-o",
        "IdentitiesOnly=yes",
        "-o",
        "StrictHostKeyChecking=yes",
        "-o",
        "UserKnownHostsFile=" + b["knownHosts"],
        "-i",
        b["sshKey"],
        "-p",
        str(b["port"]),
        b["user"] + "@" + b["host"],
        "-s",
        "sftp",
    ]
    repository = "sftp:" + b["user"] + "@" + b["host"] + ":" + b["path"]
    return run(
        [
            release + "/bin/restic",
            "--no-cache",
            *(["--no-lock"] if snapshot_read else []),
            "--repo",
            repository,
            "--password-file",
            b["passwordFile"],
            "-o",
            "sftp.command=" + shlex.join(ssh),
            *args,
        ],
        timeout=timeout,
        output=output,
        output_limit=output_limit,
        capture_limit=capture_limit,
        env={
            "PATH": release + "/bin:/usr/sbin:/usr/bin:/sbin:/bin",
            "HOME": "/nonexistent",
            "LC_ALL": "C",
        },
    )


def inventory(root, exclude_native_auth=False, maximum=200000, exclude_locks=False):
    root = os.path.realpath(root)
    device = os.lstat(root).st_dev
    files = {}
    total = 0
    for base, dirs, names in os.walk(root, followlinks=False):
        for name in ["."] + dirs + names:
            target = base if name == "." else base + "/" + name
            relative = os.path.relpath(target, root)
            if relative in files:
                continue
            if exclude_locks and name.endswith(".lock"):
                if os.path.isdir(target):
                    raise ValueError("Unsettled helper lock")
                continue
            if (
                exclude_native_auth
                and name == "auth.json"
                and relative.startswith("native/")
            ):
                continue
            s = os.lstat(target)
            if s.st_dev != device:
                raise ValueError("Unexpected nested backup mount")
            if len(files) >= maximum:
                raise ValueError("Filesystem registry inode bound")
            item = {
                "mode": stat.S_IMODE(s.st_mode) & 0o777,
                "uid": s.st_uid,
                "gid": s.st_gid,
            }
            if stat.S_ISLNK(s.st_mode):
                item.update(type="symlink", target=os.readlink(target))
            elif stat.S_ISDIR(s.st_mode):
                item.update(type="directory")
            elif stat.S_ISREG(s.st_mode):
                if s.st_size > MAX_FILE_BYTES:
                    raise ValueError("Checkpoint file exceeds restore bound")
                item.update(type="file", size=s.st_size, sha256=digest(target))
                total += s.st_size
            else:
                raise ValueError("Unsupported backup special inode")
            files[relative] = item
    return {"bytes": total, "files": files}


def checkpoint(c, interrupt=False):
    p = layout(c["instance"])
    folder = p["state"] + "/backups"
    os.makedirs(folder, mode=0o700, exist_ok=True)
    if len(os.listdir(folder)) >= 128:
        raise ValueError("Checkpoint registry capacity reached")
    release, registry = maintenance(c, interrupt)
    # Caddy owns protected certificates/cache/config and must join quiescence.
    run(
        ["docker", "compose", "-f", p["etc"] + "/compose.json", "stop", "caddy"],
        timeout=90,
    )
    running = run(
        [
            "docker",
            "compose",
            "-f",
            p["etc"] + "/compose.json",
            "ps",
            "--status",
            "running",
            "--services",
        ]
    )
    if "caddy" in running.splitlines():
        raise ValueError("Caddy checkpoint retirement unconfirmed")
    operation = str(uuid.uuid4())
    staging = p["state"] + "/staging/" + operation
    os.mkdir(staging, 0o700)
    # The live services stay stopped on every failure; no finally block resumes work.
    marker = {
        "operation": operation,
        "instance": c["instance"],
        "state": "preparing",
        "createdAt": time.time(),
    }
    atomic(staging + "/operation.json", marker)
    manifest = verify(release)
    units = []
    if {r["version"]: r["digest"] for r in registry["migrations"]} != manifest[
        "migrations"
    ]:
        raise ValueError("Checkpoint schema differs from selected artifact")
    for project in registry["projects"]:
        root = next((r for r in c["roots"] if r["id"] == project["root_id"]), None)
        if root is None:
            raise ValueError("Registered project root absent")
        canonical = project["canonical_path"]
        s = os.lstat(canonical)
        if (
            os.path.realpath(canonical) != canonical
            or str(s.st_dev) != project["device"]
            or str(s.st_ino) != project["inode"]
        ):
            raise ValueError("Registered project identity changed")
        unit = os.path.dirname(canonical)
        if (
            os.path.dirname(unit) != root["path"]
            or os.path.basename(canonical) != "workspace"
        ):
            raise ValueError("Unrecognized project quota unit")
        trusted(unit)
        units.append(
            {
                "class": "project",
                "id": project["id"],
                "path": unit,
                "inventory": inventory(unit, True),
            }
        )
    for root in c["roots"]:
        registered = {
            os.path.basename(u["path"])
            for u in units
            if os.path.dirname(u["path"]) == root["path"]
        }
        if set(os.listdir(root["path"])) != registered:
            raise ValueError(
                "Unregistered project allocation prevents checkpoint; inspect and register the exact existing managed project explicitly"
            )
    # Receipts are historical on restore. A quiesced checkpoint refuses unresolved effects.
    receipt = p["state"] + "/launcher/workspace-receipts"
    if os.path.isdir(receipt):
        for name in os.listdir(receipt):
            if not name.endswith(".json"):
                raise ValueError("Unsettled storage receipt authority")
            r = json.load(open(receipt + "/" + name))
            if r.get("state") not in ["completed", "failed"]:
                raise ValueError("Unsettled storage effect prevents checkpoint")
    # Native auth copies are deliberately absent from both expected inventory and restic.
    protected = [
        p["etc"],
        p["state"] + "/launcher",
        p["state"] + "/caddy-data",
        p["state"] + "/caddy-config",
    ]
    for i, path in enumerate(protected):
        if not os.path.isdir(path):
            raise ValueError("Required protected registry class absent")
        units.append(
            {
                "class": [
                    "configuration",
                    "historical-authority",
                    "caddy-data",
                    "caddy-config",
                ][i],
                "path": path,
                "inventory": inventory(path, exclude_locks=i == 1),
            }
        )
    if (
        sum(u["inventory"]["bytes"] for u in units) > MAX_BYTES - MAX_FILE_BYTES
        or sum(len(u["inventory"]["files"]) for u in units) > MAX_FILES - 512
    ):
        raise ValueError("Checkpoint exceeds the supported complete restore profile")
    available = os.statvfs(staging)
    if available.f_bavail * available.f_frsize < 640 * 1024**2:
        raise ValueError("Checkpoint staging headroom unavailable")
    dump = staging + "/database.dump"
    with open(dump, "xb") as output:
        run(
            [
                "docker",
                "compose",
                "-f",
                p["etc"] + "/compose.json",
                "exec",
                "-T",
                "postgres",
                "pg_dump",
                "-U",
                "harbor",
                "-d",
                "harbor",
                "--format=custom",
                "--exclude-table-data=harbor_migrations",
                "--no-owner",
                "--no-privileges",
            ],
            timeout=60,
            output=output,
        )
        output.flush()
        os.fsync(output.fileno())
    if os.stat(dump).st_size > MAX_FILE_BYTES:
        raise ValueError("Database checkpoint bound")
    payload = {
        "format": 1,
        "backupSchema": manifest["backupSchema"],
        "instance": c["instance"],
        "ownerIssuer": c["oidcIssuer"],
        "ownerSubject": c["ownerSubject"],
        "artifact": manifest["artifact"],
        "nativeCompatibility": manifest["nativeCompatibility"],
        "architecture": manifest["architecture"],
        "configurationSchema": manifest["configurationSchema"],
        "roots": [{"id": r["id"]} for r in c["roots"]],
        "migrations": manifest["migrations"],
        "checkpointAt": time.time(),
        "database": registry,
        "dump": {"path": dump, "sha256": digest(dump), "size": os.stat(dump).st_size},
        "units": units,
    }
    if len(json.dumps(payload, separators=(",", ":")).encode()) > 8 * 1024**2:
        raise ValueError("Checkpoint registry byte bound")
    atomic(staging + "/registry.json", payload)
    files = [u["path"] for u in units] + [dump, staging + "/registry.json"]
    filelist = staging + "/sources"
    open(filelist, "w").write("\n".join(files) + "\n")
    exclusions = [
        value
        for unit in units
        if unit["class"] == "project"
        for value in ["--exclude", unit["path"] + "/native/*/auth.json"]
    ] + ["--exclude", p["state"] + "/launcher/*.lock"]
    result = restic(
        c,
        release,
        [
            "backup",
            "--json",
            "--quiet",
            "--tag",
            "harbor:" + c["instance"],
            *exclusions,
            "--files-from",
            filelist,
        ],
    )
    summaries = [json.loads(line) for line in result.splitlines() if line.strip()]
    summary = next(
        (row for row in summaries if row.get("message_type") == "summary"), None
    )
    if not summary or not summary.get("snapshot_id"):
        raise ValueError("Complete snapshot identity unavailable")
    snapshot = summary["snapshot_id"]
    restic(c, release, ["check", "--read-data"])
    # Repository integrity alone is insufficient: every snapshot byte and node
    # must also match the authenticated Harbor inventory before success.
    from extract import extract

    extract(
        c, release, snapshot, digest(staging + "/registry.json"), None, verify_only=True
    )
    completion = {
        "operation": operation,
        "snapshot": snapshot,
        "instance": c["instance"],
        "checkpointAt": payload["checkpointAt"],
        "registrySha256": digest(staging + "/registry.json"),
        "artifact": manifest["artifact"],
        "verified": True,
    }
    folder = p["state"] + "/backups"
    os.makedirs(folder, mode=0o700, exist_ok=True)
    if len(os.listdir(folder)) >= 128:
        raise ValueError("Checkpoint registry capacity reached")
    atomic(folder + "/" + snapshot + ".json", completion)
    # Remove only this operation's bounded staging. The encrypted snapshot contains
    # the registry and database dump; protected model key was never copied here.
    shutil.rmtree(staging)
    return completion
