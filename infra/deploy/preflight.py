"""Admission checks use fixed Linux tools and administrator-owned manifests."""

import os, sys, json, platform, shutil, importlib.util, stat
from common import run
from config import trusted, layout
from artifact import verify


def preflight(c, release):
    if sys.platform != "linux" or os.geteuid() != 0:
        raise ValueError("Supported Linux root administrator required")
    if any(
        k.startswith("HARBOR_FIXTURE") or k == "HARBOR_TEST_CODEX_HOME"
        for k in os.environ
    ):
        raise ValueError("Fixture configuration forbidden in installed services")
    m = verify(release)
    if set(m["images"]) != {"postgres", "caddy", "runner", "gateway", "git", "files"}:
        raise ValueError("Complete installed image registry required")
    if m.get("terminalSeccomp") != m["files"]["infra/runner/seccomp-terminal.json"]["sha256"]:
        raise ValueError("Terminal confinement manifest missing")
    for tool in [
        "docker",
        "systemctl",
        "systemd-tmpfiles",
        "xfs_quota",
        "findmnt",
        "python3",
        "ss",
        "ssh",
        "gcc",
    ]:
        if not shutil.which(tool):
            raise ValueError("Required administrator tool unavailable: " + tool)
    if not os.path.isdir("/run/systemd/system"):
        raise ValueError("Active systemd required")
    info = json.loads(run(["docker", "info", "--format", "{{json .}}"]))
    if info["OSType"] != "linux" or info["Architecture"] not in ["aarch64", "x86_64"]:
        raise ValueError("Local supported Linux Docker required")
    context = json.loads(run(["docker", "context", "inspect"]))[0]
    if context["Endpoints"]["docker"]["Host"] != "unix:///var/run/docker.sock":
        raise ValueError("Local root Docker socket required")
    run(["docker", "compose", "version", "--short"])
    for role, image in m["images"].items():
        installed = json.loads(run(["docker", "image", "inspect", image["id"]]))[0]
        if (
            installed["Id"] != image["id"]
            or installed["Architecture"] != image["architecture"]
        ):
            raise ValueError("Exact release image unavailable: " + role)
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location(
        "harbor_quota", release + "/infra/storage/quota.py"
    )
    quota = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(quota)
    seen = set()
    count = 0
    for root in c["xfsProfile"]["roots"]:
        quota.trusted(root["path"])
        quota.trusted(root["pool"])
        mounted = json.loads(run(["findmnt", "--json", "--target", root["path"]]))[
            "filesystems"
        ]
        if len(mounted) != 1 or mounted[0]["fstype"] != "xfs":
            raise ValueError("Dedicated XFS mount required")
        persistent = json.loads(
            run(["findmnt", "--fstab", "--json", "--mountpoint", mounted[0]["target"]])
        )["filesystems"]
        if (
            len(persistent) != 1
            or persistent[0]["fstype"] != "xfs"
            or not (
                {"prjquota", "pquota"}
                & set(persistent[0].get("options", "").split(","))
            )
        ):
            raise ValueError("Persistent quota-enabled fstab mount required")
        for parent in [root["path"], root["pool"]]:
            entries = os.listdir(parent)
            if len(entries) > 64:
                raise ValueError("Managed pool directory count limit")
            for entry in entries:
                if not entry or entry.startswith("."):
                    raise ValueError("Unrecognized managed pool entry")
                target = parent + "/" + entry
                if not stat.S_ISDIR(os.lstat(target).st_mode):
                    raise ValueError("Unrecognized managed pool inode")
                quota.verify(target, c["xfsProfile"])
                identity = (os.stat(target).st_dev, quota.attributes(target)[1])
                if identity in seen:
                    raise ValueError("Duplicate project quota identity")
                seen.add(identity)
                count += 1
    if not count:
        raise ValueError("Prepared project quota pool required")
    p = layout(c["instance"])
    for target in [release, p["state"]]:
        space = os.statvfs(target)
        if space.f_bavail * space.f_frsize < 128 * 1024**2 or space.f_favail < 1024:
            raise ValueError("Control-plane headroom unavailable")
    return {
        "status": "admitted",
        "artifact": m["artifact"],
        "architecture": platform.machine(),
        "quotaUnits": count,
        "images": {k: v["id"] for k, v in m["images"].items()},
    }
