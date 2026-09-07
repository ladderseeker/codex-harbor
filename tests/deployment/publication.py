"""Actual XFS publication fault lane; only the supplied fresh fixture is touched."""

import os, sys, json, uuid, signal, multiprocessing
from pathlib import Path
from unittest.mock import patch

sys.dont_write_bytecode = True
source = str(Path(__file__).resolve().parents[2])
sys.path.insert(0, source + "/infra/deploy")
import publish
from backup import inventory

m = json.load(open(sys.argv[1]))
control = m["control"]
root = m["profile"]["roots"][0]
os.mkdir(control + "/launcher", 0o700)
c = {"instance": m["id"], "xfsProfile": m["profile"]}
project, local, native = [str(uuid.uuid4()) for _ in range(3)]
terminal_native = "terminal-" + str(uuid.uuid4())
stage = control + "/stage"
unit = "/synthetic/unit"
location = stage + unit
os.makedirs(location + "/workspace")
os.mkdir(location + "/native")
os.mkdir(location + "/native/" + native)
os.mkdir(location + "/native/" + terminal_native)
Path(location + "/native/" + terminal_native + "/history").write_text("terminal native retained")
Path(location + "/workspace/marker").write_text("restored checkout")
Path(location + "/native/" + native + "/canary").write_text("native retained")
registry = {
    "database": {
        "projects": [{"id": project, "root_id": root["id"]}],
        "workspaces": [
            {"id": local, "project_id": project, "kind": "local", "state": "ready"},
            {
                "id": str(uuid.uuid4()),
                "project_id": project,
                "kind": "worktree",
                "state": "removed",
            },
        ],
    },
    "units": [
        {
            "id": project,
            "class": "project",
            "path": unit,
            "inventory": inventory(location),
        }
    ],
}
journal = {}
journal_path = control + "/restore.json"
slot = root["pool"] + "/slot0"
sentinel = Path(slot + "/workspace/unknown")
sentinel.write_text("preserve unknown")


def call():
    with patch("publish.layout", return_value={"state": control}):
        return publish.publish(c, source, registry, stage, journal, journal_path)


try:
    call()
    raise AssertionError("Unknown slot admitted")
except ValueError as e:
    assert "empty prepared" in str(e)
assert sentinel.read_text() == "preserve unknown" and not journal.get("projects")
sentinel.unlink()
other = Path(root["pool"] + "/slot1/workspace/unrelated")
other.write_text("other slot unchanged")


def crash():
    def partial(src, target, entries):
        Path(target + "/partial-owned").write_text("partial")
        os.kill(os.getpid(), signal.SIGKILL)

    with patch("publish.copy_unit", partial):
        call()


p = multiprocessing.Process(target=crash)
p.start()
p.join(30)
assert p.exitcode == -signal.SIGKILL
journal = json.load(open(journal_path))
plan = journal["projects"][project]
assert not os.path.exists(slot) and Path(plan["claimed"] + "/partial-owned").exists()
assert other.read_text() == "other slot unchanged"
result = call()
assert len(result["projects"]) == 1 and len(result["workspaces"]) == 1
assert Path(root["path"] + "/unit/workspace/marker").read_text() == "restored checkout"
assert (
    Path(root["path"] + "/unit/native/" + native + "/canary").read_text()
    == "native retained"
)
assert Path(root["path"] + "/unit/native/" + terminal_native + "/history").read_text() == "terminal native retained"
assert os.stat(root["path"] + "/unit/native/" + terminal_native).st_uid == 10001
assert {n["sessionId"] for n in result["nativeIdentities"]} == {native, terminal_native}
assert not Path(root["path"] + "/unit/partial-owned").exists()
assert other.read_text() == "other slot unchanged"
assert result["projects"][0]["inode"] == str(
    os.stat(root["path"] + "/unit/workspace").st_ino
)
assert os.stat(root["path"] + "/unit").st_ino == int(plan["inode"])
assert call() == result
print(
    json.dumps(
        {
            "status": "passed",
            "checks": [
                "unknown slot preserved",
                "SIGKILL partial claim replay",
                "other slot untouched",
                "actual XFS quota admission and syncfs",
                "native bytes preserved",
                "terminal native history identity and runner ownership preserved",
                "removed checkout not recreated",
                "exact published retry",
            ],
        }
    )
)
