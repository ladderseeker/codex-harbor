"""Root-only future-backup enrollment; restore-source authority stays independent."""

import base64
import hashlib
import json
import os
import re
import tempfile
import time
import uuid
from pathlib import Path

from common import atomic, digest, run
from config import DIGEST, layout, trusted, validate_backup
from ssh_policy import options as ssh_options


def source_identity(backup):
    validate_backup(backup)
    for name, limit in [
        ("sshKey", 16384),
        ("knownHosts", 65536),
        ("passwordFile", 1024),
    ]:
        if not 0 < os.stat(backup[name]).st_size <= limit:
            raise ValueError("Protected destination file bound")
    return {
        "configuration": backup,
        "files": {
            key: digest(backup[key]) for key in ["sshKey", "knownHosts", "passwordFile"]
        },
    }


def local_identity():
    machine = Path("/etc/machine-id").read_bytes().strip()
    if not re.fullmatch(b"[a-f0-9]{32}", machine):
        raise ValueError("Local host identity unavailable")
    public = Path("/etc/ssh/ssh_host_ed25519_key.pub").read_text().split()
    if len(public) < 2 or public[0] != "ssh-ed25519":
        raise ValueError("Local SSH identity unavailable")
    return (
        hashlib.sha256(machine).hexdigest(),
        hashlib.sha256(base64.b64decode(public[1], validate=True)).hexdigest(),
    )


def validate_profile(profile):
    if set(profile) != {"destination", "targetHostId", "hostKeySha256"} or not all(
        DIGEST.fullmatch(profile.get(k, "")) for k in ["targetHostId", "hostKeySha256"]
    ):
        raise ValueError("Explicit destination host identity required")
    backup = profile["destination"]
    identity = source_identity(backup)
    host, key = local_identity()
    if host == profile["targetHostId"] or key == profile["hostKeySha256"]:
        raise ValueError("Backup destination is this host")
    authority = (
        backup["host"]
        if backup["port"] == 22
        else f'[{backup["host"]}]:{backup["port"]}'
    )
    lines = run(
        ["ssh-keygen", "-F", authority, "-f", backup["knownHosts"]]
    ).splitlines()
    keys = [line.split() for line in lines if line and not line.startswith("#")]
    if len(keys) != 1 or len(keys[0]) != 3 or keys[0][1] != "ssh-ed25519":
        raise ValueError("One exact Ed25519 host-key pin required")
    if (
        hashlib.sha256(base64.b64decode(keys[0][2], validate=True)).hexdigest()
        != profile["hostKeySha256"]
    ):
        raise ValueError("Destination host-key identity mismatch")
    return {**profile, "sourceHostId": host, "files": identity["files"]}


def public_probe(backup):
    """No Harbor payload, repository keys, shell execution or implicit init."""
    remote = backup["path"] + "/harbor-public-enrollment-" + uuid.uuid4().hex
    with tempfile.TemporaryDirectory(prefix="harbor-public-enrollment-") as temporary:
        upload, received = Path(temporary) / "public", Path(temporary) / "received"
        payload = ("Harbor public transport nonce " + uuid.uuid4().hex + "\n").encode()
        upload.write_bytes(payload)
        command = [
            "sftp",
            *ssh_options(backup),
            "-q",
            "-b",
            "-",
            "-P",
            str(backup["port"]),
            backup["user"] + "@" + backup["host"],
        ]
        try:
            run(
                command,
                input=f'put "{upload}" "{remote}"\nget "{remote}" "{received}"\nrm "{remote}"\n'.encode(),
                timeout=30,
                capture_limit=65536,
            )
            if received.read_bytes() != payload:
                raise ValueError("Public destination roundtrip mismatch")
        except Exception:
            # Exact public nonce only. Unknown cleanup is a failed enrollment.
            run(
                command,
                input=f'-rm "{remote}"\n'.encode(),
                timeout=15,
                capture_limit=65536,
            )
            raise
        return {"publicRoundtrip": True}


def state(c):
    path = layout(c["instance"])["state"] + "/backup-destinations.json"
    if not os.path.exists(path):
        return {"format": 1, "current": None, "versions": []}
    trusted(path, private=True, file=True)
    value = json.loads(Path(path).read_text())
    if value.get("format") != 1 or len(value.get("versions", [])) > 16:
        raise ValueError("Destination ledger invalid")
    return value


def enroll(c, profile_path, expected):
    if expected != "none" and not DIGEST.fullmatch(expected):
        raise ValueError("Exact current destination required")
    trusted(profile_path, private=True, file=True)
    if os.stat(profile_path).st_size > 16384:
        raise ValueError("Destination profile limit")
    binding = validate_profile(json.loads(Path(profile_path).read_text()))
    identity = hashlib.sha256(
        json.dumps(
            {"binding": binding, "previous": expected},
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
    ).hexdigest()
    ledger = state(c)
    if ledger["current"] == identity:
        return {"destinationId": identity, "reconciled": True}
    if (ledger["current"] or "none") != expected:
        raise ValueError("Destination changed; stale enrollment refused")
    if len(ledger["versions"]) >= 16:
        raise ValueError("Destination history capacity reached")
    probe = public_probe(binding["destination"])
    # Revalidate after network waits; private input file replacement is not silent.
    if validate_profile(json.loads(Path(profile_path).read_text())) != binding:
        raise ValueError("Destination authority changed during probe")
    record = {
        "id": identity,
        "binding": binding,
        "probe": probe,
        "createdAt": time.time(),
    }
    ledger["versions"].append(record)
    ledger["current"] = identity
    atomic(layout(c["instance"])["state"] + "/backup-destinations.json", ledger)
    return {
        "destinationId": identity,
        "transportAdmitted": True,
        "repositoryReadiness": "not-yet-initialized-or-verified",
        "repositoryInitialized": False,
    }


def for_backup(c, allow_unverified=False):
    ledger = state(c)
    entry = next((v for v in ledger["versions"] if v["id"] == ledger["current"]), None)
    if entry is None:
        raise ValueError("Future backup destination enrollment required")
    binding = entry["binding"]
    current = validate_profile(
        {k: binding[k] for k in ["destination", "targetHostId", "hostKeySha256"]}
    )
    if current != binding:
        raise ValueError("Backup authority changed; explicit re-enrollment required")
    if not allow_unverified and not entry.get("repositoryId"):
        raise ValueError("Backup repository is not initialized and verified")
    return {**c, "backup": binding["destination"]}


def verify_repository(c, release, expected):
    ledger = state(c)
    if ledger["current"] != expected:
        raise ValueError("Destination changed; stale repository verification refused")
    chosen = for_backup(c, allow_unverified=True)
    from backup import restic

    repository = json.loads(restic(chosen, release, ["cat", "config"], timeout=30))
    if not isinstance(repository, dict) or not DIGEST.fullmatch(
        repository.get("id", "")
    ):
        raise ValueError("Authenticated repository identity unavailable")
    entry = next(v for v in ledger["versions"] if v["id"] == expected)
    if entry.get("repositoryId") and entry["repositoryId"] != repository["id"]:
        raise ValueError("Repository identity changed")
    entry["repositoryId"] = repository["id"]
    atomic(layout(c["instance"])["state"] + "/backup-destinations.json", ledger)
    return {
        "destinationId": expected,
        "repositoryInitialized": True,
        "repositoryId": repository["id"],
    }


def status(c):
    ledger = state(c)
    entry = next((v for v in ledger["versions"] if v["id"] == ledger["current"]), None)
    return {
        "destinationId": ledger["current"],
        "transportAdmitted": bool(entry),
        "repositoryReadiness": (
            "verified"
            if entry and entry.get("repositoryId")
            else "not-yet-initialized-or-verified" if entry else "not-enrolled"
        ),
    }
