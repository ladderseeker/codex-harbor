"""Explicit disposable installed-instance test. No backup, migration or model work."""

import argparse, hashlib, json, os, pathlib, signal, subprocess, sys, time

sys.dont_write_bytecode = True
parser = argparse.ArgumentParser()
parser.add_argument("--source", required=True)
parser.add_argument("--config", required=True)
parser.add_argument("--instance", required=True)
parser.add_argument("--output", required=True)
a = parser.parse_args()
sys.path.insert(0, a.source + "/infra/deploy")
from config import load, layout
from control import db, selected, service
from common import run

c = load(a.config)
assert c["instance"] == a.instance
p = layout(a.instance)
release, installation = selected(c)


def preserved_state():
    registry = db(c, release, "registry")
    return {
        "sessions": [
            {k: row.get(k) for k in ["id", "state", "native_thread_id", "workspace_id"]}
            for row in registry["sessions"]
        ],
        "writers": [
            {k: row.get(k) for k in ["id", "writer_session_id", "writer_generation"]}
            for row in registry["workspaces"]
        ],
    }


original_history = preserved_state()
initial = db(c, release, "status")
assert (
    initial["deployment"]["maintenance"]
    and not initial["deployment"]["activation_required"]
)
assert (
    not initial["active"]
    and not initial["pendingStorage"]
    and not initial["pendingRecovery"]
)
unit = p["unit"] + "-api.service"
unit_file = pathlib.Path("/etc/systemd/system/" + unit)
unit_hash = hashlib.sha256(unit_file.read_bytes()).hexdigest()
config_hash = hashlib.sha256(pathlib.Path(a.config).read_bytes()).hexdigest()
original = [
    line[10:]
    for line in unit_file.read_text().splitlines()
    if line.startswith("ExecStart=")
]
assert len(original) == 1 and original[0].startswith(
    release + "/bin/node --import tsx "
)
assert all(ch not in original[0] for ch in "'\n\r$`;")
dropdir = pathlib.Path("/etc/systemd/system/" + unit + ".d")
assert not dropdir.exists(), "Existing administrator override must remain untouched"
result = {
    "instance": a.instance,
    "installedArtifact": installation["artifact"],
    "componentSha256": hashlib.sha256(
        pathlib.Path(a.source + "/infra/deploy/harborctl").read_bytes()
    ).hexdigest(),
    "cases": [],
    "noBackupOrTransfer": True,
}


def disabled():
    try:
        db(c, release, "maintenance", enabled=True)
    finally:
        service(c, "stop", ["api", "supervisor", "storage"])


def delay(seconds):
    dropdir.mkdir(mode=0o755, exist_ok=True)
    (dropdir / "resume-test.conf").write_text(
        "[Service]\nExecStart=\nExecStart=/bin/sh -c 'sleep "
        + str(seconds)
        + "; exec "
        + original[0]
        + "'\n"
    )
    run(["systemctl", "daemon-reload"])


def execute(name, expected, inspect_disabled=False):
    started = time.monotonic()
    process = subprocess.Popen(
        [
            "/usr/bin/python3",
            a.source + "/infra/deploy/harborctl",
            "--config",
            a.config,
            "resume",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        start_new_session=True,
    )
    observations = []
    try:
        # Observe real DB admission while the delayed API cannot yet listen.
        if inspect_disabled:
            time.sleep(1)
            while process.poll() is None and time.monotonic() - started < 5:
                observations.append(
                    db(c, release, "status")["deployment"]["maintenance"]
                )
                time.sleep(0.2)
        out, err = process.communicate(timeout=150)
    finally:
        # Kill the exact test-created session before admission teardown, including
        # a child database client whose parent timed out. Never leave a late resume.
        if process.poll() is None or sys.exc_info()[1] is not None:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait(timeout=10)
    assert process.returncode == expected, (
        name,
        process.returncode,
        err.decode()[:200],
    )
    if inspect_disabled:
        assert observations and all(observations)
    state = db(c, release, "status")["deployment"]
    assert state["maintenance"] == bool(expected)
    if expected == 0:
        assert json.loads(out)["deployment"]["maintenance"] is False
    else:
        assert b"readiness deadline exceeded" in err
    result["cases"].append(
        {
            "name": name,
            "exitCode": process.returncode,
            "elapsedSeconds": round(time.monotonic() - started, 2),
            "disabledObservations": len(observations),
            "maintenanceAfter": state["maintenance"],
        }
    )


def remove_override():
    if dropdir.exists():
        (dropdir / "resume-test.conf").unlink()
        dropdir.rmdir()
        run(["systemctl", "daemon-reload"])


try:
    disabled()
    delay(8)
    execute("delayed-start", 0, True)
    execute("already-running-retry", 0)
    disabled()
    delay(60)
    execute("bounded-readiness-failure", 1, True)
    disabled()
    (dropdir / "resume-test.conf").unlink()
    dropdir.rmdir()
    run(["systemctl", "daemon-reload"])
    execute("retry-after-failure", 0)
finally:
    primary_error = sys.exc_info()[1]
    cleanup_errors = []
    for cleanup in [disabled, lambda: remove_override()]:
        try:
            cleanup()
        except Exception as error:
            cleanup_errors.append(type(error).__name__)
    try:
        assert hashlib.sha256(unit_file.read_bytes()).hexdigest() == unit_hash
        assert (
            hashlib.sha256(pathlib.Path(a.config).read_bytes()).hexdigest()
            == config_hash
        )
        result["drainedAfter"] = db(c, release, "status")["deployment"]["maintenance"]
        result["originalConfigAndUnitPreserved"] = True
        assert preserved_state() == original_history
        result["originalSessionStatesAndWriterReservationsPreserved"] = True
        result["applicationUnitsStopped"] = all(
            subprocess.run(
                ["systemctl", "is-active", p["unit"] + "-" + r + ".service"],
                stdout=subprocess.DEVNULL,
                timeout=15,
            ).returncode
            != 0
            for r in ["api", "supervisor", "storage"]
        )
        assert result["drainedAfter"] and result["applicationUnitsStopped"]
    except Exception as error:
        cleanup_errors.append(type(error).__name__)
    result["cleanupErrors"] = cleanup_errors
    try:
        pathlib.Path(a.output).write_text(json.dumps(result, indent=2) + "\n")
    except Exception:
        if primary_error is None:
            raise
    if cleanup_errors and primary_error is None:
        raise RuntimeError("Owned resume fixture cleanup unconfirmed")
print(json.dumps(result))
