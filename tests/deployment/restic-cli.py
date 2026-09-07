"""Pinned CLI metadata contract: synthetic public bytes, local disposable repo only."""

import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "infra/deploy"))
from common import run
from backup import inventory
from extract import extract

binary = os.path.realpath(sys.argv[1])
assert run([binary, "version"]).startswith("restic 0.19.1 ")
with tempfile.TemporaryDirectory(prefix="harbor-public-restic-cli-") as temporary:
    base = Path(temporary)
    project = base / "public-project"
    project.mkdir()
    (project / "registry.json").write_text("public ordinary project filename\n")
    (project / "text").write_text("public metadata canary\n")
    (project / "link").symlink_to("text")
    checkpoint = base / "checkpoint"
    checkpoint.mkdir()
    dump = checkpoint / "database.dump"
    dump.write_bytes(b"public synthetic dump; not a database")
    registry = {
        "format": 1,
        "backupSchema": 1,
        "units": [{"path": str(project), "inventory": inventory(str(project))}],
        "dump": {
            "path": str(dump),
            "size": dump.stat().st_size,
            "sha256": hashlib.sha256(dump.read_bytes()).hexdigest(),
        },
    }
    registry_file = checkpoint / "registry.json"
    registry_file.write_text(json.dumps(registry))
    identity = hashlib.sha256(registry_file.read_bytes()).hexdigest()
    password = base / "public-password"
    password.write_text("synthetic-public-cli-contract-password\n")

    def cli(c, release, args, **kwargs):
        return run(
            [
                binary,
                "--no-cache",
                *(["--no-lock"] if args[0] in {"ls", "dump", "cat"} else []),
                "--repo",
                str(base / "local-repository"),
                "--password-file",
                str(password),
                *args,
            ],
            **kwargs
        )

    cli({}, "", ["init"])

    def capture():
        cli({}, "", ["backup", str(project), str(dump), str(registry_file)])
        return json.loads(cli({}, "", ["snapshots", "--json"]))[-1]["id"]

    snapshot = capture()
    listing = [
        json.loads(line)
        for line in cli({}, "", ["ls", "--json", snapshot]).splitlines()
    ]
    assert any(x.get("paths") and str(registry_file) in x["paths"] for x in listing)
    assert all("linktarget" not in x for x in listing)
    with patch("extract.restic", cli):
        extract({}, "", snapshot, identity, None, verify_only=True)
        destination = base / "staging"
        destination.mkdir()
        extract({}, "", snapshot, identity, str(destination))
        assert os.readlink(str(destination) + str(project / "link")) == "text"
        assert (
            Path(str(destination) + str(project / "registry.json"))
        ).read_bytes() == (project / "registry.json").read_bytes()
        (project / "link").unlink()
        (project / "link").symlink_to("changed-public-target")
        changed = capture()
        try:
            extract({}, "", changed, identity, None, verify_only=True)
        except ValueError as error:
            assert "symlink mismatch" in str(error)
        else:
            raise AssertionError("Changed authenticated target was accepted")
    print(
        json.dumps(
            {
                "check": "synthetic local Restic CLI metadata contract",
                "version": "0.19.1",
                "registryFilename": "pass",
                "authenticatedSymlink": "pass",
                "changedTargetRejected": True,
                "harborState": False,
                "network": False,
            }
        )
    )
