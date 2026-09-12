"""Actual installed runner retirement with injected stale private lock/crash state."""

import json
import os
from pathlib import Path
import select
import signal
import subprocess
import sys
import time

source = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(source / "infra/deploy"))
from config import load
from control import selected, service, db
from services import environment

assert sys.platform == "linux" and os.getuid() == 0
c = load(os.environ["HARBOR_DEPLOY_CONFIG"])
release, installation = selected(c)
control = Path(os.environ["HARBOR_RUNTIME_LOCK_CONTROL"])
control.mkdir(mode=0o700, exist_ok=False)
record = control / "preview.json"
env = environment(c, release, "supervisor")
env["HARBOR_RECOVERY_TEST_RECORD"] = str(record)
node = [
    release + "/bin/node",
    "--import",
    release + "/node_modules/tsx/dist/loader.mjs",
    str(source / "tests/previews/recovery.ts"),
]


def run(args, success=True, timeout=90):
    result = subprocess.run(
        args, env=env, capture_output=True, text=True, timeout=timeout
    )
    assert (
        result.returncode == 0
    ) == success, "Owned recovery command outcome mismatch"
    return result.stdout


# Stop only this disposable fixture's services. DB dependencies remain available.
db(c, release, "maintenance", enabled=True)
service(c, "stop")
run(node + ["setup"])
runtime = json.loads(record.read_text())
name = f'harbor-{c["instance"]}-{runtime["sessionId"]}-{runtime["generation"]}'
key = f'{c["instance"]}-{runtime["projectId"]}-{runtime["sessionId"]}'
lock = Path(env["HARBOR_LAUNCHER_STATE_DIR"]) / (key + ".lock")
ledger = Path(env["HARBOR_LAUNCHER_STATE_DIR"]) / (key + ".json")
child = subprocess.Popen(
    node + ["launch"],
    env=env,
    stdout=subprocess.PIPE,
    stderr=open(control / "runtime-stderr.log", "wb"),
)
try:
    assert select.select([child.stdout], [], [], 60)[
        0
    ], "Installed initializer deadline"
    assert child.stdout.readline().strip() == b"INITIALIZED"
    # Exact fault injection: pause the real container and retain a stale private
    # lock before killing its owner; no claim that ordinary initialize leaves it.
    run(["docker", "pause", name])
    lock.mkdir(mode=0o700)
    inode = lock.stat().st_ino
    before = ledger.read_bytes()
    child.kill()
    child.wait(timeout=10)
    cli = [
        release + "/bin/harborctl",
        "--config",
        os.environ["HARBOR_DEPLOY_CONFIG"],
        "recover-runtime",
        "--project-id",
        runtime["projectId"],
        "--session-id",
        runtime["sessionId"],
        "--generation",
        str(runtime["generation"]),
        "--lock-inode",
    ]
    run(cli + [str(inode)], success=False)
    assert lock.exists()
    run(cli + [str(inode + 1), "--acknowledge-unknown-effects"], success=False)
    assert lock.exists() and ledger.read_bytes() == before
    result = json.loads(run(cli + [str(inode), "--acknowledge-unknown-effects"]))
    assert result["retired"] and result["lockRecovered"]
    assert not lock.exists() and ledger.read_bytes() == before
    assert (
        subprocess.run(["docker", "inspect", name], capture_output=True).returncode != 0
    )
    assert subprocess.run(["docker", "inspect", f'harbor-preview-relay-{runtime["previewId"]}-{runtime["generation"]}'], capture_output=True).returncode != 0
    run(node + ["launch"], success=False)
    run(node + ["check"])
    evidence = {
        "installedArtifact": installation["artifact"],
        "realPinnedRuntime": "0.153.4",
        "fault": "injected stale lock + paused owned container + owner SIGKILL",
        "acknowledgementRequired": True,
        "wrongInodeRejected": True,
        "ownedRetirementConfirmed": True,
        "generationLedgerPreserved": True,
        "staleGenerationRejected": True,
        "previewGrantsRevoked": True,
        "originalUncertaintyHistoricallyPreserved": True,
        "exactPreviewReaderReleased": True,
        "wholeRunnerAndRelayRetired": True,
        "modelRequests": 0,
        "backupTransfer": False,
    }
    (control / "result.json").write_text(json.dumps(evidence, indent=2) + "\n")
    print(json.dumps(evidence))
finally:
    if child.poll() is None:
        child.kill()
        child.wait(timeout=10)
    # Failure preserves its exact owned runtime/lock evidence for explicit repair;
    # do not silently clear fencing or resume the service.
