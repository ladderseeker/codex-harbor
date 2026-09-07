"""Run against the fresh test-owned installed immutable source, without a fixture runtime."""
import os, json, sys, subprocess, uuid
from pathlib import Path
source = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(source / "infra/deploy"))
from config import load
from control import selected
from services import environment
assert os.getuid() == 0 and sys.platform == "linux"
tools = os.environ["HARBOR_DEPLOY_TEST_TOOLS"]
admission = json.load(open(tools + "/admission.json"))
c = load(admission["config"])
release, state = selected(c)
evidence = admission["control"] + "/modules-" + str(uuid.uuid4())
Path(evidence).mkdir(mode=0o700)
print("Installed module evidence: " + evidence, flush=True)
env = {**os.environ, **environment(c, release, "supervisor"), "HARBOR_MODULE_EVIDENCE_DIR": evidence}
subprocess.run([release + "/bin/node", "--import", release + "/node_modules/tsx/dist/loader.mjs", str(source / "tests/deployment/modules.ts")], env=env, check=True, timeout=180)

# Actual physical inventory primitive, with no repository call or payload export.
from backup import inventory
from config import layout
p = layout(c["instance"])
launcher = inventory(p["state"] + "/launcher", exclude_locks=True)
assert "file-slots.json" in launcher["files"]
assert not any(name.endswith(".lock") for name in launcher["files"])
assert any(name.startswith("file-receipts/") for name in launcher["files"])
registry = json.loads(subprocess.check_output([release + "/bin/node", "--import", release + "/node_modules/tsx/dist/loader.mjs", release + "/infra/deploy/database.ts"], input=b'{"action":"registry"}', env=env))
project = registry["projects"][0]
unit = inventory(str(Path(project["canonical_path"]).parent), exclude_native_auth=True)
assert any(name.startswith("native/terminal-") for name in unit["files"])
assert not any(name.startswith("native/") and name.endswith("/auth.json") for name in unit["files"])
Path(evidence + "/modules-inventory-result.json").write_text(json.dumps({"status":"passed","installedArtifact":state["artifact"],"fileReceiptsIncluded":True,"transientLocksExcluded":True,"terminalNativeIncluded":True,"nativeAuthExcluded":True,"protectedTransfer":False})+"\n")

# Fresh local synthetic metadata clone; never an off-host/protected restore.
env["HARBOR_MODULE_REBIND_RESULT"] = evidence + "/modules-rebind-result.json"
subprocess.run([release + "/bin/node", "--import", release + "/node_modules/tsx/dist/loader.mjs", str(source / "tests/deployment/modules-rebind.ts")], env=env, check=True, timeout=120)
env["HARBOR_DEPLOY_CONFIG"] = admission["config"]
env["HARBOR_RUNTIME_LOCK_CONTROL"] = evidence + "/terminal-recovery"
subprocess.run(["python3", str(source / "tests/deployment/terminal-recovery.py")], env=env, check=True, timeout=180)
