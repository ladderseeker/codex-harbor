"""Fresh disabled restore. Source configuration and launcher ledgers never regain authority."""

import os, json, uuid, stat, shutil, time, hashlib
from common import atomic, run, digest
from config import layout
from artifact import install, verify
from control import initialize, selected, db, service, await_readiness
from extract import extract
from publish import publish, flush


def validate(registry, c, manifest, owner_rebind=False):
    if not owner_rebind and (
        registry.get("ownerIssuer"),
        registry.get("ownerSubject"),
    ) != (c.get("oidcIssuer"), c.get("ownerSubject")):
        raise ValueError(
            "Owner rebinding requires explicit administrator acknowledgement"
        )
    if registry.get("instance") == c["instance"]:
        raise ValueError("Restore requires a new instance namespace")
    for key in [
        "backupSchema",
        "nativeCompatibility",
        "architecture",
        "configurationSchema",
    ]:
        if registry.get(key) != manifest.get(key):
            raise ValueError("Checkpoint compatibility is unavailable")
    # A fresh restore uses an exact schema. Forward migration is a separate promotion.
    if registry.get("migrations") != manifest["migrations"]:
        raise ValueError("Restore requires the exact checkpoint schema")
    if {r["id"] for r in c["roots"]} != {r["id"] for r in registry.get("roots", [])}:
        raise ValueError(
            "Destination root mapping must cover the authenticated registry exactly"
        )
    classes = [u["class"] for u in registry["units"]]
    for kind in ["configuration", "historical-authority", "caddy-data", "caddy-config"]:
        if classes.count(kind) != 1:
            raise ValueError("Required restore inventory class missing")
    if any(
        kind
        not in [
            "project",
            "configuration",
            "historical-authority",
            "caddy-data",
            "caddy-config",
        ]
        for kind in classes
    ):
        raise ValueError("Unknown restore inventory class")
    if {u["id"] for u in registry["units"] if u["class"] == "project"} != {
        p["id"] for p in registry["database"]["projects"]
    }:
        raise ValueError("Project inventory mismatch")


def restore(c, archive, sha, snapshot, registry_sha, resume=False, owner_rebind=False):
    p = layout(c["instance"])
    statepath = p["state"] + "/restore.json"
    old = json.load(open(statepath)) if os.path.exists(statepath) else None
    if old and not resume:
        raise ValueError("Restore exists; explicit same-operation resume required")
    if resume and not old:
        raise ValueError("No interrupted restore exists")
    identity = {
        "ownerRebind": owner_rebind,
        "archiveSha256": sha,
        "snapshot": snapshot,
        "registrySha256": registry_sha,
    }
    if old and any(old[k] != v for k, v in identity.items()):
        raise ValueError("Restore input identity changed")
    if not old:
        if os.path.exists(p["state"] + "/installation.json"):
            raise ValueError("Restore requires a fresh disabled instance")
        old = {
            "format": 1,
            "id": str(uuid.uuid4()),
            **identity,
            "state": "preparing",
            "createdAt": time.time(),
        }
        atomic(statepath, old)
    if old["state"] == "preparing":
        installation_path = p["state"] + "/installation.json"
        installation = (
            json.load(open(installation_path))
            if os.path.exists(installation_path)
            else None
        )
        if not installation or installation["state"] == "installing":
            initialize(c, archive, sha, resume=bool(installation), disabled=True)
        elif installation["state"] != "restoring":
            raise ValueError("Unexpected restore installation state")
        old["state"] = "extracting"
        atomic(statepath, old)
    release, installation = selected(c)
    manifest = verify(release)
    if installation["state"] not in ["restoring", "restored-disabled"]:
        raise ValueError("Restore cannot mutate an admitted installation")
    service(c, "stop")
    stage = p["state"] + "/staging/restore-" + old["id"]
    os.makedirs(stage, mode=0o700, exist_ok=True)
    if old["state"] == "extracting":
        # Only this operation's root-owned staging is disposable. No destination unit
        # has been published before the authenticated inventory is durable.
        if os.listdir(stage):
            shutil.rmtree(stage)
            os.mkdir(stage, 0o700)
        registry = extract(c, release, snapshot, registry_sha, stage)
        validate(registry, c, manifest, old["ownerRebind"])
        flush(stage)
        atomic(p["state"] + "/restore-registry.json", registry)
        old["state"] = "publishing"
        atomic(statepath, old)
    registry = json.load(open(p["state"] + "/restore-registry.json"))
    validate(registry, c, manifest, old["ownerRebind"])
    if old["state"] == "publishing":
        bindings = publish(c, release, registry, stage, old, statepath)
        old["bindings"] = bindings
        old["state"] = "database"
        atomic(statepath, old)
    if old["state"] == "database":
        # Repeating this phase first clears this fresh, disabled database. The schema
        # was installed from the authenticated artifact; source schema SQL is excluded.
        db(c, release, "prepare-restore")
        dump = stage + registry["dump"]["path"]
        if digest(dump) != registry["dump"]["sha256"]:
            raise ValueError("Staged database identity changed")
        if os.stat(dump).st_size > 512 * 1024**2:
            raise ValueError("Database restore bound")
        with open(dump, "rb") as source:
            run(
                [
                    "docker",
                    "compose",
                    "-f",
                    p["etc"] + "/compose.json",
                    "exec",
                    "-T",
                    "postgres",
                    "pg_restore",
                    "-U",
                    "harbor",
                    "-d",
                    "harbor",
                    "--data-only",
                    "--no-owner",
                    "--no-privileges",
                    "--exit-on-error",
                    "--single-transaction",
                ],
                input_file=source,
                timeout=120,
            )
        old["state"] = "rebinding"
        atomic(statepath, old)
    if old["state"] == "rebinding":
        unit = next(u for u in registry["units"] if u["class"] == "configuration")
        key = stage + unit["path"] + "/model.key"
        s = os.lstat(key)
        if not stat.S_ISREG(s.st_mode) or s.st_uid != 0 or s.st_size != 32:
            raise ValueError("Protected recovery key unavailable")
        db(
            c,
            release,
            "restore-rebind",
            restoreId=old["id"],
            sourceInstance=registry["instance"],
            sourceOwner=registry["ownerSubject"],
            oldKeyFile=key,
            **old["bindings"]
        )
        old["state"] = "disabled"
        atomic(statepath, old)
    installation.update(
        state="restored-disabled",
        restoreId=old["id"],
        sourceInstance=registry["instance"],
        snapshot=snapshot,
    )
    atomic(p["state"] + "/installation.json", installation)
    # Historical protected configuration/authority stays only in private staging;
    # fresh service paths retain new secrets, instance identity and empty ledgers.
    return {
        "restored": True,
        "disabled": True,
        "restoreId": old["id"],
        "artifact": manifest["artifact"],
        "snapshot": snapshot,
    }


def activate(c, restore_id):
    p = layout(c["instance"])
    release, installation = selected(c)
    if (
        installation["state"] != "restored-disabled"
        or installation.get("restoreId") != restore_id
    ):
        raise ValueError("Exact disabled restore acknowledgement required")
    journal = json.load(open(p["state"] + "/restore.json"))
    if journal["state"] != "disabled" or journal["id"] != restore_id:
        raise ValueError("Restore publication incomplete")
    registry = json.load(open(p["state"] + "/restore-registry.json"))
    status = db(c, release, "status")["deployment"]
    if not status["activation_required"]:
        if (
            journal.get("activationPhase") != "activating"
            or status["restored_from"] != registry["instance"]
        ):
            raise ValueError("Unexpected admitted restore state")
        installation.update(state="installed", activatedAt=time.time())
        atomic(p["state"] + "/installation.json", installation)
        service(c, "enable", ["dependencies", "storage", "supervisor", "api"])
        return {"activated": True, "restoreId": restore_id, "reconciled": True}
    from services import environment

    env = environment(c, release, "supervisor")
    # Reconcile possible read-probe processes from an interrupted activation first.
    run(
        [
            release + "/bin/node",
            "--import",
            release + "/node_modules/tsx/dist/loader.mjs",
            release + "/infra/deploy/retire.ts",
        ],
        input=json.dumps(registry["database"]).encode(),
        env=env,
        timeout=120,
    )
    # Native initialization may write its own caches after the first durable exact
    # validation. Project/common/attachment content remains byte-validated on retry.
    bindings = publish(
        c,
        release,
        registry,
        p["state"] + "/staging/restore-" + restore_id,
        journal,
        p["state"] + "/restore.json",
        native_probe_started=journal.get("activationPhase")
        in ["probing", "activating"],
    )
    if bindings != journal["bindings"]:
        raise ValueError("Restored identity binding changed")
    attempts = journal.setdefault("probeAttempts", [])
    if len(attempts) >= 8:
        raise ValueError(
            "Native validation attempt bound; fresh restore or administrator diagnosis required"
        )
    from backup import inventory

    fingerprint = lambda: [
        {
            "projectId": n["projectId"],
            "sessionId": n["sessionId"],
            "sha256": hashlib.sha256(
                json.dumps(
                    inventory(n["canonical"]), sort_keys=True, separators=(",", ":")
                ).encode()
            ).hexdigest(),
        }
        for n in bindings["nativeIdentities"]
    ]
    attempt = {"id": str(uuid.uuid4()), "before": fingerprint(), "state": "probing"}
    attempts.append(attempt)
    journal["activationPhase"] = "probing"
    atomic(p["state"] + "/restore.json", journal)
    report = json.loads(
        run(
            [
                release + "/bin/node",
                "--import",
                release + "/node_modules/tsx/dist/loader.mjs",
                release + "/infra/deploy/probe.ts",
            ],
            env=env,
            timeout=960,
        )
    )
    attempt.update(state="validated", after=fingerprint(), semantic=report)
    atomic(p["state"] + "/restore.json", journal)
    service(c, "start")
    await_readiness(c, release)
    journal["activationPhase"] = "activating"
    journal["activationReport"] = report
    atomic(p["state"] + "/restore.json", journal)
    db(c, release, "activate")
    installation.update(
        state="installed", activationReport=report, activatedAt=time.time()
    )
    atomic(p["state"] + "/installation.json", installation)
    service(c, "enable", ["dependencies", "storage", "supervisor", "api"])
    return {"activated": True, "restoreId": restore_id, "validation": report}
