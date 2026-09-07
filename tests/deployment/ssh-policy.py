"""Public loopback SSH host-trust regression; never uses Harbor/SFTP backup state."""

import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "infra/deploy"))
from ssh_policy import options

assert sys.platform == "linux" and os.getuid() == 0
with tempfile.TemporaryDirectory(
    prefix="p009-public-ssh-", dir=os.environ["HARBOR_TEST_CONTROL_ROOT"]
) as temporary:
    root = Path(temporary)
    chroot = root / "chroot"
    chroot.mkdir(mode=0o755)
    (chroot / "public").write_text("public exact SSH authority canary\n")
    for name in ["server", "other", "client"]:
        subprocess.run(
            ["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(root / name)],
            check=True,
            timeout=15,
        )
    with socket.socket() as candidate:
        candidate.bind(("127.0.0.1", 0))
        port = candidate.getsockname()[1]
    authority = f"[127.0.0.1]:{port}"
    wrong, global_file = root / "user-known", root / "global-known"
    wrong.write_text(authority + " " + (root / "other.pub").read_text())
    global_file.write_text(authority + " " + (root / "server.pub").read_text())
    config = root / "sshd.conf"
    config.write_text(
        f"""Port {port}
ListenAddress 127.0.0.1
HostKey {root}/server
PidFile {root}/sshd.pid
AuthorizedKeysFile {root}/client.pub
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AuthenticationMethods publickey
PermitRootLogin yes
AllowUsers root
UsePAM yes
StrictModes yes
ChrootDirectory {chroot}
ForceCommand internal-sftp
Subsystem sftp internal-sftp
AllowTcpForwarding no
AllowAgentForwarding no
X11Forwarding no
PermitTunnel no
LogLevel ERROR
"""
    )
    subprocess.run(["/usr/sbin/sshd", "-t", "-f", str(config)], check=True, timeout=10)
    log = open(root / "sshd.log", "wb")
    server = subprocess.Popen(
        ["/usr/sbin/sshd", "-D", "-e", "-f", str(config)],
        stdout=log,
        stderr=log,
        start_new_session=True,
    )
    try:
        deadline = time.monotonic() + 10
        while True:
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=1):
                    break
            except OSError:
                assert server.poll() is None and time.monotonic() < deadline
                time.sleep(0.1)
        policy = options({"sshKey": str(root / "client"), "knownHosts": str(wrong)})
        control = []
        index = 0
        while index < len(policy):
            if policy[index : index + 2] == ["-o", "GlobalKnownHostsFile=/dev/null"]:
                index += 2
            else:
                control.append(policy[index])
                index += 1

        def attempt(args):
            # A test-owned alternate global database is passed after policy. The
            # fixed first value must win, without modifying any host-global file.
            output = root / "received"
            output.unlink(missing_ok=True)
            result = subprocess.run(
                [
                    "sftp",
                    *args,
                    "-o",
                    "GlobalKnownHostsFile=" + str(global_file),
                    "-q",
                    "-b",
                    "-",
                    "-P",
                    str(port),
                    "root@127.0.0.1",
                ],
                input=f'get /public "{output}"\n'.encode(),
                capture_output=True,
                timeout=15,
            )
            if result.returncode == 0:
                assert output.read_text() == "public exact SSH authority canary\n"
            return result.returncode

        assert attempt(control) == 0, "Control did not reproduce global-key fallback"
        assert attempt(policy) != 0, "Alternate globally trusted key bypassed exact pin"
        wrong.write_text(authority + " " + (root / "server.pub").read_text())
        assert attempt(policy) == 0, "Correct configured exact key was refused"
        print(
            json.dumps(
                {
                    "publicLoopbackOnly": True,
                    "oldGlobalFallbackReproduced": True,
                    "alternateGlobalKeyDenied": True,
                    "correctExactKeyAccepted": True,
                    "hostGlobalFilesModified": False,
                    "harborState": False,
                }
            )
        )
    finally:
        os.killpg(server.pid, signal.SIGTERM)
        server.wait(timeout=10)
        log.close()
