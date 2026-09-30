"""Cloud session setup hook: owned temporary state, fake tools and no network."""

import os
import platform
import subprocess
import tarfile
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/cloud-session-setup.sh"
NODE = "node-v24.11.1-linux-x64"
READY = "Harbor cloud setup: Node v24.11.1 and locked dependencies ready.\n"
FAILED = "Harbor cloud setup failed: "
GUIDE = " See docs/developer/cloud-sessions.md#prepare-a-session.\n"
LINUX_X64 = platform.system() == "Linux" and platform.machine() == "x86_64"


class CloudSessionSetup(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix="harbor-p036-")
        self.addCleanup(temp.cleanup)
        self.base = Path(temp.name).resolve()
        self.home = self.base / "home"
        self.project = self.base / "project"
        self.bin = self.base / "bin"
        for directory in (self.home, self.project, self.bin):
            directory.mkdir()
        self.root = self.home / ".cache/codex-harbor"
        self.env_file = self.base / "session-env.sh"
        self.env_file.write_text("")
        self.calls = self.base / "pnpm-calls"
        self.fake_pnpm(status=0)

    def fake_pnpm(self, status):
        pnpm = self.bin / "pnpm"
        pnpm.write_text(
            "#!/bin/sh\n"
            f'printf "%s|%s|%s\\n" "$PWD" "$(command -v node)" "$*" >> "{self.calls}"\n'
            "echo fake pnpm output\n"
            f"exit {status}\n"
        )
        pnpm.chmod(0o755)

    def fake_node(self, version="v24.11.1"):
        node = self.root / NODE / "bin/node"
        node.parent.mkdir(parents=True)
        node.write_text(f"#!/bin/sh\necho {version}\n")
        node.chmod(0o755)
        return node

    def run_setup(self, remote="true", dist=None):
        env = {
            "HOME": str(self.home),
            "PATH": f"{self.bin}:/usr/bin:/bin",
            "CLAUDE_ENV_FILE": str(self.env_file),
            "CLAUDE_PROJECT_DIR": str(self.project),
            "HARBOR_NODE_DIST": dist or (self.base / "missing-dist").as_uri(),
        }
        if remote is not None:
            env["CLAUDE_CODE_REMOTE"] = remote
        result = subprocess.run(
            ["bash", str(SCRIPT)],
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=60,
        )
        self.assertEqual(result.returncode, 0, result.stdout)
        return result.stdout

    def assert_failure(self, output, reason):
        self.assertEqual(len(output.splitlines()), 1, output)
        self.assertTrue(output.startswith(FAILED), output)
        self.assertTrue(output.endswith(GUIDE), output)
        self.assertIn(reason, output)
        # A failure line names no private path: not the temporary HOME, the
        # environment file, the project directory or anything else under the
        # test's temporary directory.
        for private in (self.home, self.env_file, self.project, self.base):
            self.assertNotIn(str(private), output)

    def snapshot(self):
        return {
            str(path.relative_to(self.base)): (
                path.read_bytes() if path.is_file() else None
            )
            for path in self.base.rglob("*")
        }

    def test_not_a_cloud_session_exits_silently_without_writes(self):
        before = self.snapshot()
        for remote in (None, "false", ""):
            with self.subTest(remote=remote):
                self.assertEqual(self.run_setup(remote=remote), "")
                self.assertEqual(self.snapshot(), before)
        self.assertFalse(self.calls.exists())

    @unittest.skipUnless(LINUX_X64, "the hook supports Linux x86_64 only")
    def test_checksum_mismatch_leaves_no_install_or_session_change(self):
        payload = self.base / "payload" / NODE
        (payload / "bin").mkdir(parents=True)
        (payload / "bin/node").write_text("#!/bin/sh\necho v24.11.1\n")
        dist = self.base / "dist"
        (dist / "v24.11.1").mkdir(parents=True)
        with tarfile.open(dist / "v24.11.1" / (NODE + ".tar.xz"), "w:xz") as archive:
            archive.add(payload, arcname=NODE)
        output = self.run_setup(dist=dist.as_uri())
        self.assert_failure(output, "does not match the pinned SHA-256")
        self.assertEqual(os.listdir(self.root), [])
        self.assertEqual(self.env_file.read_text(), "")
        self.assertFalse(self.calls.exists())
        # An existing install with the wrong version also stays untouched.
        stale = self.fake_node(version="v22.0.0")
        output = self.run_setup(dist=dist.as_uri())
        self.assert_failure(output, "does not match the pinned SHA-256")
        self.assertEqual(os.listdir(self.root), [NODE])
        self.assertEqual(stale.read_text(), "#!/bin/sh\necho v22.0.0\n")
        self.assertEqual(self.env_file.read_text(), "")
        self.assertFalse(self.calls.exists())

    @unittest.skipUnless(LINUX_X64, "the hook supports Linux x86_64 only")
    def test_fast_path_reuses_node_and_writes_one_path_line(self):
        node = self.fake_node()
        # Another hook's line, left without a final newline.
        self.env_file.write_text("export HARBOR_OTHER_HOOK=1")
        for _ in range(2):
            self.assertEqual(self.run_setup(), READY)
        path_line = f'export PATH="{node.parent}:$PATH"'
        self.assertEqual(
            self.env_file.read_text(), f"export HARBOR_OTHER_HOOK=1\n{path_line}\n"
        )
        call = f"{self.project}|{node}|install --frozen-lockfile"
        self.assertEqual(self.calls.read_text().splitlines(), [call, call])
        self.assertEqual(sorted(os.listdir(self.root)), [NODE, "pnpm-install.log"])

    @unittest.skipUnless(LINUX_X64, "the hook supports Linux x86_64 only")
    def test_pnpm_failure_names_the_log(self):
        self.fake_node()
        self.fake_pnpm(status=1)
        output = self.run_setup()
        self.assert_failure(output, "~/.cache/codex-harbor/pnpm-install.log")
        log = self.root / "pnpm-install.log"
        self.assertEqual(log.read_text(), "fake pnpm output\n")
        self.assertEqual(self.env_file.read_text().count("export PATH="), 1)
        # Status 124 is what `timeout -k 10 240` returns when the install stops at the
        # stop signal. A killed install returns 137, as an out-of-memory kill does, so
        # it keeps the generic failure line.
        self.fake_pnpm(status=124)
        output = self.run_setup()
        self.assert_failure(output, "did not finish within 240 seconds")
        self.assertIn("~/.cache/codex-harbor/pnpm-install.log", output)
        self.assertEqual(self.env_file.read_text().count("export PATH="), 1)


if __name__ == "__main__":
    unittest.main()
