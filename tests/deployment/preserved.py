"""Reboot verifies stored filesystem identities without rebinding or adopting paths."""

import os, json, sys

source = os.path.realpath(os.path.join(os.path.dirname(__file__), "../.."))
sys.dont_write_bytecode = True
sys.path.insert(0, source + "/infra/deploy")
from config import load
from control import selected, db, readiness

manifest = json.load(
    open(
        os.environ.get(
            "HARBOR_DEPLOY_ADMISSION", "/var/lib/harbor-p009-tools/admission.json"
        )
    )
)
c = load(manifest["config"])
release, _ = selected(c)
result = readiness(c, release)
registry = db(c, release, "registry")
verified = []
for project in registry["projects"]:
    s = os.lstat(project["canonical_path"])
    assert (
        str(s.st_dev) == project["device"] and str(s.st_ino) == project["inode"]
    ), "Stored project identity changed; no automatic rebinding allowed"
    verified.append(
        {"id": project["id"], "device": project["device"], "inode": project["inode"]}
    )
assert verified, "A created project is required for preservation evidence"
print(
    json.dumps(
        {
            "readyAfterBoot": result["services"] == "ready",
            "projectIdentitiesPreserved": verified,
            "rebindingPerformed": False,
            "sessions": len(registry["sessions"]),
        }
    )
)
