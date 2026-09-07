"""Actual immutable installed preview profile; no fixture runtime or payload transfer."""
import json, os, subprocess, sys, uuid
from pathlib import Path
source = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(source / "infra/deploy"))
from config import load, layout
from control import selected, db, service, readiness, await_readiness
from services import environment
assert sys.platform == "linux" and os.getuid() == 0
admission = json.load(open(os.environ["HARBOR_DEPLOY_TEST_TOOLS"] + "/admission.json"))
c = load(admission["config"])
release, installation = selected(c)
assert c["previews"]["domain"] == "preview.localhost"
evidence = Path(admission["control"]) / ("previews-" + str(uuid.uuid4()))
evidence.mkdir(mode=0o700)
env = {**os.environ, **environment(c, release, "supervisor"), "HARBOR_PREVIEW_EVIDENCE": str(evidence)}
print("Installed preview evidence: " + str(evidence), flush=True)
subprocess.run([release + "/bin/node", "--import", release + "/node_modules/tsx/dist/loader.mjs", str(source / "tests/previews/installed.ts")], env=env, check=True, timeout=240)
# The actual registry and physical native inventory are independent of browser UI.
from backup import inventory
registry = db(c, release, "registry")
assert len(registry["previews"]) == 1
preview = registry["previews"][0]
assert preview["retired"] is True
project = next(p for p in registry["projects"] if p["id"] == preview["project_id"])
physical = inventory(str(Path(project["canonical_path"]).parent), exclude_native_auth=True)
assert any(name.startswith("native/preview-" + preview["id"] + "/") for name in physical["files"])
assert not any(name.startswith("native/") and name.endswith("/auth.json") for name in physical["files"])
launcher = inventory(layout(c["instance"])["state"] + "/launcher", exclude_locks=True)
assert not any(name.endswith(".lock") or ".lock/" in name for name in launcher["files"])
(evidence / "inventory.json").write_text(json.dumps({"status":"passed", "installedArtifact": installation["artifact"], "previewNativeIncluded":True, "nativeAuthExcluded":True, "liveLocksExcluded":True, "protectedTransfer":False}, indent=2))
