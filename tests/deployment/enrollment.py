"""Actual root CLI/public SFTP checks. Never initializes or transfers Harbor state."""

import base64
import hashlib
import json
import os
from pathlib import Path
import subprocess
import platform
import sys

assert os.getuid() == 0 and sys.platform == "linux"
source = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(source / "infra/deploy"))
from config import load, layout
from destination import local_identity

config_path = os.environ["HARBOR_DEPLOY_CONFIG"]
c = load(config_path)
control = Path(os.environ["HARBOR_ENROLLMENT_CONTROL"])
control.mkdir(mode=0o700, exist_ok=False)
public_key = os.environ["HARBOR_TEST_SFTP_HOST_KEY"]
profile = {
    "destination": {
        "host": os.environ["HARBOR_TEST_SFTP_HOST"],
        "port": int(os.environ["HARBOR_TEST_SFTP_PORT"]),
        "user": os.environ["HARBOR_TEST_SFTP_USER"],
        "path": os.environ["HARBOR_TEST_SFTP_PATH"],
        "sshKey": os.environ["HARBOR_PUBLIC_PROBE_SSH_KEY"],
        "knownHosts": os.environ["HARBOR_PUBLIC_PROBE_KNOWN_HOSTS"],
        "passwordFile": c["backup"]["passwordFile"],
    },
    "targetHostId": os.environ["HARBOR_TEST_SFTP_HOST_ID"],
    "hostKeySha256": hashlib.sha256(base64.b64decode(public_key)).hexdigest(),
}
# A new path for the same public pin makes an explicit new enrollment version.
known = control / "known-hosts"
known.write_bytes(Path(profile["destination"]["knownHosts"]).read_bytes())
known.chmod(0o600)
profile["destination"]["knownHosts"] = str(known)
profile_path = control / "destination.json"


def component_identity():
    files = sorted(
        [
            p
            for p in (source / "infra/deploy").rglob("*")
            if p.is_file() and "__pycache__" not in p.parts
        ]
        + [Path(__file__).resolve()]
    )
    digest = hashlib.sha256()
    for file in files:
        digest.update(
            (
                str(file.relative_to(source))
                + "\0"
                + hashlib.sha256(file.read_bytes()).hexdigest()
                + "\n"
            ).encode()
        )
    return {
        "algorithm": "sha256-path-and-content-v1",
        "files": len(files),
        "digest": digest.hexdigest(),
    }


component = component_identity()
installation = json.loads(
    (Path(layout(c["instance"])["state"]) / "installation.json").read_text()
)


def write(value):
    profile_path.write_text(json.dumps(value))
    profile_path.chmod(0o600)


write(profile)
command = ["python3", str(source / "infra/deploy/harborctl"), "--config", config_path]


def cli(args, success=True, prefix=[]):
    result = subprocess.run(
        [*prefix, *command, *args], capture_output=True, text=True, timeout=70
    )
    assert (result.returncode == 0) == success, "Administrator CLI outcome mismatch"
    return json.loads(result.stdout) if success else None


initial = cli(["backup-destination-status"])
prior = initial["destinationId"] or "none"
cli(
    [
        "backup-destination-enroll",
        "--profile",
        str(profile_path),
        "--expected-current",
        prior,
    ],
    False,
    [
        "setpriv",
        "--reuid",
        str(c["apiUid"]),
        "--regid",
        str(c["apiUid"]),
        "--clear-groups",
    ],
)
write({**profile, "targetHostId": local_identity()[0]})
cli(
    [
        "backup-destination-enroll",
        "--profile",
        str(profile_path),
        "--expected-current",
        prior,
    ],
    False,
)
write(profile)
first = cli(
    [
        "backup-destination-enroll",
        "--profile",
        str(profile_path),
        "--expected-current",
        prior,
    ]
)
assert first["transportAdmitted"] and not first["repositoryInitialized"]
record = Path(layout(c["instance"])["state"]) / "backup-destinations.json"
before = record.read_bytes()
retry = cli(
    [
        "backup-destination-enroll",
        "--profile",
        str(profile_path),
        "--expected-current",
        prior,
    ]
)
assert retry["reconciled"] and retry["destinationId"] == first["destinationId"]
assert record.read_bytes() == before
write({**profile, "targetHostId": "e" * 64})
cli(
    [
        "backup-destination-enroll",
        "--profile",
        str(profile_path),
        "--expected-current",
        "none",
    ],
    False,
)
assert record.read_bytes() == before
# Deliberately wrong authentication fixture: public invalid key bytes, no real
# private key rotation and no repository operation. Failed probe retains admission.
invalid = control / "invalid-key"
invalid.write_text("public invalid SSH key fixture\n")
invalid.chmod(0o600)
write({**profile, "destination": {**profile["destination"], "sshKey": str(invalid)}})
cli(
    [
        "backup-destination-enroll",
        "--profile",
        str(profile_path),
        "--expected-current",
        first["destinationId"],
    ],
    False,
)
assert record.read_bytes() == before
write(profile)
status = cli(["backup-destination-status"])
assert status["repositoryReadiness"] == "not-yet-initialized-or-verified"
assert component_identity() == component
result = {
    "sourceComponent": component,
    "sourceCliSha256": hashlib.sha256(
        (source / "infra/deploy/harborctl").read_bytes()
    ).hexdigest(),
    "installedArtifact": installation["artifact"],
    "instance": c["instance"],
    "executionRelationship": "new source CLI against prior immutable installed services; not a new packaged artifact",
    "command": "python3 tests/deployment/enrollment.py (fixed root CLI/public nonce cases)",
    "python": platform.python_version(),
    "actualRootCli": True,
    "apiUidDenied": True,
    "sameHostDenied": True,
    "publicSftpRoundtrip": True,
    "exactRetryReconciled": True,
    "staleCasDenied": True,
    "failedAuthenticationPreservedRecord": True,
    "repositoryInitialized": False,
    "protectedTransfer": False,
    "destinationId": first["destinationId"],
}
(control / "result.json").write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps(result))
