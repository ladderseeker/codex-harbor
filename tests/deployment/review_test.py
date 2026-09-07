"""Round-one regressions: no network or protected deployment payloads."""

import contextlib, io, json, os, runpy, sys, tempfile, unittest
from pathlib import Path
from unittest.mock import patch

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "infra/deploy"))
from common import run
from backup import inventory
from bounds import MAX_FILE_BYTES
from publish import empty_slot


class Review(unittest.TestCase):
    def test_actual_process_default_capture_and_file_input(self):
        self.assertEqual(run(["/usr/bin/true"]), "")
        self.assertEqual(run(["/bin/cat"], input=b"owned input"), "owned input")
        with tempfile.TemporaryFile() as source, tempfile.TemporaryFile() as target:
            source.write(b"\x00\xffowned bytes")
            source.seek(0)
            run(["/bin/cat"], input_file=source, output=target, output_limit=64)
            target.seek(0)
            self.assertEqual(target.read(), b"\x00\xffowned bytes")
        with self.assertRaises(ValueError):
            run(["/bin/cat"], input=b"a", input_file=io.BytesIO(b"b"))

    def test_actual_process_capture_limit_timeout_and_failure(self):
        with self.assertRaises(RuntimeError):
            run(
                [sys.executable, "-c", 'import sys;sys.stdout.write("x"*100000)'],
                capture_limit=32,
            )
        with self.assertRaisesRegex(RuntimeError, "deadline"):
            run([sys.executable, "-c", "import time;time.sleep(2)"], timeout=0.05)
        with self.assertRaises(RuntimeError):
            run(["/usr/bin/false"])

    def test_status_command_calls_status_without_mutation(self):
        module = runpy.run_path(
            str(Path(__file__).resolve().parents[2] / "infra/deploy/harborctl")
        )
        main = module["main"]
        output = io.StringIO()
        with patch.dict(
            main.__globals__,
            {
                "load": lambda _: {"instance": "owned"},
                "lock": lambda _: contextlib.nullcontext({}),
                "status": lambda _: {"status": "owned fixture"},
                "record": lambda *a, **k: self.fail("Read-only status wrote history"),
            },
        ), patch.object(
            sys, "argv", ["harborctl", "--config", "owned", "status"]
        ), patch.object(
            sys, "platform", "linux"
        ), patch(
            "os.geteuid", return_value=0
        ), contextlib.redirect_stdout(
            output
        ):
            main()
        self.assertEqual(json.loads(output.getvalue())["status"], "owned fixture")

    def test_oversized_sparse_file_rejected_before_hash(self):
        with tempfile.TemporaryDirectory() as root:
            with open(root + "/large", "wb") as stream:
                stream.truncate(MAX_FILE_BYTES + 1)
            with patch(
                "backup.digest", side_effect=AssertionError("must reject before read")
            ):
                with self.assertRaisesRegex(ValueError, "restore bound"):
                    inventory(root)

    def test_checkpoint_refuses_live_caddy_before_inventory_or_transfer(self):
        from backup import checkpoint

        with tempfile.TemporaryDirectory() as root:
            calls = []

            def command(args, **kwargs):
                calls.append(args)
                return "caddy\n" if "ps" in args else ""

            with patch(
                "backup.layout", return_value={"state": root, "etc": root}
            ), patch("backup.maintenance", return_value=("owned", {})), patch(
                "backup.run", command
            ), patch(
                "backup.inventory",
                side_effect=AssertionError("inventory before quiescence"),
            ), patch(
                "backup.restic", side_effect=AssertionError("no transfer allowed")
            ):
                with self.assertRaisesRegex(ValueError, "retirement unconfirmed"):
                    checkpoint({"instance": "owned"})
            self.assertEqual(calls[0][-2:], ["stop", "caddy"])
            self.assertIn("ps", calls[1])
            self.assertEqual(os.listdir(root + "/backups"), [])

    def test_unknown_pool_content_is_preserved(self):
        with tempfile.TemporaryDirectory() as root:
            Path(root + "/workspace").mkdir()
            Path(root + "/native").mkdir()
            marker = Path(root + "/unknown")
            marker.write_bytes(b"do not delete")
            with self.assertRaisesRegex(ValueError, "empty prepared"):
                empty_slot(root)
            self.assertEqual(marker.read_bytes(), b"do not delete")


if __name__ == "__main__":
    unittest.main()
