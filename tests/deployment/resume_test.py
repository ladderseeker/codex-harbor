"""Resume admission ordering and bounded startup: no protected state or transfer."""

import copy
import runpy
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "infra/deploy"))
import control


class Resume(unittest.TestCase):
    def setUp(self):
        self.resume = runpy.run_path(
            str(Path(__file__).resolve().parents[2] / "infra/deploy/harborctl")
        )["resume_services"]
        self.state = {"maintenance": True, "activation_required": False}
        self.calls = []
        self.fail_release_status = False

    def db(self, c, release, action, **fields):
        self.calls.append((action, fields))
        if action == "maintenance":
            self.state["maintenance"] = fields["enabled"]
            return {"maintenance": fields["enabled"]}
        if self.fail_release_status and not self.state["maintenance"]:
            raise RuntimeError("lost status")
        return {"deployment": copy.deepcopy(self.state)}

    def patches(self, ready):
        return patch.dict(
            self.resume.__globals__,
            {
                "db": self.db,
                "preflight": lambda *a: None,
                "service": lambda *a: self.calls.append(("service", a[1:])),
                "await_readiness": ready,
            },
        )

    def test_delayed_start_stays_disabled_then_returns_current_state_and_retry(self):
        probes = []

        def readiness(*args):
            probes.append(self.state["maintenance"])
            if len(probes) < 3:
                raise ValueError("Private listener confinement failed")
            return {"services": "ready", "deployment": copy.deepcopy(self.state)}

        with self.patches(control.await_readiness), patch(
            "control.readiness", readiness
        ), patch("control.time.sleep"):
            result = self.resume({}, "owned")
            self.assertFalse(result["deployment"]["maintenance"])
            result = self.resume({}, "owned")
        self.assertEqual(probes, [True] * 4)
        self.assertFalse(result["deployment"]["maintenance"])

    def test_deadline_preserves_maintenance(self):
        with self.patches(control.await_readiness), patch(
            "control.readiness", side_effect=ValueError("starting")
        ), patch("control.time.monotonic", side_effect=[0, 31]):
            with self.assertRaisesRegex(ValueError, "deadline exceeded"):
                self.resume({}, "owned")
        self.assertTrue(self.state["maintenance"])
        self.assertNotIn(("maintenance", {"enabled": False}), self.calls)

    def test_post_release_status_failure_recloses_admission(self):
        self.fail_release_status = True
        with self.patches(lambda *a: {"services": "ready"}):
            with self.assertRaisesRegex(RuntimeError, "lost status"):
                self.resume({}, "owned")
        self.assertTrue(self.state["maintenance"])

    def test_database_loss_stops_admission_services(self):
        original = self.db

        def unavailable(c, release, action, **fields):
            if len(self.calls) >= 3:
                raise RuntimeError("database unavailable")
            return original(c, release, action, **fields)

        with self.patches(lambda *a: {"services": "ready"}), patch.dict(
            self.resume.__globals__, {"db": unavailable}
        ):
            with self.assertRaisesRegex(RuntimeError, "database unavailable"):
                self.resume({}, "owned")
        self.assertIn(("service", ("stop", ["api", "supervisor"])), self.calls)

    def test_restored_instance_remains_gated_without_mutation(self):
        self.state["activation_required"] = True
        with self.patches(lambda *a: self.fail("must not start")):
            with self.assertRaisesRegex(ValueError, "explicit validated activation"):
                self.resume({}, "owned")
        self.assertEqual(self.calls, [("status", {})])


if __name__ == "__main__":
    unittest.main()
