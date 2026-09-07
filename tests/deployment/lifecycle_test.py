"""Failure boundaries for fresh restore publication and schema compatibility."""

import os, sys, unittest, tempfile, json
from unittest.mock import patch

sys.dont_write_bytecode = True
sys.path.insert(
    0, os.path.realpath(os.path.join(os.path.dirname(__file__), "../../infra/deploy"))
)
from promotion import compatible
from restore import validate
from control import await_readiness


class Lifecycle(unittest.TestCase):
    def test_inserted_migration_needs_exact_predecessor(self):
        old = dict(
            format=1,
            backupSchema=1,
            configurationSchema=1,
            nativeCompatibility="codex-0.153.4",
            architecture="aarch64",
            artifact="a" * 64,
            migrations={"001": "a", "009": "b"},
        )
        new = {
            **old,
            "artifact": "b" * 64,
            "migrations": {"001": "a", "008": "c", "009": "b"},
        }
        with self.assertRaisesRegex(ValueError, "Lower-ID"):
            compatible(old, new)
        new["supportedPredecessors"] = [
            dict(
                artifact=old["artifact"],
                migrations=old["migrations"],
                orderPolicy="explicit-supported-predecessor",
            )
        ]
        compatible(old, new)
        with self.assertRaisesRegex(ValueError, "downgrade"):
            compatible(new, old, True)
        new["migrations"]["001"] = "changed"
        with self.assertRaisesRegex(ValueError, "history"):
            compatible(old, new)

    def test_cold_readiness_never_claims_admission_before_sockets(self):
        with patch(
            "control.readiness",
            side_effect=[
                FileNotFoundError(),
                ValueError("socket absent"),
                {"ready": True},
            ],
        ), patch("control.time.sleep"):
            self.assertEqual(await_readiness({}, "/release"), {"ready": True})

    def test_readiness_timeout_keeps_failure_explicit(self):
        with patch("control.readiness", side_effect=FileNotFoundError()), patch(
            "control.time.monotonic", side_effect=[0, 31]
        ):
            with self.assertRaisesRegex(ValueError, "admission remains disabled"):
                await_readiness({}, "/release")

    def test_restore_unknown_class_and_incomplete_root_mapping_denied(self):
        manifest = dict(
            backupSchema=1,
            configurationSchema=1,
            nativeCompatibility="codex-0.153.4",
            architecture="aarch64",
            migrations={"009": "fixed"},
        )
        registry = {
            **manifest,
            "instance": "source",
            "roots": [{"id": "root"}],
            "database": {"projects": []},
            "units": [
                {"class": kind}
                for kind in [
                    "configuration",
                    "historical-authority",
                    "caddy-data",
                    "caddy-config",
                ]
            ],
        }
        config = {"instance": "destination", "roots": [{"id": "root"}]}
        validate(registry, config, manifest)
        with self.assertRaisesRegex(ValueError, "root mapping"):
            validate(registry, {**config, "roots": []}, manifest)
        registry["units"].append({"class": "unexpected-host-data"})
        with self.assertRaisesRegex(ValueError, "Unknown restore"):
            validate(registry, config, manifest)


if __name__ == "__main__":
    unittest.main()
