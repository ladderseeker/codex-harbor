import argparse
import collections
import contextlib
import hashlib
import importlib.machinery
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[2] / 'infra/personal-vps/deploy-release'
loader = importlib.machinery.SourceFileLoader('deploy_release', str(SCRIPT))
spec = importlib.util.spec_from_loader(loader.name, loader)
deploy = importlib.util.module_from_spec(spec)
loader.exec_module(deploy)

GIB = 1 << 30
Usage = collections.namedtuple('Usage', 'total used free')
REAL_RUN = subprocess.run
REVISION = 'abcdef0123456789abcdef0123456789abcdef01'
# Tests patch os.geteuid for the script's root checks; ownership fixtures use the real identity.
ROOT = os.geteuid() == 0
UNIT = 'harbor-personal-p035-test-unit'


def snapshot(root, strict=False):
    """Every path below root without following links: type, mode, content or target (and mtime when strict)."""
    found = {}
    for directory, dirs, files in os.walk(root):
        for name in dirs + files:
            path = os.path.join(directory, name)
            info = os.lstat(path)
            if stat.S_ISLNK(info.st_mode):
                detail = ('link', os.readlink(path))
            elif stat.S_ISDIR(info.st_mode):
                detail = ('dir', stat.S_IMODE(info.st_mode))
            else:
                with open(path, 'rb') as stream:
                    detail = ('file', stat.S_IMODE(info.st_mode), hashlib.sha256(stream.read()).hexdigest())
            if strict:
                detail += (info.st_mtime_ns, info.st_uid, info.st_gid)
            found[os.path.relpath(path, root)] = detail
    return found


def below(snapshot_keys, roots):
    return {k for k in snapshot_keys if any(k == r or k.startswith(r + '/') for r in roots)}


def completed(args, stdout=''):
    return subprocess.CompletedProcess(args, 0, stdout=stdout, stderr='')


class DeployReleaseTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix='harbor-p035-')
        self.addCleanup(temp.cleanup)
        self.base = Path(os.path.realpath(temp.name))
        self.releases = self.base / 'opt/releases'
        self.backups = self.base / 'backups'
        self.work = self.base / 'work'
        self.build_state = self.base / 'lib-private'
        self.build_cache = self.base / 'cache-private'
        self.etc = self.base / 'etc'
        self.state = self.base / 'state'
        self.outside = self.base / 'outside'
        self.releases.mkdir(parents=True)
        self.etc.mkdir(mode=0o700)
        (self.etc / 'compose.json').write_text('{}\n')
        (self.etc / 'service.env').write_text('SYNTHETIC=1\n')
        self.state.mkdir(mode=0o711)
        self.installed = self.release('installed', 64 * 1024)
        self.c = {'instance': 'p035', 'release': str(self.installed), 'origin': 'https://harbor.example.org'}
        for patcher in (patch.multiple(deploy, RELEASES=self.releases, BACKUPS=self.backups, WORK=self.work,
                                       BUILD_STATE=self.build_state, BUILD_CACHE=self.build_cache),
                        patch.object(deploy, 'instance', side_effect=lambda name: (self.c, UNIT, self.etc, self.state)),
                        patch.object(deploy, 'http_status', return_value=200),
                        patch.object(deploy.os, 'geteuid', return_value=0)):
            patcher.start()
            self.addCleanup(patcher.stop)

    def release(self, name, size=4096):
        path = self.releases / name
        (path / 'bin').mkdir(parents=True)
        (path / 'bin/node').write_bytes(b'n' * size)
        (path / 'artifact.json').write_text('{"profile": "personal-vps"}\n')
        return path

    def populate_state(self):
        """A synthetic private state tree with Codex scratch, development caches and PostgreSQL data."""
        s = self.state
        (s / 'control').mkdir(mode=0o700)
        (s / 'control/owner').write_text('control')
        os.chmod(s / 'control/owner', 0o640)
        (s / 'control/link').symlink_to('owner')
        codex = s / 'codex-home'
        codex.mkdir(mode=0o700)
        (codex / 'auth.json').write_text('{"synthetic": true}\n')
        os.chmod(codex / 'auth.json', 0o600)
        (codex / 'sessions/2026').mkdir(parents=True)
        (codex / 'sessions/2026/rollout.jsonl').write_text('{"line": 1}\n')
        (codex / 'config-link').symlink_to('auth.json')
        (codex / '.tmp/plugins-clone-abc').mkdir(parents=True)
        (codex / '.tmp/plugins-clone-abc/pack').write_bytes(b'x' * 65536)
        (codex / '.tmp/git-xyz').mkdir()
        home = s / 'home'
        home.mkdir(mode=0o700)
        (home / '.gitconfig').write_text('[user]\n')
        self.project = home / 'development' / ('a' * 64)
        self.project.mkdir(parents=True)
        for name in ('data', 'state', 'config', 'npm', 'pnpm-store', 'cache-tool'):
            (self.project / name).mkdir()
            (self.project / name / 'item').write_text(name)
        (self.project / 'loose-cache').write_bytes(b'c' * 65536)
        (home / 'development/stray').write_text('not a project directory')
        (home / 'development/linked-project').symlink_to(self.project)
        (s / 'postgres').mkdir(mode=0o700)
        (s / 'postgres/PG_VERSION').write_text('17\n')
        (s / 'attachments').mkdir(mode=0o700)
        (s / 'attachments/blob').write_bytes(b'blob')
        self.rebuilt = ['codex-home', 'home', 'home/development', 'home/development/' + self.project.name]
        for index, relative in enumerate(self.rebuilt):
            path = s / relative
            os.chmod(path, (0o700, 0o750, 0o711, 0o755)[index])
            if ROOT:
                os.chown(path, 4321 + index, 4331 + index)
            os.utime(path, ns=(1_600_000_000_000_000_000 + index, 1_700_000_000_000_000_000 + index * 1000))

    def fake_run(self, fail_on=None):
        """Fake Docker; run /bin/cp for real, failing after copying a source that ends with fail_on."""
        def run(args, **kwargs):
            if args[0] == '/usr/bin/docker':
                if 'pg_dump' in args:
                    kwargs['stdout'].write(b'PGDMP synthetic dump')
                return completed(args)
            if args[0] == '/bin/cp':
                result = REAL_RUN(args, **kwargs)
                if fail_on and args[-2].endswith(fail_on):
                    raise subprocess.CalledProcessError(1, args)
                return result
            raise AssertionError('Unexpected command ' + args[0])
        return run

    @staticmethod
    def psql(c, sql):
        if 'pg_database_size' in sql:
            return '8192'
        if 'harbor_migrations' in sql:
            return ''
        raise AssertionError('Unexpected SQL ' + sql)

    def test_reserve_is_the_larger_of_two_gib_and_five_percent(self):
        self.assertEqual(deploy.reserve(10 * GIB), 2 * GIB)
        self.assertEqual(deploy.reserve(40 * GIB), 2 * GIB)
        self.assertEqual(deploy.reserve(80 * GIB), 4 * GIB)
        self.assertEqual(deploy.reserve(100 * GIB), 5 * GIB)

    def test_allocated_size_counts_blocks_once_and_never_follows_links(self):
        tree = self.base / 'tree'
        tree.mkdir()
        (tree / 'file').write_bytes(b'f' * 65536)
        os.link(tree / 'file', tree / 'hardlink')
        (self.outside / 'big').mkdir(parents=True)
        (self.outside / 'big/data').write_bytes(b'o' * 262144)
        (tree / 'dir-link').symlink_to(self.outside / 'big')
        (tree / 'file-link').symlink_to(self.outside / 'big/data')
        expected = sum(os.lstat(tree / n).st_blocks * 512 for n in ('.', 'file', 'dir-link', 'file-link'))
        self.assertEqual(deploy.allocated(tree), expected)
        self.assertEqual(deploy.allocated(tree / 'dir-link'), os.lstat(tree / 'dir-link').st_blocks * 512)
        self.assertEqual(deploy.allocated(self.base / 'missing'), 0)
        seen = set()
        first = deploy.allocated(tree / 'file', seen)
        self.assertGreater(first, 0)
        self.assertEqual(deploy.allocated(tree / 'hardlink', seen), 0)

    def test_p035_04_checkpoint_copy_keeps_state_without_scratch_or_caches(self):
        self.populate_state()
        target = self.base / 'checkpoint/state'
        target.mkdir(parents=True, mode=0o711)
        deploy.copy_state(self.state, target)
        project = 'home/development/' + self.project.name
        copied = set(snapshot(target))
        expected = {'control', 'control/owner', 'control/link',
                    'codex-home', 'codex-home/auth.json', 'codex-home/config-link', 'codex-home/sessions',
                    'codex-home/sessions/2026', 'codex-home/sessions/2026/rollout.jsonl',
                    'home', 'home/.gitconfig', 'home/development', 'home/development/stray',
                    'home/development/linked-project', project,
                    'attachments', 'attachments/blob'}
        for name in ('data', 'state', 'config'):
            expected |= {project + '/' + name, project + '/' + name + '/item'}
        self.assertEqual(copied, expected)
        source = snapshot(self.state)
        for relative in expected:
            self.assertEqual(snapshot(target)[relative], source[relative], relative)
            info, original = os.lstat(target / relative), os.lstat(self.state / relative)
            if ROOT:
                self.assertEqual((info.st_uid, info.st_gid), (original.st_uid, original.st_gid), relative)
            if not stat.S_ISLNK(info.st_mode):
                self.assertEqual(stat.S_IMODE(info.st_mode), stat.S_IMODE(original.st_mode), relative)
        self.assertTrue((target / 'control/link').is_symlink())
        self.assertEqual(os.readlink(target / 'home/development/linked-project'), str(self.project))
        for relative in self.rebuilt:
            info, original = os.lstat(target / relative), os.lstat(self.state / relative)
            self.assertEqual(stat.S_IMODE(info.st_mode), stat.S_IMODE(original.st_mode), relative)
            self.assertEqual((info.st_uid, info.st_gid), (original.st_uid, original.st_gid), relative)
            self.assertEqual(info.st_mtime_ns, original.st_mtime_ns, relative)

    def test_p035_04_symlinked_state_directories_are_copied_as_links(self):
        (self.outside / 'codex').mkdir(parents=True)
        (self.outside / 'codex/.tmp').mkdir()
        (self.state / 'codex-home').symlink_to(self.outside / 'codex')
        (self.state / 'home').mkdir(mode=0o700)
        (self.state / 'home/development').symlink_to(self.outside)
        rebuild, copies = deploy.checkpoint_plan(self.state)
        self.assertEqual(rebuild, ['home'])
        self.assertEqual(copies, ['codex-home', 'home/development'])
        target = self.base / 'checkpoint'
        target.mkdir()
        deploy.copy_state(self.state, target)
        self.assertEqual(os.readlink(target / 'codex-home'), str(self.outside / 'codex'))
        self.assertTrue((target / 'home/development').is_symlink())

    def test_p035_04_checkpoint_writes_a_recognized_receipt_and_the_trimmed_state(self):
        self.populate_state()
        with patch.object(deploy.subprocess, 'run', side_effect=self.fake_run()):
            target = deploy.checkpoint(self.c, UNIT, self.etc, self.state, 'candidate')
        self.assertEqual(target.parent, self.backups)
        receipt = json.loads((target / 'receipt.json').read_text())
        self.assertEqual(receipt['release'], str(self.installed))
        self.assertEqual(receipt['databaseSha256'], hashlib.sha256(b'PGDMP synthetic dump').hexdigest())
        self.assertEqual(target.name, 'candidate-' + receipt['createdAt'])
        self.assertEqual(deploy.checkpoint_receipt(target), receipt)
        self.assertEqual(snapshot(target / 'etc'), snapshot(self.etc))
        self.assertEqual(stat.S_IMODE(os.lstat(target / 'state').st_mode), 0o711)
        self.assertFalse(os.path.lexists(target / 'state/codex-home/.tmp'))
        self.assertFalse(os.path.lexists(target / 'state/postgres'))
        self.assertFalse(os.path.lexists(target / 'state/home/development' / self.project.name / 'npm'))
        self.assertTrue((target / 'state/codex-home/sessions/2026/rollout.jsonl').is_file())

    def test_p035_05_checkpoint_need_excludes_scratch_and_caches(self):
        self.populate_state()
        with patch.object(deploy, 'psql', side_effect=self.psql):
            need = deploy.checkpoint_need(self.c, self.etc, self.state)
            (self.state / 'codex-home/.tmp/plugins-clone-abc/more').write_bytes(b'x' * 1048576)
            (self.project / 'npm/more').write_bytes(b'x' * 1048576)
            (self.state / 'postgres/base').write_bytes(b'x' * 1048576)
            self.assertEqual(deploy.checkpoint_need(self.c, self.etc, self.state), need)
            (self.state / 'codex-home/sessions/2026/more').write_bytes(b'x' * 1048576)
            self.assertGreater(deploy.checkpoint_need(self.c, self.etc, self.state), need + 1048576 - 1)
        rebuild, copies = deploy.checkpoint_plan(self.state)
        seen = set()
        expected = sum(os.lstat(self.state / r).st_blocks * 512 for r in rebuild)
        expected += sum(deploy.allocated(self.state / r, seen) for r in copies) + deploy.allocated(self.etc, seen)
        with patch.object(deploy, 'psql', side_effect=self.psql):
            self.assertEqual(deploy.checkpoint_need(self.c, self.etc, self.state), expected + 8192)

    def build_args(self):
        bundle = self.base / 'harbor.bundle'
        bundle.write_bytes(b'bundle')
        return argparse.Namespace(instance='p035', bundle=str(bundle), revision=REVISION)

    def test_p035_05_build_refuses_before_writing_when_space_is_short(self):
        args = self.build_args()
        need = 4 * deploy.allocated(self.installed)
        total = 100 * GIB
        reserve = deploy.reserve(total)
        self.assertEqual(reserve, 5 * GIB)
        for free, refused in ((need + reserve - 1, True), (need + reserve, False)):
            before = snapshot(self.base, strict=True)
            with self.subTest(free=free), \
                    patch.object(deploy, 'verify_release', return_value={}), \
                    patch.object(deploy.shutil, 'disk_usage', return_value=Usage(total, total - free, free)), \
                    patch.object(deploy, 'native_inputs', side_effect=RuntimeError('stop after the check')) as inputs, \
                    patch.object(deploy.subprocess, 'run') as run:
                if refused:
                    with self.assertRaises(ValueError) as caught:
                        deploy.build(args)
                    message = str(caught.exception)
                    for number in (need, reserve, free):
                        self.assertIn(str(number), message)
                    self.assertIn('nothing was changed', message)
                    inputs.assert_not_called()
                    self.assertEqual(snapshot(self.base, strict=True), before)
                else:
                    with self.assertRaisesRegex(RuntimeError, 'stop after the check'):
                        deploy.build(args)
                    inputs.assert_called_once()
                run.assert_not_called()
        self.assertEqual([p.name for p in self.releases.iterdir()], ['installed'])

    def test_p035_05_build_checks_each_distinct_filesystem_once(self):
        args = self.build_args()
        need = 4 * deploy.allocated(self.installed)
        first, second = self.base / 'opt', self.base
        def filesystem(path):
            return (2, second) if Path(path) in (self.build_state, self.build_cache) else (1, first)
        def usage(path):
            free = need + 2 * GIB + (1 if Path(path) == first else -1)
            return Usage(10 * GIB, 10 * GIB - free, free)
        with patch.object(deploy, 'filesystem', side_effect=filesystem), \
                patch.object(deploy.shutil, 'disk_usage', side_effect=usage) as disk, \
                patch.object(deploy, 'verify_release', return_value={}), \
                patch.object(deploy.subprocess, 'run') as run:
            with self.assertRaises(ValueError) as caught:
                deploy.build(args)
            self.assertEqual(sorted(Path(c.args[0]) for c in disk.call_args_list), sorted([first, second]))
            self.assertIn(str(need + 2 * GIB - 1) + ' bytes free', str(caught.exception))
            run.assert_not_called()
        self.assertFalse(self.work.exists())

    def promote_args(self):
        return argparse.Namespace(instance='p035', release=str(self.release('candidate')), allow_new_migrations=False)

    @contextlib.contextmanager
    def promotion(self, free, run):
        calls = []
        def systemctl(*args, check=True):
            calls.append((args, sorted(p.name for p in self.backups.iterdir()) if self.backups.exists() else []))
            return completed(['/usr/bin/systemctl', *args])
        with patch.object(deploy.installer, 'validate', side_effect=lambda c: c), \
                patch.object(deploy, 'verify_release', return_value={'baseRevision': REVISION}), \
                patch.object(deploy, 'psql', side_effect=self.psql), \
                patch.object(deploy, 'switched_files', return_value={}), \
                patch.object(deploy, 'drop_ins', return_value={}), \
                patch.object(deploy, 'ownership', return_value={'busyOperations': 0, 'busyRuntimes': 0,
                                                                 'idleRuntimes': 0, 'backgroundSessions': 0}), \
                patch.object(deploy, 'processes_from', return_value=[]), \
                patch.object(deploy, 'systemctl', side_effect=systemctl), \
                patch.object(deploy, 'activate', side_effect=AssertionError('must not switch releases')), \
                patch.object(deploy.shutil, 'disk_usage', return_value=Usage(10 * GIB, 10 * GIB - free, free)), \
                patch.object(deploy.subprocess, 'run', side_effect=run):
            yield calls

    def test_p035_05_promote_refuses_before_stopping_the_api_when_space_is_short(self):
        self.populate_state()
        args = self.promote_args()
        with patch.object(deploy, 'psql', side_effect=self.psql):
            need = deploy.checkpoint_need(self.c, self.etc, self.state)
        reserve = 2 * GIB
        free = need + reserve - 1
        before = snapshot(self.base, strict=True)
        with self.promotion(free, self.fake_run()) as calls:
            with self.assertRaises(ValueError) as caught:
                deploy.promote(args)
            self.assertEqual(calls, [])
            deploy.ownership.assert_not_called()
        message = str(caught.exception)
        for number in (need, reserve, free):
            self.assertIn(str(number), message)
        self.assertEqual(snapshot(self.base, strict=True), before)
        self.assertFalse(self.backups.exists())

    def test_p035_06_failed_checkpoint_is_removed_before_the_old_release_restarts(self):
        self.populate_state()
        args = self.promote_args()
        with self.promotion(100 * GIB, self.fake_run(fail_on='codex-home/sessions')) as calls:
            with self.assertRaises(subprocess.CalledProcessError):
                deploy.promote(args)
        api, supervisor = UNIT + '-api.service', UNIT + '-supervisor.service'
        self.assertEqual([args for args, _ in calls], [('stop', api), ('stop', supervisor), ('start', api, supervisor)])
        self.assertEqual(calls[-1][1], [], 'the partial checkpoint was still present at restart')
        self.assertEqual(list(self.backups.iterdir()), [])

    def fake_build_run(self, args, **kwargs):
        self.assertEqual(args[0], '/usr/bin/systemd-run')
        state_name = next(a.split('=', 1)[1] for a in args if a.startswith('StateDirectory='))
        package = self.build_state / state_name / 'package'
        (package / 'release/bin').mkdir(parents=True)
        (package / 'release/artifact.json').write_text('{"profile": "personal-vps"}\n')
        (package / 'release/bin/node').write_text('node')
        (package / 'release/bin/link').symlink_to('node')
        (package / 'candidate.tar.gz').write_bytes(b'archive')
        (package / 'package-result.json').write_text(json.dumps({
            'archive': str(package / 'candidate.tar.gz'), 'sha256': hashlib.sha256(b'archive').hexdigest(),
            'fileCount': 2}))
        return completed(args)

    @contextlib.contextmanager
    def building(self, verify):
        with patch.object(deploy, 'verify_release', side_effect=verify), \
                patch.object(deploy, 'native_inputs'), \
                patch.object(deploy.shutil, 'disk_usage', return_value=Usage(100 * GIB, 0, 100 * GIB)), \
                patch.object(deploy.os, 'lchown'), \
                patch.object(deploy.subprocess, 'run', side_effect=self.fake_build_run):
            yield

    def assert_build_left_nothing(self):
        self.assertEqual([p.name for p in self.releases.iterdir()], ['installed'])
        self.assertEqual(list((self.work / 'inputs').iterdir()), [])
        self.assertEqual(list((self.build_state / 'harbor-deploy-build').iterdir()), [])

    def test_p035_06_build_success_stages_the_release(self):
        output = io.StringIO()
        with self.building(lambda release, revision=None: {}), contextlib.redirect_stdout(output):
            deploy.build(self.build_args())
        name = 'gha-' + REVISION[:12]
        self.assertEqual(sorted(p.name for p in self.releases.iterdir()), [name, 'installed'])
        self.assertEqual(os.readlink(self.releases / name / 'bin/link'), 'node')
        self.assertEqual(json.loads(output.getvalue().splitlines()[-1])['release'], str(self.releases / name))

    def test_p035_06_build_failure_after_staging_started_removes_the_staging_directory(self):
        def verify(release, revision=None):
            if Path(release).name.startswith('.staging-'):
                self.assertTrue((Path(release) / 'bin/node').exists())
                raise ValueError('Release file differs from manifest: bin/node')
            return {}
        with self.building(verify), self.assertRaisesRegex(ValueError, 'differs from manifest'):
            deploy.build(self.build_args())
        self.assert_build_left_nothing()

    def test_p035_06_build_failure_during_the_staging_copy_removes_the_partial_copy(self):
        def partial_copy(source, destination, **kwargs):
            (Path(destination) / 'partial').write_text('partial')
            raise OSError(28, 'No space left on device')
        with self.building(lambda release, revision=None: {}), \
                patch.object(deploy.shutil, 'copytree', side_effect=partial_copy), \
                self.assertRaises(OSError):
            deploy.build(self.build_args())
        self.assert_build_left_nothing()

    def test_p035_06_existing_staging_directory_is_refused_and_left_untouched(self):
        staging = self.releases / ('.staging-gha-' + REVISION[:12])
        staging.mkdir()
        (staging / 'evidence').write_text('inspect me')
        before = snapshot(staging, strict=True)
        with self.building(lambda release, revision=None: {}), \
                self.assertRaisesRegex(ValueError, 'Staging path exists'):
            deploy.build(self.build_args())
        self.assertEqual(snapshot(staging, strict=True), before)
        self.assertEqual(sorted(p.name for p in self.releases.iterdir()), [staging.name, 'installed'])
        self.assertEqual(list((self.work / 'inputs').iterdir()), [])

    def checkpoint_dir(self, name, receipt=None, raw=None):
        path = self.backups / name
        (path / 'state/codex-home/.tmp/plugins-clone-x').mkdir(parents=True)
        (path / 'state/codex-home/.tmp/plugins-clone-x/pack').write_bytes(b'p' * 32768)
        (path / 'state/codex-home/auth.json').write_text('{"synthetic": true}\n')
        (path / 'database.dump').write_bytes(b'PGDMP')
        if receipt is not None:
            (path / 'receipt.json').write_text(json.dumps(receipt))
        if raw is not None:
            (path / 'receipt.json').write_text(raw)
        return path

    def receipt(self, release, created):
        return {'release': str(self.releases / release), 'databaseSha256': 'f' * 64, 'createdAt': created}

    def prune_layout(self):
        """Releases and checkpoints for the retention rule; returns the paths prune must remove."""
        for name in ('running', 'kept-a', 'kept-b', 'old-1', 'old-2', '.staging-gha-000000000000'):
            self.release(name)
        (self.releases / 'link').symlink_to(self.releases / 'old-2')
        (self.outside / 'target').mkdir(parents=True)
        (self.outside / 'target/keep').write_text('outside')
        (self.releases / 'outside-link').symlink_to(self.outside / 'target')
        (self.releases / 'notes.txt').write_text('not a release')
        self.backups.mkdir(mode=0o700)
        self.checkpoint_dir('r4-20260930T040000Z', self.receipt('kept-a', '20260930T040000Z'))
        self.checkpoint_dir('r3-20260930T030000Z', self.receipt('kept-b', '20260930T030000Z'))
        self.checkpoint_dir('r2-20260930T020000Z', self.receipt('old-1', '20260930T020000Z'))
        self.checkpoint_dir('r1-20260929T010000Z', self.receipt('installed', '20260929T010000Z'))
        self.checkpoint_dir('manual-backup')
        missing = self.receipt('kept-a', '20260930T050000Z')
        del missing['databaseSha256']
        self.checkpoint_dir('missing-field-20260930T050000Z', missing)
        self.checkpoint_dir('mismatch-20260930T060000Z', self.receipt('old-2', '20260930T070000Z'))
        self.checkpoint_dir('number-20260930T080000Z', dict(self.receipt('old-2', 'x'), createdAt=20260930))
        self.checkpoint_dir('badstamp-2026-09-30', self.receipt('old-2', '2026-09-30'))
        self.checkpoint_dir('invalid-date-20261399T990000Z', self.receipt('old-2', '20261399T990000Z'))
        self.checkpoint_dir('not-json-20260930T100000Z', raw='{')
        linked = self.checkpoint_dir('linked-receipt-20260930T090000Z')
        (self.outside / 'receipt.json').write_text(json.dumps(self.receipt('old-2', '20260930T090000Z')))
        (linked / 'receipt.json').symlink_to(self.outside / 'receipt.json')
        (self.outside / 'state/codex-home/.tmp').mkdir(parents=True)
        (self.outside / 'state/codex-home/.tmp/keep').write_text('outside scratch')
        (self.backups / 'linked-state').mkdir()
        (self.backups / 'linked-state/state').symlink_to(self.outside / 'state')
        (self.backups / 'backup-link').symlink_to(self.backups / 'r2-20260930T020000Z')
        (self.backups / 'readme.txt').write_text('not a checkpoint')
        scratch = '/state/codex-home/.tmp'
        return {str(self.releases / 'old-1'), str(self.releases / 'old-2'),
                str(self.backups / 'r2-20260930T020000Z'), str(self.backups / 'r1-20260929T010000Z')} | {
            str(self.backups / name) + scratch for name in (
                'r4-20260930T040000Z', 'r3-20260930T030000Z', 'manual-backup', 'missing-field-20260930T050000Z',
                'mismatch-20260930T060000Z', 'number-20260930T080000Z', 'badstamp-2026-09-30',
                'invalid-date-20261399T990000Z', 'not-json-20260930T100000Z', 'linked-receipt-20260930T090000Z')}

    @staticmethod
    def running(release):
        return [4242] if Path(release).name == 'running' else []

    def run_prune(self, keep=2):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            deploy.prune(argparse.Namespace(instance='p035', keep_checkpoints=keep))
        return json.loads(output.getvalue().splitlines()[-1])

    def test_p035_07_prune_keeps_the_retention_set_and_removes_exactly_its_plan(self):
        expected = self.prune_layout()
        with patch.object(deploy, 'processes_from', side_effect=self.running):
            plan = deploy.prune_plan(self.c)
            self.assertEqual({item['path'] for item in plan['remove']}, expected)
            planned_bytes = sum(item['bytes'] for item in plan['remove'])
            before = snapshot(self.base)
            result = self.run_prune()
        after = snapshot(self.base)
        self.assertEqual(result['removed'], [item['path'] for item in plan['remove']])
        self.assertEqual(result['freedBytes'], planned_bytes)
        self.assertEqual(result['skipped'], [])
        gone = set(before) - set(after)
        self.assertEqual(gone, below(before, [os.path.relpath(p, self.base) for p in expected]))
        self.assertEqual({k: v for k, v in before.items() if k not in gone}, after)
        for name in ('installed', 'running', 'kept-a', 'kept-b', '.staging-gha-000000000000'):
            self.assertTrue((self.releases / name / 'bin/node').is_file(), name)
        self.assertTrue((self.releases / 'link').is_symlink())
        self.assertEqual((self.outside / 'target/keep').read_text(), 'outside')
        self.assertEqual((self.outside / 'state/codex-home/.tmp/keep').read_text(), 'outside scratch')
        self.assertTrue((self.backups / 'backup-link').is_symlink())
        self.assertTrue((self.backups / 'r4-20260930T040000Z/state/codex-home/auth.json').is_file())
        self.assertTrue((self.backups / 'manual-backup/database.dump').is_file())
        reasons = {e['name']: e['reason'] for e in plan['releases']}
        self.assertEqual(reasons['installed'], 'installed release')
        self.assertEqual(reasons['running'], 'a process runs from it')
        self.assertEqual(reasons['kept-a'], 'named by a kept checkpoint')
        with patch.object(deploy, 'processes_from', side_effect=self.running):
            self.assertEqual(deploy.prune_plan(self.c)['remove'], [])

    def test_p035_07_prune_keeps_the_newest_n_checkpoints(self):
        self.prune_layout()
        with patch.object(deploy, 'processes_from', side_effect=self.running):
            plan = deploy.prune_plan(self.c, 3)
        removed = {Path(item['path']).name for item in plan['remove'] if item['kind'] != 'codex-scratch'}
        self.assertEqual(removed, {'old-2', 'r1-20260929T010000Z'})
        kept = [e['name'] for e in plan['checkpoints'] if e['keep'] and e['reason'].startswith('one of')]
        self.assertEqual(sorted(kept), ['r2-20260930T020000Z', 'r3-20260930T030000Z', 'r4-20260930T040000Z'])

    def test_p035_07_prune_rejects_keep_counts_outside_one_to_ten(self):
        self.prune_layout()
        before = snapshot(self.base, strict=True)
        with patch.object(deploy, 'processes_from', side_effect=self.running):
            for keep in (0, 11, -1, True):
                with self.subTest(keep=keep), self.assertRaisesRegex(ValueError, 'between 1 and 10'):
                    deploy.prune(argparse.Namespace(instance='p035', keep_checkpoints=keep))
            with patch('sys.argv', ['deploy-release', 'prune', '--instance', 'p035', '--keep-checkpoints', '11']), \
                    self.assertRaisesRegex(ValueError, 'between 1 and 10'):
                deploy.main()
        self.assertEqual(snapshot(self.base, strict=True), before)

    def test_p035_07_prune_rechecks_each_release_before_deleting_it(self):
        self.prune_layout()
        plans = []
        installed = dict(self.c, release=str(self.releases / 'old-2'))
        def running(release):
            # old-1 starts running and old-2 becomes the installed release after the plan was made.
            plans.append(Path(release).name)
            return [7] if Path(release).name == 'old-1' and plans.count('old-1') > 1 else self.running(release)
        answers = iter([(self.c, UNIT, self.etc, self.state)] + [(installed, UNIT, self.etc, self.state)] * 10)
        with patch.object(deploy, 'processes_from', side_effect=running), \
                patch.object(deploy, 'instance', side_effect=lambda name: next(answers)):
            result = self.run_prune()
        self.assertEqual({s['path'] for s in result['skipped']}, {str(self.releases / 'old-1'), str(self.releases / 'old-2')})
        self.assertTrue((self.releases / 'old-1').is_dir())
        self.assertTrue((self.releases / 'old-2').is_dir())
        self.assertNotIn(str(self.releases / 'old-1'), result['removed'])
        self.assertIn(str(self.backups / 'r2-20260930T020000Z'), result['removed'])

    def test_remove_tree_never_deletes_through_a_symbolic_link(self):
        self.prune_layout()
        for relative in ('backup-link', 'linked-state/state/codex-home/.tmp'):
            with self.subTest(relative=relative), self.assertRaises(OSError):
                deploy.remove_tree(self.backups, relative)
        self.assertEqual((self.outside / 'state/codex-home/.tmp/keep').read_text(), 'outside scratch')
        self.assertTrue((self.backups / 'r2-20260930T020000Z/database.dump').is_file())
        with self.assertRaises(ValueError):
            deploy.remove_tree(self.backups, '../outside')

    def preflight(self):
        output = io.StringIO()
        with patch.object(deploy, 'systemctl', return_value=completed([], 'active\n')), \
                patch.object(deploy, 'ownership', return_value={'busyOperations': 0}), \
                patch.object(deploy, 'drop_ins', return_value={}), \
                patch.object(deploy, 'switched_files', return_value={}), \
                patch.object(deploy, 'verify_release', return_value={}), \
                patch.object(deploy, 'psql', side_effect=self.psql), \
                contextlib.redirect_stdout(output):
            deploy.preflight(argparse.Namespace(instance='p035'))
        return json.loads(output.getvalue())

    def test_p035_08_preflight_reports_disk_use_and_changes_nothing(self):
        self.populate_state()
        expected = self.prune_layout()
        total, free = 80 * GIB, 30 * GIB
        before = snapshot(self.base, strict=True)
        with patch.object(deploy, 'processes_from', side_effect=self.running), \
                patch.object(deploy.shutil, 'disk_usage', return_value=Usage(total, total - free, free)):
            report = self.preflight()
            with patch.object(deploy, 'psql', side_effect=self.psql):
                checkpoint_need = deploy.checkpoint_need(self.c, self.etc, self.state)
            plan = deploy.prune_plan(self.c)
        self.assertEqual(snapshot(self.base, strict=True), before)
        self.assertEqual(report['freeBytes'], free)
        disk = report['disk']
        self.assertEqual(len(disk['filesystems']), 1)
        filesystem = disk['filesystems'][0]
        self.assertEqual(filesystem['paths'], [str(p) for p in (self.releases, self.backups, self.state, self.work,
                                                               self.build_state, self.build_cache)])
        self.assertEqual((filesystem['freeBytes'], filesystem['totalBytes'], filesystem['reserveBytes']),
                         (free, total, 4 * GIB))
        self.assertEqual(disk['buildNeedBytes'], 4 * deploy.allocated(self.installed))
        self.assertTrue(disk['buildFits'])
        self.assertEqual(disk['checkpointNeedBytes'], checkpoint_need)
        self.assertTrue(disk['checkpointFits'])
        self.assertEqual(disk['codexScratchBytes'], deploy.allocated(self.state / 'codex-home/.tmp'))
        self.assertGreater(disk['codexScratchBytes'], 65536)
        for kind in ('releases', 'checkpoints'):
            for entry in disk[kind]:
                self.assertEqual(set(entry), {'name', 'bytes', 'keep', 'reason'})
            self.assertEqual(disk[kind], [{k: e[k] for k in ('name', 'bytes', 'keep', 'reason')} for e in plan[kind]])
        releases = {e['name']: e for e in disk['releases']}
        self.assertEqual(releases['installed']['bytes'], deploy.allocated(self.installed))
        self.assertEqual({n for n, e in releases.items() if not e['keep']}, {'old-1', 'old-2'})
        self.assertNotIn('link', releases)
        self.assertEqual(set(disk['pruneWouldRemove']), expected)
        self.assertEqual(disk['pruneWouldFreeBytes'], sum(item['bytes'] for item in plan['remove']))
        with patch.object(deploy, 'processes_from', side_effect=self.running):
            result = self.run_prune()
        self.assertEqual(result['removed'], disk['pruneWouldRemove'])
        self.assertEqual(result['freedBytes'], disk['pruneWouldFreeBytes'])

    def test_p035_08_disk_report_lists_each_filesystem_once_and_judges_fit_per_filesystem(self):
        self.populate_state()
        other = self.base / 'opt'
        def filesystem(path):
            return (2, other) if Path(path) in (self.releases, self.build_cache) else (1, self.base)
        def usage(path):
            free = 1 * GIB if Path(path) == other else 50 * GIB
            return Usage(100 * GIB, 100 * GIB - free, free)
        with patch.object(deploy, 'filesystem', side_effect=filesystem), \
                patch.object(deploy.shutil, 'disk_usage', side_effect=usage), \
                patch.object(deploy, 'processes_from', return_value=[]), \
                patch.object(deploy, 'psql', side_effect=self.psql):
            disk = deploy.disk_report(self.c, self.etc, self.state)
        self.assertEqual([sorted(f['paths']) for f in disk['filesystems']],
                         [sorted([str(self.releases), str(self.build_cache)]),
                          sorted([str(self.backups), str(self.state), str(self.work), str(self.build_state)])])
        self.assertFalse(disk['buildFits'])
        self.assertTrue(disk['checkpointFits'])
        self.assertEqual(disk['pruneWouldRemove'], [])


if __name__ == '__main__':
    unittest.main()
