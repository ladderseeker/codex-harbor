#!/usr/bin/env python3
"""Personal VPS development sandbox acceptance; fresh account/state, no login."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import pwd
import select
import shutil
import subprocess
import sys
import time
import uuid


def run(args, **kw):
    return subprocess.run(args, check=True, **kw)


def probe(base):
    assert os.getuid() != 0
    base = Path(base)
    assert os.environ['P015_LITERAL'] == 'literal-$HOME-"-é-\\'
    proc = subprocess.Popen([str(base / 'bin/codex'), 'app-server'], stdin=subprocess.PIPE,
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, cwd=str(base / 'workspace'),
                            env={'PATH': '/usr/bin:/bin', 'HOME': str(base / 'home'),
                                 'CODEX_HOME': str(base / 'codex-home')}, text=True, bufsize=1)
    sequence = 0

    def request(method, params):
        nonlocal sequence
        sequence += 1
        proc.stdin.write(json.dumps({'id': sequence, 'method': method, 'params': params}) + '\n')
        proc.stdin.flush()
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            ready, _, _ = select.select([proc.stdout], [], [], max(0, deadline - time.monotonic()))
            if not ready:
                break
            line = proc.stdout.readline()
            if not line:
                raise RuntimeError('Native runtime ended unexpectedly')
            response = json.loads(line)
            if response.get('id') == sequence:
                if 'error' in response:
                    raise RuntimeError('Native command rejected: ' + json.dumps(response['error']))
                return response['result']
        raise RuntimeError('Native response timeout')

    try:
        request('initialize', {'clientInfo': {'name': 'harbor_p015_boundary', 'version': '1'}, 'capabilities': {'experimentalApi': True}})
        proc.stdin.write(json.dumps({'method': 'initialized'}) + '\n')
        proc.stdin.flush()
        def command(target, policy):
            return request('command/exec', {'command': ['/usr/bin/touch', str(target)],
                'cwd': str(base / 'workspace'), 'sandboxPolicy': policy, 'timeoutMs': 10000})
        write = {'type': 'workspaceWrite', 'writableRoots': [str(base / 'workspace')],
                 'networkAccess': False, 'excludeTmpdirEnvVar': True, 'excludeSlashTmp': True}
        good = command(base / 'workspace/allowed', write)
        assert good['exitCode'] == 0 and (base / 'workspace/allowed').exists(), 'Native workspace-write must succeed: ' + good.get('stderr', '')
        denied = command(base / 'home/outside-denied', write)
        assert denied['exitCode'] != 0 and not (base / 'home/outside-denied').exists(), 'Native outside write must fail'
        readonly = command(base / 'workspace/readonly-denied', {'type': 'readOnly', 'networkAccess': False})
        assert readonly['exitCode'] != 0 and not (base / 'workspace/readonly-denied').exists(), 'Native read-only write must fail'
        run(['/usr/bin/git', 'init', '-q', str(base / 'workspace')])
        development = dict(write, writableRoots=[str(base / 'workspace'), str(base / 'workspace/.git')],
                           networkAccess=True, excludeSlashTmp=False, excludeTmpdirEnvVar=False)
        def dev(args):
            result = request('command/exec', {'command': args, 'cwd': str(base / 'workspace'),
                             'sandboxPolicy': development, 'timeoutMs': 10000})
            assert result['exitCode'] == 0, 'Development command failed: ' + json.dumps(result)
            return result
        dev(['/bin/sh', '-c', 'printf content > example.txt && git add example.txt && git -c user.name=Acceptance -c user.email=acceptance@example.invalid commit -qm acceptance'])
        dev(['/usr/bin/python3', '-c', 'import tempfile,socket; f=tempfile.TemporaryFile(); f.write(b"ok"); socket.getaddrinfo("registry.npmjs.org",443); s=socket.socket(); s.bind(("127.0.0.1",0)); s.listen(); s.close()'])
        denied_dev = command(base / 'home/development-outside-denied', development)
        assert denied_dev['exitCode'] != 0, 'Development policy must retain outside write denial'
        # This path is Unix-writable to the account, but excluded from ReadWritePaths.
        try:
            (base / 'outside/systemd-denied').write_text('unexpected')
        except OSError:
            pass
        else:
            raise AssertionError('systemd write boundary failed')
        print(json.dumps({'status': 'passed', 'nonroot': True, 'systemdOutsideDenied': True,
                          'nativeWorkspaceWrite': True, 'nativeOutsideDenied': True,
                          'nativeReadOnlyDenied': True, 'environmentLiteralPreserved': True,
                          'gitCommit': True, 'temporaryFile': True, 'dns': True, 'localhostListener': True,
                          'authenticatedModelTurn': 'not exercised'}))
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--binary')
    p.add_argument('--probe')
    p.add_argument('--apparmor-userns', action='store_true', help='Load a temporary exact-binary Ubuntu userns profile; remove it during owned cleanup')
    args = p.parse_args()
    if args.probe:
        return probe(args.probe)
    if os.geteuid() != 0 or not args.binary:
        raise RuntimeError('Run as root with --binary pointing to pinned official Codex 0.153.4')
    binary = Path(args.binary).resolve(strict=True)
    version = run([str(binary), '--version'], capture_output=True, text=True).stdout.strip()
    assert version == 'codex-cli 0.153.4', 'Pinned runtime required'
    suffix = uuid.uuid4().hex[:10]
    account = 'hp015-' + suffix
    base = Path('/var/lib/harbor-personal-test-' + suffix)
    unit = 'harbor-p015-native-' + suffix
    created = False
    profile_loaded = False
    profile = base / 'codex.apparmor'
    try:
        run(['/usr/sbin/useradd', '--system', '--no-create-home', '--user-group', '--shell', '/usr/sbin/nologin', account])
        created = True
        user = pwd.getpwnam(account)
        base.mkdir(mode=0o755)
        (base / 'bin').mkdir(mode=0o755)
        shutil.copyfile(binary, base / 'bin/codex')
        (base / 'bin/codex').chmod(0o755)
        if args.apparmor_userns:
            profile.write_text('abi <abi/4.0>,\ninclude <tunables/global>\nprofile ' + unit + ' ' + str(base / 'bin/codex') + ' flags=(unconfined) {\n  userns,\n}\n')
            profile.chmod(0o600)
            run(['/usr/sbin/apparmor_parser', '-a', str(profile)])
            profile_loaded = True
        shutil.copyfile(__file__, base / 'probe.py')
        (base / 'probe.py').chmod(0o644)
        for child in ('home', 'codex-home', 'workspace', 'outside'):
            d = base / child
            d.mkdir(mode=0o700)
            os.chown(d, user.pw_uid, user.pw_gid)
        envfile = base / 'probe.env'
        envfile.write_text('P015_LITERAL=' + json.dumps('literal-$HOME-"-é-\\', ensure_ascii=False) + '\n')
        envfile.chmod(0o600)
        props = {'User': account, 'Group': account, 'WorkingDirectory': str(base),
                 'EnvironmentFile': str(envfile), 'NoNewPrivileges': 'yes', 'PrivateTmp': 'yes',
                 'ProtectSystem': 'strict', 'ProtectHome': 'read-only', 'ProtectKernelTunables': 'yes',
                 'ProtectKernelModules': 'yes', 'ProtectControlGroups': 'yes',
                 'ReadWritePaths': ' '.join(str(base / c) for c in ('home', 'codex-home', 'workspace')),
                 'InaccessiblePaths': '-/run/docker.sock -/var/run/docker.sock', 'UMask': '0077',
                 'MemoryMax': '4G', 'CPUQuota': '150%', 'TasksMax': '512', 'KillMode': 'control-group',
                 'TimeoutStopSec': '15', 'RuntimeMaxSec': '90'}
        command = ['/usr/bin/systemd-run', '--unit', unit, '--wait', '--pipe', '--collect']
        for key, value in props.items():
            command += ['--property', key + '=' + value]
        command += ['/usr/bin/python3', str(base / 'probe.py'), '--probe', str(base)]
        print(json.dumps({'run': suffix, 'binarySha256': hashlib.sha256(binary.read_bytes()).hexdigest()}), flush=True)
        run(command)
    finally:
        subprocess.run(['/usr/bin/systemctl', 'stop', unit + '.service'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if profile_loaded:
            run(['/usr/sbin/apparmor_parser', '-R', str(profile)])
        if base.exists():
            shutil.rmtree(base)
        if created:
            run(['/usr/sbin/userdel', account])


if __name__ == '__main__':
    main()
