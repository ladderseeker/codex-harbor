import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "infra/deploy"))
import destination


class Enrollment(unittest.TestCase):
    def test_failed_probe_preserves_current_and_exact_retry_reconciles(self):
        with tempfile.TemporaryDirectory() as root:
            profile = Path(root) / "profile.json"
            profile.write_text('{"synthetic":"public"}')
            binding = {
                "destination": {"host": "public.invalid"},
                "targetHostId": "b" * 64,
                "hostKeySha256": "c" * 64,
                "sourceHostId": "a" * 64,
                "files": {"key": "d" * 64},
            }
            with patch("destination.layout", return_value={"state": root}), patch(
                "destination.trusted"
            ), patch("destination.validate_profile", return_value=binding), patch(
                "destination.public_probe", return_value={"publicRoundtrip": True}
            ) as probe:
                first = destination.enroll({"instance": "owned"}, str(profile), "none")
                before = (Path(root) / "backup-destinations.json").read_bytes()
                retry = destination.enroll({"instance": "owned"}, str(profile), "none")
                self.assertEqual(retry["destinationId"], first["destinationId"])
                self.assertTrue(retry["reconciled"])
                self.assertEqual(probe.call_count, 1)
                changed = {**binding, "targetHostId": "e" * 64}
                with patch("destination.validate_profile", return_value=changed):
                    with self.assertRaisesRegex(ValueError, "stale"):
                        destination.enroll({"instance": "owned"}, str(profile), "none")
                    with patch(
                        "destination.public_probe",
                        side_effect=RuntimeError("public probe denied"),
                    ):
                        with self.assertRaises(RuntimeError):
                            destination.enroll(
                                {"instance": "owned"},
                                str(profile),
                                first["destinationId"],
                            )
                self.assertEqual(
                    (Path(root) / "backup-destinations.json").read_bytes(), before
                )
                source_config = {
                    "instance": "owned",
                    "backup": {"originalSource": True},
                }
                chosen = destination.for_backup(source_config, allow_unverified=True)
                self.assertEqual(source_config["backup"], {"originalSource": True})
                self.assertEqual(chosen["backup"], binding["destination"])
                with self.assertRaisesRegex(ValueError, "not initialized"):
                    destination.for_backup({"instance": "owned"})
                self.assertEqual(
                    destination.status({"instance": "owned"})["repositoryReadiness"],
                    "not-yet-initialized-or-verified",
                )

    def test_self_host_and_host_key_identity_are_refused(self):
        profile = {
            "destination": {},
            "targetHostId": "a" * 64,
            "hostKeySha256": "b" * 64,
        }
        with patch("destination.source_identity", return_value={"files": {}}), patch(
            "destination.local_identity", return_value=("a" * 64, "c" * 64)
        ):
            with self.assertRaisesRegex(ValueError, "this host"):
                destination.validate_profile(profile)
            profile["targetHostId"] = "d" * 64
            profile["hostKeySha256"] = "c" * 64
            with self.assertRaisesRegex(ValueError, "this host"):
                destination.validate_profile(profile)

    def test_restore_retry_binds_original_source_files_before_effects(self):
        import restore

        with tempfile.TemporaryDirectory() as root:
            backup = {}
            for name in ["sshKey", "knownHosts", "passwordFile"]:
                path = Path(root) / name
                path.write_text("public original source fixture")
                backup[name] = str(path)
            c = {"instance": "owned", "backup": backup}
            with patch("destination.validate_backup"):
                identity = destination.source_identity(backup)
                journal = {
                    "ownerRebind": False,
                    "archiveSha256": "a" * 64,
                    "snapshot": "b" * 64,
                    "registrySha256": "c" * 64,
                    "restoreSource": identity,
                }
                (Path(root) / "restore.json").write_text(json.dumps(journal))
                Path(backup["passwordFile"]).write_text(
                    "public replaced source fixture"
                )
                with patch("restore.layout", return_value={"state": root}), patch(
                    "restore.initialize",
                    side_effect=AssertionError("effect before source binding"),
                ):
                    with self.assertRaisesRegex(ValueError, "input identity changed"):
                        restore.restore(
                            c, "/unused", "a" * 64, "b" * 64, "c" * 64, resume=True
                        )

    def test_missing_enrollment_refuses_backup_without_network(self):
        with tempfile.TemporaryDirectory() as root, patch(
            "destination.layout", return_value={"state": root}
        ), patch(
            "destination.run", side_effect=AssertionError("network before enrollment")
        ):
            with self.assertRaisesRegex(ValueError, "enrollment required"):
                destination.for_backup({"instance": "owned"})


if __name__ == "__main__":
    unittest.main()
