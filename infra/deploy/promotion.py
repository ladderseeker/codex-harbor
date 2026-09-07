"""Promotion consumes an authenticated package and a verified quiesced checkpoint."""

import json, time
from config import layout
from common import atomic
from artifact import install, verify
from backup import checkpoint
from control import selected, db, service, await_readiness
from services import write
from preflight import preflight


def compatible(current, candidate, rollback=False):
    for field in [
        "format",
        "backupSchema",
        "configurationSchema",
        "nativeCompatibility",
        "architecture",
    ]:
        if current[field] != candidate[field]:
            raise ValueError("Incompatible release requires explicit fresh restore")
    old = sorted(current["migrations"].items())
    new = sorted(candidate["migrations"].items())
    if rollback:
        if old != new:
            raise ValueError(
                "Incompatible downgrade refused; restore the prior verified checkpoint"
            )
    elif any(candidate["migrations"].get(name) != sha for name, sha in old):
        raise ValueError("Migration history is not a compatible extension")
    elif old and any(
        name < old[-1][0] and name not in current["migrations"]
        for name in candidate["migrations"]
    ):
        supported = any(
            p.get("artifact") == current["artifact"]
            and p.get("migrations") == current["migrations"]
            and p.get("orderPolicy") == "explicit-supported-predecessor"
            for p in candidate.get("supportedPredecessors", [])
        )
        if not supported:
            raise ValueError(
                "Lower-ID migration addition requires an explicit supported predecessor record"
            )


def promote(c, archive, sha, rollback=False, interrupt=False, resume=False):
    selected_release, state = selected(c)
    candidate, m = install(archive, sha)
    p = layout(c["instance"])
    if state["state"] == "promoting":
        if (
            not resume
            or state["artifact"] != m["artifact"]
            or state["archiveSha256"] != sha
            or state["rollback"] != rollback
        ):
            raise ValueError("Exact pending promotion resume required")
        previous = state["previousRelease"]
        old = verify(previous, state["previousArtifact"])
        compatible(old, m, rollback)
        backup = state["checkpoint"]
        saved = json.load(open(p["state"] + "/backups/" + backup["snapshot"] + ".json"))
        if saved != backup or not saved.get("verified"):
            raise ValueError("Verified promotion checkpoint identity unavailable")
        pending = state
        original = {"maintenance": state["originalMaintenance"]}
    else:
        if resume:
            raise ValueError("No pending promotion exists")
        if state["state"] != "installed":
            raise ValueError("Only an installed instance can be promoted")
        previous = selected_release
        old = verify(previous)
        compatible(old, m, rollback)
        preflight(c, candidate)
        original = db(c, previous, "status")["deployment"]
        if original["activation_required"]:
            raise ValueError(
                "Disabled restored instance cannot be promoted before validated activation"
            )
        backup = checkpoint(c, interrupt)
        pending = {
            **state,
            "state": "promoting",
            "previousRelease": previous,
            "previousArtifact": old["artifact"],
            "release": candidate,
            "artifact": m["artifact"],
            "archiveSha256": sha,
            "checkpoint": backup,
            "startedAt": time.time(),
            "rollback": rollback,
            "originalMaintenance": original["maintenance"],
        }
        atomic(p["state"] + "/installation.json", pending)
    # A process-loss retry retains the same verified pre-migration checkpoint.
    # It cannot create a second checkpoint from partially migrated candidate state.
    preflight(c, candidate)
    service(c, "stop")
    write(c, candidate)
    service(c, "restart", ["dependencies"])
    db(c, candidate, "migrate")
    service(c, "start")
    await_readiness(c, candidate)
    pending["state"] = "installed"
    pending["completedAt"] = time.time()
    atomic(p["state"] + "/installation.json", pending)
    if not original["maintenance"]:
        db(c, candidate, "maintenance", enabled=False)
    return {
        "promoted": True,
        "rollback": rollback,
        "artifact": m["artifact"],
        "previousArtifact": old["artifact"],
        "checkpoint": backup,
        "maintenance": original["maintenance"],
    }
