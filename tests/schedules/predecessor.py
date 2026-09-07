"""Exact public predecessor compatibility; no artifact promotion or backup."""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys

sys.dont_write_bytecode = True
root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root / "infra/deploy"))
from promotion import compatible

parser = argparse.ArgumentParser()
parser.add_argument("--predecessor-manifest", required=True)
parser.add_argument("--output", required=True)
a = parser.parse_args()
prior = json.loads(Path(a.predecessor_manifest).read_text())
identity = copy.deepcopy(prior)
artifact = identity.pop("artifact")
assert hashlib.sha256(json.dumps(identity, sort_keys=True, separators=(",", ":")).encode()).hexdigest() == artifact
checkpoint = "77b2ad50e3b4191a535b3fac02badc2cfd2316f6"
paths = subprocess.check_output(["git", "ls-tree", "-r", "--name-only", checkpoint, "packages/storage/src/migrations/"], cwd=root, text=True).splitlines()
exact = {Path(p).name: hashlib.sha256(subprocess.check_output(["git", "show", checkpoint + ":" + p], cwd=root)).hexdigest() for p in paths if p.endswith(".sql")}
assert prior["migrations"] == exact
candidate = copy.deepcopy(prior)
candidate["migrations"] = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in (root / "packages/storage/src/migrations").glob("*.sql")}
assert set(candidate["migrations"]) - set(exact) == {"013_schedules.sql"}
candidate["supportedPredecessors"] = []
try:
    compatible(prior, candidate)
except ValueError as error:
    assert "Lower-ID" in str(error)
else:
    raise AssertionError("Unrecorded lower-ID migration accepted")
candidate["supportedPredecessors"] = [{"artifact": artifact, "migrations": exact, "orderPolicy": "explicit-supported-predecessor"}]
compatible(prior, candidate)
for field in ["artifact", "migrations"]:
    invalid = copy.deepcopy(candidate)
    invalid["supportedPredecessors"][0][field] = "wrong" if field == "artifact" else {}
    try:
        compatible(prior, invalid)
    except ValueError:
        pass
    else:
        raise AssertionError("Mismatched predecessor accepted")
Path(a.output).write_text(json.dumps({"status": "passed", "predecessorArtifact": artifact, "predecessorSource": prior["source"], "predecessorCommit": checkpoint, "migrationAdded": "013_schedules.sql", "exactPredecessorRequired": True, "scope": "actual public predecessor manifest plus production compatibility function; candidate packaging/promotion and protected restore not exercised"}, indent=2) + "\n")
