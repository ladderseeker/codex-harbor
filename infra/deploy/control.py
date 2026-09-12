"""Fixed administrative lifecycle; no user-supplied command, Docker flags or SQL."""

import os, json, time, secrets, uuid, urllib.request, urllib.error, ssl
from common import run, atomic, record
from config import layout, load, trusted
from artifact import install, verify
from preflight import preflight
from services import write, environment, text

ROLES = ["storage", "supervisor", "api"]


def db(c, release, action, **fields):
    env = environment(c, release, "supervisor")
    return json.loads(
        run(
            [
                release + "/bin/node",
                "--import",
                release + "/node_modules/tsx/dist/loader.mjs",
                release + "/infra/deploy/database.ts",
            ],
            input=json.dumps({"action": action, **fields}).encode(),
            env=env,
            timeout=60,
        )
    )


def service(c, verb, roles=ROLES):
    p = layout(c["instance"])
    if verb == "start" and roles == ROLES:
        run(
            ["docker", "compose", "-f", p["etc"] + "/compose.json", "start", "caddy"],
            timeout=90,
        )
    run(
        ["systemctl", verb, *[p["unit"] + "-" + r + ".service" for r in roles]],
        timeout=90,
    )


def selected(c):
    p = layout(c["instance"])
    state = json.load(open(p["state"] + "/installation.json"))
    release = state["release"]
    verify(release, state["artifact"])
    return release, state


def initialize(c, archive, sha, resume=False, disabled=False):
    p = layout(c["instance"])
    old = (
        json.load(open(p["state"] + "/installation.json"))
        if os.path.exists(p["state"] + "/installation.json")
        else None
    )
    if old and (not resume or old["state"] != "installing"):
        raise ValueError(
            "Existing instance requires explicit incomplete-install recovery or promotion"
        )
    if resume and not old:
        raise ValueError("No incomplete installation to resume")
    release, m = install(archive, sha)
    preflight(c, release)
    os.makedirs(p["etc"], mode=0o700, exist_ok=True)
    trusted(p["etc"], private=not old)
    if old and json.load(open(p["etc"] + "/config.json")) != c:
        raise ValueError("Incomplete installation configuration changed")
    if not old:
        if any(os.listdir(root["path"]) for root in c["roots"]):
            raise ValueError("Fresh installation requires unused managed project roots")
        # Refuse accidental adoption of an old failed installation's secrets/data.
        if os.listdir(p["etc"]):
            raise ValueError("Fresh installation configuration directory required")
        atomic(p["etc"] + "/config.json", c)
        text(
            p["etc"] + "/database.password",
            secrets.token_hex(32) + "\n",
            0o400,
            999,
            999,
        )
        fd = os.open(
            p["etc"] + "/model.key", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600
        )
        with os.fdopen(fd, "wb") as stream:
            stream.write(secrets.token_bytes(32))
            stream.flush()
            os.fsync(stream.fileno())
    state = {
        "format": 1,
        "instance": c["instance"],
        "artifact": m["artifact"],
        "release": release,
        "archiveSha256": sha,
        "state": "installing",
        "createdAt": time.time(),
    }
    atomic(p["state"] + "/installation.json", state)
    write(c, release)
    service(c, "restart", ["dependencies"])
    db(c, release, "migrate")
    db(c, release, "maintenance", enabled=True, activationRequired=True)
    if disabled:
        state["state"] = "restoring"
        atomic(p["state"] + "/installation.json", state)
        return {"prepared": True, "disabled": True, "artifact": m["artifact"]}
    service(c, "start")
    await_readiness(c, release)
    state["state"] = "installed"
    atomic(p["state"] + "/installation.json", state)
    db(c, release, "activate")
    service(c, "enable", ["dependencies", *ROLES])
    return {"installed": True, "instance": c["instance"], "artifact": m["artifact"]}


def await_readiness(c, release, seconds=30):
    # Type=simple confirms process creation, not application socket readiness.
    deadline = time.monotonic() + seconds
    while True:
        try:
            return readiness(c, release)
        except (FileNotFoundError, ValueError, RuntimeError):
            if time.monotonic() >= deadline:
                raise ValueError(
                    "Installed service readiness deadline exceeded; admission remains disabled"
                ) from None
            time.sleep(0.2)


def readiness(c, release):
    p = layout(c["instance"])
    preflight(c, release)
    for role in ["dependencies", *ROLES]:
        if (
            run(["systemctl", "is-active", p["unit"] + "-" + role + ".service"]).strip()
            != "active"
        ):
            raise ValueError("Installed service unavailable")
    for role, uid in [("api", c["apiUid"]), ("supervisor", 0), ("storage", 0)]:
        pid = int(
            run(
                [
                    "systemctl",
                    "show",
                    "--property=MainPID",
                    "--value",
                    p["unit"] + "-" + role + ".service",
                ]
            ).strip()
        )
        if not pid or os.stat("/proc/" + str(pid)).st_uid != uid:
            raise ValueError("Service privilege mismatch")
    for name in ["storage.sock", "credentials.sock"]:
        s = os.lstat(p["run"] + "/" + name)
        if s.st_uid != c["apiUid"] or s.st_mode & 0o177:
            raise ValueError("Private IPC ownership mismatch")
    listeners = run(["ss", "-H", "-ltn"]).splitlines()
    for port in [c["apiPort"]]:
        matches = [
            line.split()[3]
            for line in listeners
            if line.split()[3].endswith(":" + str(port))
        ]
        if matches != ["127.0.0.1:" + str(port)]:
            raise ValueError("Private listener confinement failed")
    if not os.path.exists(p["run"] + "/postgres/.s.PGSQL.5432"):
        raise ValueError("Private database socket unavailable")
    if any(
        line.split()[3].endswith(":" + str(c["databasePort"])) for line in listeners
    ):
        raise ValueError("Unexpected database TCP publication")
    context = ssl.create_default_context(cafile=c.get("extraCaFile"))
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({}), urllib.request.HTTPSHandler(context=context)
    )
    deadline = time.monotonic() + 20
    while True:
        try:
            with opener.open(c["origin"] + "/health", timeout=3) as response:
                if response.status != 200:
                    raise ValueError("HTTPS health unavailable")
            break
        except (OSError, urllib.error.URLError):
            if time.monotonic() > deadline:
                raise ValueError(
                    "Certificate-verified HTTPS readiness unavailable"
                ) from None
            time.sleep(0.2)
    status = db(c, release, "status")
    return {
        "services": "ready",
        "https": "verified",
        "privateListeners": "loopback-only",
        "runtimeAccount": (
            "configured" if status["accountConfigured"] else "unconfigured"
        ),
        "deployment": status["deployment"],
    }


def maintenance(c, interrupt=False, deadlineSeconds=60):
    release, state = selected(c)
    db(c, release, "maintenance", enabled=True)
    if interrupt:
        db(c, release, "interrupt")
    deadline = time.monotonic() + deadlineSeconds
    while True:
        status = db(c, release, "status")
        if not (
            status["active"] or status["pendingStorage"] or status["pendingRecovery"]
            or status["activeFiles"] or status["uncertainFiles"]
            or status["pendingFileInspections"] or status["activeTerminals"]
            or status["activeScheduleEffects"] or status["activePreviews"]
        ):
            break
        if time.monotonic() > deadline:
            raise ValueError("Drain incomplete; maintenance remains active")
        time.sleep(0.25)
    # Stopping supervisor control groups retires attached transports, then durable
    # launcher identities are independently reconciled before filesystem checkpoint.
    service(c, "stop", ["api", "supervisor", "storage"])
    registry = db(c, release, "registry")
    env = environment(c, release, "supervisor")
    run(
        [
            release + "/bin/node",
            "--import",
            release + "/node_modules/tsx/dist/loader.mjs",
            release + "/infra/deploy/retire.ts",
        ],
        input=json.dumps(registry).encode(),
        env=env,
        timeout=120,
    )
    return release, registry


def inspect_allocations(c):
    release, _ = selected(c)
    registry = db(c, release, "registry")
    unregistered = []
    for root in c["roots"]:
        known = {
            os.path.dirname(p["canonical_path"])
            for p in registry["projects"]
            if p["root_id"] == root["id"]
        }
        for name in sorted(os.listdir(root["path"])):
            unit = root["path"] + "/" + name
            if unit in known:
                continue
            s = os.lstat(unit)
            if os.path.realpath(unit) != unit or not __import__("stat").S_ISDIR(
                s.st_mode
            ):
                raise ValueError("Unexpected managed root inode; no adoption permitted")
            unregistered.append(
                {
                    "rootId": root["id"],
                    "managedName": name,
                    "device": str(s.st_dev),
                    "inode": str(s.st_ino),
                    "registrationPath": name + "/workspace",
                }
            )
    if len(unregistered) > 64:
        raise ValueError("Unregistered allocation count bound")
    return {
        "registeredProjects": len(registry["projects"]),
        "unregistered": unregistered,
        "action": "Inspect exact quota identity and use owner existing-project registration; no automatic adoption or deletion",
    }


def status(c):
    p = layout(c["instance"])
    record = json.load(open(p["state"] + "/installation.json"))
    roles = {}
    for role in ["dependencies", *ROLES]:
        try:
            roles[role] = run(
                [
                    "systemctl",
                    "show",
                    "--property=ActiveState",
                    "--value",
                    p["unit"] + "-" + role + ".service",
                ]
            ).strip()
        except RuntimeError:
            roles[role] = "unavailable"
    try:
        release, _ = selected(c)
        ready = readiness(c, release)
    except Exception:
        ready = {
            "services": "unavailable",
            "admission": "unverified",
            "reason": "Selected artifact, dependency, filesystem or application validation failed; use preflight and exact service diagnostics",
        }
    return {"installation": record, "serviceStates": roles, "readiness": ready}


def recover_runtime(c, project_id, session_id, generation, lock_inode, acknowledged):
    if not acknowledged:
        raise ValueError("Explicit unknown-effects acknowledgement required")
    release, _ = selected(c)
    db(c, release, "maintenance", enabled=True)
    db(c, release, "interrupt")
    service(c, "stop")
    env = environment(c, release, "supervisor")
    return json.loads(
        run(
            [
                release + "/bin/node",
                "--import",
                release + "/node_modules/tsx/dist/loader.mjs",
                release + "/infra/deploy/recover-runtime.ts",
            ],
            input=json.dumps(
                {
                    "projectId": project_id,
                    "sessionId": session_id,
                    "generation": generation,
                    "lockInode": lock_inode,
                    "acknowledged": True,
                }
            ).encode(),
            env=env,
            timeout=120,
        )
    )
