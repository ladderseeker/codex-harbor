"""Root-orchestrated Linux regression; publication always runs as an unprivileged UID."""
import argparse
import base64
import copy
import hashlib
import json
import os
from pathlib import Path
import pwd
import shutil
import stat
import subprocess
import sys
import tempfile
import uuid

parser = argparse.ArgumentParser()
parser.add_argument('--baseline', required=True, help='Explicit unchanged baseline helper')
args = parser.parse_args()
assert sys.platform == 'linux' and os.getuid() == 0, 'trusted Linux root test lane required'
service = pwd.getpwnam('nobody')
assert service.pw_uid != 0
source = Path(__file__).resolve().parents[2] / 'infra/storage/personal_attachments.py'
baseline = Path(args.baseline).resolve(strict=True)
assert baseline.is_file() and baseline != source
run = Path(tempfile.mkdtemp(prefix='harbor-p024-publication-', dir='/var/lib'))
checks = []

def private(path):
    path.mkdir(mode=0o700)
    os.chown(path, service.pw_uid, service.pw_gid)

def unprivileged():
    os.setgroups([])
    os.setgid(service.pw_gid)
    os.setuid(service.pw_uid)
    os.umask(0o077)

def invoke(helper, request, success):
    result = subprocess.run(
        [sys.executable, str(helper)], input=json.dumps(request), text=True,
        capture_output=True, timeout=15, preexec_fn=unprivileged,
        env={'PATH': '/usr/bin:/bin'},
    )
    assert (result.returncode == 0) == success, 'unexpected publisher outcome'
    return json.loads(result.stdout) if success else None

def request(state):
    content = b'P024 synthetic immutable content'
    return {
        'home': str(state / 'codex-home'), 'workspace': str(run / 'project'),
        'sessionId': str(uuid.uuid4()),
        'files': [{'id': str(uuid.uuid4()), 'content': base64.b64encode(content).decode(),
                   'digest': hashlib.sha256(content).hexdigest()}],
    }

try:
    run.chmod(0o755)
    old = run / 'baseline.py'
    new = run / 'corrected.py'
    shutil.copyfile(baseline, old)
    shutil.copyfile(source, new)
    old.chmod(0o644)
    new.chmod(0o644)
    private(run / 'project')
    state = run / 'state'
    state.mkdir(mode=0o711)
    for name in ('home', 'codex-home', 'control'):
        private(state / name)
    before = {name: (p.stat().st_uid, stat.S_IMODE(p.stat().st_mode))
              for name, p in [('state', state)] + [(n, state / n) for n in ('home', 'codex-home', 'control')]}
    original = request(state)
    invoke(old, original, False)
    checks.append('unchanged baseline rejects root-owned 0711 container as nonroot')
    # Independently expose the second regression after bypassing only that layout.
    local = run / 'private-state'
    private(local)
    private(local / 'codex-home')
    local_request = request(local)
    invoke(old, local_request, False)
    old_file = local / 'home/attachments' / local_request['sessionId'] / local_request['files'][0]['id']
    assert stat.S_IMODE(old_file.stat().st_mode) == 0o400
    checks.append('unchanged baseline leaves mode 0400 under umask 0077')
    result = invoke(new, original, True)
    directory = Path(result['directory']['canonical'])
    file = directory / original['files'][0]['id']
    assert stat.S_IMODE(file.stat().st_mode) == 0o444
    assert file.stat().st_uid == service.pw_uid
    bound = copy.deepcopy(original)
    bound['directory'] = result['directory']
    bound['files'][0].update(result['files'][0])
    assert invoke(new, bound, True) == result
    checks.append('corrected publication and exact identity retry under umask 0077')
    forged = copy.deepcopy(bound)
    forged['files'][0]['inode'] = '0'
    invoke(new, forged, False)
    forged = copy.deepcopy(bound)
    forged['directory']['inode'] = '0'
    invoke(new, forged, False)
    checks.append('forged bound file and directory identities rejected')
    file.chmod(0o400)
    invoke(new, original, False)
    assert stat.S_IMODE(file.stat().st_mode) == 0o400
    file.chmod(0o444)
    checks.append('existing malformed mode rejected without repair')
    data = file.read_bytes()
    file.chmod(0o600)
    file.write_bytes(b'X' + data[1:])
    file.chmod(0o444)
    invoke(new, bound, False)
    file.chmod(0o600)
    file.write_bytes(data)
    file.chmod(0o444)
    checks.append('tampered content rejected')
    extra = directory / 'unexpected-link'
    os.link(file, extra)
    invoke(new, bound, False)
    extra.unlink()
    saved = directory / 'saved'
    file.rename(saved)
    invoke(new, bound, False)
    file.symlink_to(saved)
    invoke(new, original, False)
    file.unlink()
    saved.rename(file)
    checks.append('hard links, missing bound files and symlink files rejected')
    saved_directory = directory.with_name(directory.name + '-saved')
    directory.rename(saved_directory)
    private(directory)
    invoke(new, bound, False)
    directory.rmdir()
    directory.symlink_to(saved_directory)
    invoke(new, bound, False)
    directory.unlink()
    saved_directory.rename(directory)
    checks.append('replaced and symlink session directories rejected')
    state.chmod(0o733)
    invoke(new, original, False)
    state.chmod(0o711)
    os.chown(state, service.pw_uid, service.pw_gid)
    invoke(new, original, False)
    os.chown(state, 0, 0)
    checks.append('writable root container and nonprivate service container rejected')
    no_home = run / 'no-home-state'
    no_home.mkdir(mode=0o711)
    private(no_home / 'codex-home')
    invoke(new, request(no_home), False)
    assert not (no_home / 'home').exists()
    checks.append('missing installed private home is not created')
    after = {name: (p.stat().st_uid, stat.S_IMODE(p.stat().st_mode))
             for name, p in [('state', state)] + [(n, state / n) for n in ('home', 'codex-home', 'control')]}
    assert before == after
    for p in (state / 'home/attachments', directory):
        assert p.stat().st_uid == service.pw_uid and stat.S_IMODE(p.stat().st_mode) == 0o700
    checks.append('root ownership, 0711 container and private 0700 children preserved')
    print(json.dumps({'passed': True, 'platform': sys.platform, 'publisherUid': service.pw_uid,
                      'umask': '0077', 'baselineSha256': hashlib.sha256(old.read_bytes()).hexdigest(),
                      'correctedSha256': hashlib.sha256(new.read_bytes()).hexdigest(),
                      'checks': checks, 'cleanup': 'owned state removed'}, indent=2))
finally:
    shutil.rmtree(run)
