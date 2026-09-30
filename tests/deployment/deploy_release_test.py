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
import ssl
import stat
import subprocess
import sys
import tarfile
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


# Small stand-ins for the four pinned bootstrap downloads, with the members that bootstrap reads.
VENDOR = 'package/vendor/x86_64-unknown-linux-musl/'
CODEX_PACKAGE = json.dumps({'layoutVersion': 1, 'version': '0.153.4', 'target': 'x86_64-unknown-linux-musl',
                            'variant': 'codex', 'entrypoint': 'bin/codex', 'resourcesDir': 'codex-resources',
                            'pathDir': 'codex-path'}).encode()
NATIVE = {'bin/codex': 0o755, 'bin/codex-code-mode-host': 0o755, 'codex-resources/bwrap': 0o755,
          'codex-resources/zsh/bin/zsh': 0o755, 'codex-path/rg': 0o755}
PNPM_PACKAGE = {'package.json': (b'{"name": "pnpm", "version": "12.3.4"}\n', 0o644),
                'dist/pnpm.cjs': (b'// pnpm\n', 0o644), 'dist/node-gyp-bin/node-gyp': (b'#!/bin/sh\n', 0o755),
                'bin/pnpm.mjs': (b'// entry\n', 0o644)}


def archive(entries, compression='gz'):
    """A tar archive of (name, kind, value, mode) entries whose owner is a nonroot archive user."""
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode='w:' + compression) as stream:
        for name, kind, value, mode in entries:
            info = tarfile.TarInfo(name)
            info.mode, info.uid, info.gid, info.uname = mode, 4321, 4321, 'builder'
            if kind == 'file':
                info.size = len(value)
                stream.addfile(info, io.BytesIO(value))
                continue
            info.type = {'dir': tarfile.DIRTYPE, 'symlink': tarfile.SYMTYPE, 'hardlink': tarfile.LNKTYPE,
                         'device': tarfile.CHRTYPE}[kind]
            info.linkname = value or ''
            stream.addfile(info)
    return buffer.getvalue()


def native_file(relative):
    return ('#!/bin/sh\necho ' + relative + '\n').encode()


def fake_downloads(codex_extra=(), node_binary=None):
    """URL -> bytes for the four bootstrap inputs, and the constants that pin them."""
    node = archive([('node-v24.11.1-linux-x64', 'dir', None, 0o755), ('node-v24.11.1-linux-x64/bin', 'dir', None, 0o755),
                    node_binary or ('node-v24.11.1-linux-x64/bin/node', 'file', b'#!/bin/sh\necho v24.11.1\n', 0o755),
                    ('node-v24.11.1-linux-x64/bin/npm', 'symlink', '../lib/node_modules/npm/bin/npm-cli.js', 0o777),
                    ('node-v24.11.1-linux-x64/README.md', 'file', b'node\n', 0o644)], 'xz')
    codex = archive([('package/package.json', 'file', b'{"name": "@openai/codex"}\n', 0o644),
                     ('package/README.md', 'file', b'codex\n', 0o644),
                     (VENDOR + 'codex-package.json', 'file', CODEX_PACKAGE, 0o644)]
                    + [(VENDOR + relative, 'file', native_file(relative), mode) for relative, mode in NATIVE.items()]
                    + [(VENDOR + 'codex-path/codex', 'symlink', '../bin/codex', 0o777)] + list(codex_extra))
    pnpm = archive([('package/' + relative, 'file', data, mode) for relative, (data, mode) in PNPM_PACKAGE.items()])
    native = archive([('package/package.json', 'file', b'{"name": "@pnpm/exe.linux-x64"}\n', 0o644),
                      ('package/pnpm', 'file', b'#!/bin/sh\necho 12.3.4\n', 0o755),
                      ('package/LICENSE', 'file', b'license\n', 0o644)])
    served, pins = {}, {}
    for key, name, data in (('NODE', 'node-v24.11.1-linux-x64.tar.xz', node), ('CODEX', 'codex-0.153.4-linux-x64.tgz', codex),
                            ('PNPM', 'pnpm-12.3.4.tgz', pnpm), ('PNPM_EXE', 'exe.linux-x64-12.3.4.tgz', native)):
        url = 'https://downloads.test/' + name
        served[url] = data
        pins[key + '_URL'], pins[key + '_SHA256'] = url, hashlib.sha256(data).hexdigest()
    return served, pins


class Response(io.BytesIO):
    def __init__(self, data, url):
        super().__init__(data)
        self.url = url

    def geturl(self):
        return self.url


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
        real_layout, host = deploy.installer.layout, str(self.base / 'host')
        def layout(c):
            # The installer's own naming, relocated below this test's directory.
            return tuple(host + value if value.startswith('/') else value for value in real_layout(c))
        for patcher in (patch.multiple(deploy, RELEASES=self.releases, BACKUPS=self.backups, WORK=self.work,
                                       BUILD_STATE=self.build_state, BUILD_CACHE=self.build_cache),
                        patch.object(deploy.installer, 'layout', new=layout),
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
                    self.assertIn('mounted at ' + str(deploy.mount_point(self.base)) + ', which has', message)
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
        self.assertIn('mounted at ' + str(deploy.mount_point(self.base)) + ', which has', message)
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

    def bootstrap_args(self, revision=REVISION):
        bundle = self.base / 'harbor.bundle'
        bundle.write_bytes(b'bundle')
        return argparse.Namespace(bundle=str(bundle), revision=revision)

    @contextlib.contextmanager
    def downloads(self, served, pins):
        """Serve the pinned downloads from memory and record each request."""
        requests = []
        def urlopen(url, timeout=None, context=None):
            requests.append((url, timeout, context))
            return Response(served[url], url)
        with patch.multiple(deploy, **pins), patch.object(deploy.urllib.request, 'urlopen', side_effect=urlopen), \
                patch.object(deploy.platform, 'system', return_value='Linux'), \
                patch.object(deploy.platform, 'machine', return_value='x86_64'):
            yield requests

    def fresh_releases(self):
        """A release root that does not exist yet, below an existing parent like /opt."""
        (self.base / 'fresh-opt').mkdir()
        return self.base / 'fresh-opt/harbor-personal/releases'

    def installed_layout(self, root):
        """An installed release holding the same pinned native files as fake_downloads, for native_inputs."""
        release = root / 'release'
        files = {'bin/node': (b'#!/bin/sh\necho v24.11.1\n', 0o755), 'codex-package.json': (CODEX_PACKAGE, 0o644),
                 'toolchain/pnpm/pnpm-native': (b'#!/bin/sh\necho 12.3.4\n', 0o755),
                 'apps/api/src/main.ts': (b'// api\n', 0o644), 'node_modules/tsx/package.json': (b'{}\n', 0o644),
                 'bin/pnpm': (b'#!/bin/sh\n', 0o755), 'bin/pnpx': (b'#!/bin/sh\n', 0o755)}
        files.update({relative: (native_file(relative), mode) for relative, mode in NATIVE.items()})
        files.update({'toolchain/pnpm/' + relative: value for relative, value in PNPM_PACKAGE.items()})
        for relative, (data, mode) in files.items():
            (release / relative).parent.mkdir(parents=True, exist_ok=True)
            (release / relative).write_bytes(data)
            os.chmod(release / relative, mode)
        (release / 'codex-path/codex').symlink_to('../bin/codex')
        manifest = [[relative, hashlib.sha256(data).hexdigest()] for relative, (data, _) in sorted(files.items())]
        (release / 'artifact.json').write_text(json.dumps({'profile': 'personal-vps', 'files': manifest}))
        return release

    def test_p037_01_bootstrap_inputs_take_the_installed_release_layout_from_verified_https_downloads(self):
        served, pins = fake_downloads()
        target = self.base / 'bootstrap-inputs'
        target.mkdir()
        with self.downloads(served, pins) as requests:
            deploy.bootstrap_inputs(target)
        self.assertEqual([url for url, _, _ in requests], [pins[k + '_URL'] for k in ('NODE', 'CODEX', 'PNPM', 'PNPM_EXE')])
        for _, timeout, context in requests:
            self.assertEqual(timeout, deploy.DOWNLOAD_TIMEOUT)
            self.assertIsInstance(context, ssl.SSLContext)
            self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
            self.assertTrue(context.check_hostname)
        expected = self.base / 'native-inputs'
        expected.mkdir()
        with patch.object(deploy.platform, 'machine', return_value='x86_64'):
            deploy.native_inputs(self.installed_layout(self.base / 'installed-layout'), expected)
        # The same layout, names, modes, contents and links; only each bin/pnpm names its own directory.
        got, want = snapshot(target), snapshot(expected)
        self.assertEqual({k: v for k, v in got.items() if k != 'bin/pnpm'}, {k: v for k, v in want.items() if k != 'bin/pnpm'})
        self.assertEqual((target / 'bin/pnpm').read_text(), '#!/bin/sh\nexec ' + str(target / 'pnpm-native') + ' "$@"\n')
        self.assertEqual(set(got), {'node', 'pnpm-native', 'bin', 'bin/node', 'bin/pnpm', 'vendor', 'vendor/bin',
                                    'vendor/bin/codex', 'vendor/bin/codex-code-mode-host', 'vendor/codex-package.json',
                                    'vendor/codex-resources', 'vendor/codex-resources/bwrap', 'vendor/codex-resources/zsh',
                                    'vendor/codex-resources/zsh/bin', 'vendor/codex-resources/zsh/bin/zsh',
                                    'vendor/codex-path', 'vendor/codex-path/rg', 'vendor/codex-path/codex',
                                    'pnpm', 'pnpm/package.json', 'pnpm/dist', 'pnpm/dist/pnpm.cjs',
                                    'pnpm/dist/node-gyp-bin', 'pnpm/dist/node-gyp-bin/node-gyp', 'pnpm/bin',
                                    'pnpm/bin/pnpm.mjs'})
        self.assertEqual(got['vendor/codex-path/codex'], ('link', '../bin/codex'))
        self.assertEqual(got['pnpm/bin/pnpm.mjs'][1], 0o755)
        self.assertEqual(got['vendor/codex-package.json'][1], 0o644)
        for path in [target] + list(target.rglob('*')):
            # The data filter drops the archive's owner; extraction leaves this run's identity.
            self.assertEqual(os.lstat(path).st_uid, os.getuid(), path)

    def test_p037_01_bootstrap_refuses_before_writing_anything(self):
        served, pins = fake_downloads()
        self.releases = self.fresh_releases()
        name = 'bootstrap-' + REVISION[:12]
        cases = [('Bootstrap requires root', {'geteuid': 1000}, REVISION),
                 ('Linux x86_64 only', {'machine': 'aarch64'}, REVISION),
                 ('Linux x86_64 only', {'system': 'Darwin'}, REVISION)]
        cases += [('Full commit SHA required', {}, revision)
                  for revision in (REVISION[:12], REVISION.upper(), REVISION + '0', REVISION[:-1] + 'g')]
        args = self.bootstrap_args()
        with self.downloads(served, pins) as requests, patch.object(deploy, 'RELEASES', self.releases), \
                patch.object(deploy.subprocess, 'run', side_effect=AssertionError('no build may start')):
            before = snapshot(self.base, strict=True)
            for message, fault, revision in cases:
                with self.subTest(message=message, fault=fault, revision=revision), \
                        patch.object(deploy.os, 'geteuid', return_value=fault.get('geteuid', 0)), \
                        patch.object(deploy.platform, 'machine', return_value=fault.get('machine', 'x86_64')), \
                        patch.object(deploy.platform, 'system', return_value=fault.get('system', 'Linux')), \
                        self.assertRaisesRegex(ValueError, message):
                    deploy.bootstrap(argparse.Namespace(bundle=args.bundle, revision=revision))
            with self.subTest('missing bundle'), self.assertRaisesRegex(ValueError, 'Source bundle not found'):
                deploy.bootstrap(argparse.Namespace(bundle=str(self.base / 'missing.bundle'), revision=REVISION))
            self.assertEqual(snapshot(self.base, strict=True), before)
            # An installed instance, found as prune finds one.
            self.configure('seekworld')
            before = snapshot(self.base, strict=True)
            with self.assertRaisesRegex(ValueError, r'instance configuration \(seekworld\); build its releases with build'):
                deploy.bootstrap(args)
            self.assertEqual(snapshot(self.base, strict=True), before)
            shutil.rmtree(self.base / 'host')
            # A staging directory from an earlier run is left for inspection.
            staging = self.releases / ('.staging-' + name)
            staging.mkdir(parents=True)
            (staging / 'evidence').write_text('inspect me')
            before = snapshot(self.base, strict=True)
            with self.assertRaisesRegex(ValueError, 'Staging path exists; inspect it first: ' + str(staging)):
                deploy.bootstrap(args)
            self.assertEqual(snapshot(self.base, strict=True), before)
            shutil.rmtree(self.releases.parent)
            self.assertEqual(requests, [])

    def test_p037_01_bootstrap_refuses_before_writing_when_space_is_short(self):
        served, pins = fake_downloads()
        self.releases = self.fresh_releases()
        need, total = deploy.BOOTSTRAP_NEED, 100 * GIB
        reserve = deploy.reserve(total)
        args = self.bootstrap_args()
        for free, refused in ((need + reserve - 1, True), (need + reserve, False)):
            before = snapshot(self.base, strict=True)
            with self.subTest(free=free), self.downloads(served, pins) as requests, \
                    patch.object(deploy, 'RELEASES', self.releases), \
                    patch.object(deploy.shutil, 'disk_usage', return_value=Usage(total, total - free, free)) as disk, \
                    patch.object(deploy, 'bootstrap_inputs', side_effect=RuntimeError('stop after the check')) as inputs, \
                    patch.object(deploy.subprocess, 'run') as run:
                if refused:
                    with self.assertRaises(ValueError) as caught:
                        deploy.bootstrap(args)
                    message = str(caught.exception)
                    self.assertTrue(message.startswith('Bootstrap needs ' + str(need) + ' bytes plus a reserve of '
                                                       + str(reserve) + ' bytes'), message)
                    self.assertIn(str(free) + ' bytes free; nothing was changed', message)
                    inputs.assert_not_called()
                    self.assertEqual(snapshot(self.base, strict=True), before)
                else:
                    with self.assertRaisesRegex(RuntimeError, 'stop after the check'):
                        deploy.bootstrap(args)
                    inputs.assert_called_once()
                    self.assertEqual(list((self.work / 'inputs').iterdir()), [])
                # The build's locations: deploy work, the build unit's state and cache, and the release root.
                self.assertEqual({Path(c.args[0]) for c in disk.call_args_list}, {self.base})
                run.assert_not_called()
                self.assertEqual(requests, [])
        self.assertEqual(os.listdir(self.releases), [])

    def test_p037_01_pinned_hash_mismatch_refuses_and_deletes_the_inputs(self):
        served, pins = fake_downloads()
        pins['CODEX_SHA256'] = hashlib.sha256(b'another file').hexdigest()
        self.releases = self.fresh_releases()
        with self.downloads(served, pins) as requests, patch.object(deploy, 'RELEASES', self.releases), \
                patch.object(deploy, 'unpack', wraps=deploy.unpack) as unpack, \
                patch.object(deploy.shutil, 'disk_usage', return_value=Usage(100 * GIB, 0, 100 * GIB)), \
                patch.object(deploy.subprocess, 'run', side_effect=AssertionError('no build may start')):
            with self.assertRaisesRegex(ValueError, r'Pinned SHA-256 mismatch for codex-0\.153\.4-linux-x64\.tgz'):
                deploy.bootstrap(self.bootstrap_args())
            unpack.assert_not_called()
        self.assertEqual([url for url, _, _ in requests], [pins['NODE_URL'], pins['CODEX_URL']])
        self.assertEqual(list((self.work / 'inputs').iterdir()), [])
        self.assertFalse(os.path.lexists(self.build_state / 'harbor-deploy-build'))
        self.assertEqual(os.listdir(self.releases), [])

    def test_p037_01_archive_members_that_escape_are_refused(self):
        outside = self.base / 'escaped'
        variants = {
            'parent directory': [(VENDOR + '../../escaped', 'file', b'x', 0o644)],
            'symbolic link out of vendor': [(VENDOR + 'codex-path/out', 'symlink', '../../escaped', 0o777)],
            'absolute symbolic link': [(VENDOR + 'codex-path/abs', 'symlink', str(outside), 0o777)],
            'hard link out of vendor': [(VENDOR + 'bin/hard', 'hardlink', 'package/package.json', 0o644)],
            'device': [(VENDOR + 'codex-resources/null', 'device', None, 0o666)],
        }
        for label, extra in variants.items():
            served, pins = fake_downloads(codex_extra=extra)
            target = self.base / ('inputs-' + label.replace(' ', '-'))
            target.mkdir()
            with self.subTest(label), self.downloads(served, pins), \
                    self.assertRaisesRegex(ValueError, 'codex-0.153.4-linux-x64.tgz'):
                deploy.bootstrap_inputs(target)
            self.assertFalse(os.path.lexists(outside))
            self.assertFalse(os.path.lexists(target / 'escaped'))
        served, pins = fake_downloads(node_binary=('node-v24.11.1-linux-x64/bin/node', 'symlink', '/usr/bin/node', 0o777))
        target = self.base / 'inputs-linked-node'
        target.mkdir()
        with self.downloads(served, pins), self.assertRaisesRegex(ValueError, 'bin/node must be a regular file'):
            deploy.bootstrap_inputs(target)
        self.assertFalse(os.path.lexists(target / 'node'))

    def test_p037_01_bootstrap_stages_its_release_with_the_build_unit_and_properties(self):
        calls = []
        def record(args, **kwargs):
            calls.append(args)
            return self.fake_build_run(args, **kwargs)
        with patch.object(deploy, 'verify_release', return_value={}), patch.object(deploy, 'native_inputs'), \
                patch.object(deploy.shutil, 'disk_usage', return_value=Usage(100 * GIB, 0, 100 * GIB)), \
                patch.object(deploy.os, 'lchown'), patch.object(deploy.subprocess, 'run', side_effect=record), \
                contextlib.redirect_stdout(io.StringIO()):
            deploy.build(self.build_args())
        served, pins = fake_downloads()
        self.releases = self.fresh_releases()
        output = io.StringIO()
        with self.downloads(served, pins), patch.object(deploy, 'RELEASES', self.releases), \
                patch.object(deploy, 'verify_release', return_value={}) as verify, \
                patch.object(deploy.shutil, 'disk_usage', return_value=Usage(100 * GIB, 0, 100 * GIB)), \
                patch.object(deploy.os, 'lchown'), patch.object(deploy.subprocess, 'run', side_effect=record), \
                contextlib.redirect_stdout(output):
            deploy.bootstrap(self.bootstrap_args())
        name = 'bootstrap-' + REVISION[:12]
        release = self.releases / name
        self.assertEqual(os.listdir(self.releases), [name])
        self.assertEqual(os.readlink(release / 'bin/link'), 'node')
        for directory in (self.releases.parent, self.releases):
            self.assertEqual(stat.S_IMODE(os.lstat(directory).st_mode), 0o755, directory)
        self.assertEqual([c.args for c in verify.call_args_list], [(self.releases / ('.staging-' + name), REVISION)])
        result = json.loads(output.getvalue().splitlines()[-1])
        self.assertEqual(set(result), {'release', 'revision', 'archiveSha256', 'fileCount', 'manifestSha256', 'reused'})
        self.assertEqual((result['release'], result['revision'], result['reused']), (str(release), REVISION, False))
        self.assertEqual(result['archiveSha256'], hashlib.sha256(b'archive').hexdigest())
        self.assertEqual(list((self.work / 'inputs').iterdir()), [])
        self.assertEqual(list((self.build_state / 'harbor-deploy-build').iterdir()), [])
        # One build unit and property set for both commands; only the unit name and the run differ.
        def normalized(args):
            run_id = next(a for a in args if a.startswith('StateDirectory=')).split('/', 1)[1]
            return [a.replace(run_id, 'RUN') for a in args if not a.startswith('--unit=')]
        built, bootstrapped = calls
        self.assertIn('--unit=harbor-deploy-build-' + REVISION[:12], built)
        self.assertIn('--unit=harbor-deploy-build-bootstrap-' + REVISION[:12], bootstrapped)
        self.assertEqual(normalized(built), normalized(bootstrapped))
        self.assertTrue(normalized(built)[-1].startswith('set -eu; cd "$STATE_DIRECTORY"; git clone'))

    def test_p037_01_bootstrap_failure_removes_its_inputs_and_build_state(self):
        served, pins = fake_downloads()
        self.releases = self.fresh_releases()
        def fail(args, **kwargs):
            self.fake_build_run(args, **kwargs)
            raise subprocess.CalledProcessError(1, args)
        with self.downloads(served, pins), patch.object(deploy, 'RELEASES', self.releases), \
                patch.object(deploy.shutil, 'disk_usage', return_value=Usage(100 * GIB, 0, 100 * GIB)), \
                patch.object(deploy.subprocess, 'run', side_effect=fail), self.assertRaises(subprocess.CalledProcessError):
            deploy.bootstrap(self.bootstrap_args())
        self.assertEqual(list((self.work / 'inputs').iterdir()), [])
        self.assertEqual(list((self.build_state / 'harbor-deploy-build').iterdir()), [])
        self.assertEqual(os.listdir(self.releases), [])

    def test_p037_01_bootstrap_reuses_a_release_that_verifies_against_the_revision(self):
        served, pins = fake_downloads()
        self.releases = self.fresh_releases()
        release = self.releases / ('bootstrap-' + REVISION[:12])
        (release / 'bin').mkdir(parents=True)
        args = self.bootstrap_args()
        before = snapshot(self.base, strict=True)
        output = io.StringIO()
        with self.downloads(served, pins) as requests, patch.object(deploy, 'RELEASES', self.releases), \
                patch.object(deploy, 'verify_release', return_value={}) as verify, \
                patch.object(deploy.subprocess, 'run', side_effect=AssertionError('no build may start')), \
                contextlib.redirect_stdout(output):
            deploy.bootstrap(args)
        verify.assert_called_once_with(release, REVISION)
        self.assertEqual(output.getvalue().splitlines(), ['[deploy] Release already staged and verified: ' + str(release),
                                                          json.dumps({'release': str(release), 'reused': True})])
        with self.downloads(served, pins), patch.object(deploy, 'RELEASES', self.releases), \
                patch.object(deploy, 'verify_release', side_effect=ValueError('Release revision mismatch')), \
                patch.object(deploy.subprocess, 'run', side_effect=AssertionError('no build may start')), \
                self.assertRaisesRegex(ValueError, 'Release revision mismatch'):
            deploy.bootstrap(args)
        self.assertEqual(snapshot(self.base, strict=True), before)
        self.assertEqual(requests, [])

    def test_p037_01_bootstrap_takes_a_bundle_and_revision_and_no_instance(self):
        bundle = str(self.base / 'harbor.bundle')
        with patch.object(deploy, 'bootstrap') as bootstrap, \
                patch('sys.argv', ['deploy-release', 'bootstrap', '--bundle', bundle, '--revision', REVISION]):
            deploy.main()
        self.assertEqual(vars(bootstrap.call_args.args[0]), {'action': 'bootstrap', 'bundle': bundle, 'revision': REVISION})
        with patch('sys.argv', ['deploy-release', 'bootstrap', '--instance', 'seekworld', '--bundle', bundle,
                                '--revision', REVISION]), \
                contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            deploy.main()

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
        # The newest valid receipt, but a name starting with a dot is left alone as under the release root.
        self.checkpoint_dir('.hidden-20260930T110000Z', self.receipt('old-2', '20260930T110000Z'))
        scratch = '/state/codex-home/.tmp'
        return {str(self.releases / 'old-1'), str(self.releases / 'old-2'),
                str(self.backups / 'r2-20260930T020000Z'), str(self.backups / 'r1-20260929T010000Z'),
                str(self.backups / 'r4-20260930T040000Z') + scratch, str(self.backups / 'r3-20260930T030000Z') + scratch}

    # Backup directories that deploy-release did not write, or whose name starts with a dot: never touched.
    UNRECOGNIZED = ('manual-backup', 'missing-field-20260930T050000Z', 'mismatch-20260930T060000Z',
                    'number-20260930T080000Z', 'badstamp-2026-09-30', 'invalid-date-20261399T990000Z',
                    'not-json-20260930T100000Z', 'linked-receipt-20260930T090000Z', '.hidden-20260930T110000Z')

    def configure(self, name):
        """An instance configuration where the (relocated) installer layout puts it."""
        etc = Path(deploy.installer.layout({'instance': name})[1])
        etc.mkdir(parents=True, exist_ok=True)
        (etc / 'config.json').write_text(json.dumps({'instance': name}) + '\n')
        return etc

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
        for name in self.UNRECOGNIZED:
            self.assertTrue((self.backups / name / 'state/codex-home/.tmp/plugins-clone-x/pack').is_file(), name)
        reasons = {e['name']: e['reason'] for e in plan['releases']}
        self.assertEqual(reasons['installed'], 'installed release')
        self.assertEqual(reasons['running'], 'a process runs from it')
        self.assertEqual(reasons['kept-a'], 'named by a kept checkpoint')
        checkpoints = {e['name']: e for e in plan['checkpoints']}
        self.assertEqual((checkpoints['.hidden-20260930T110000Z']['keep'],
                          checkpoints['.hidden-20260930T110000Z']['reason']), (True, 'hidden directory'))
        self.assertEqual(checkpoints['manual-backup']['reason'], 'not a checkpoint written by deploy-release')
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
        self.assertTrue(disk['pruneAvailable'])
        self.assertNotIn('pruneUnavailableReason', disk)
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

    def test_p035_07_prune_refuses_and_the_report_shows_it_unavailable_on_a_host_with_another_instance(self):
        self.populate_state()
        self.prune_layout()
        root = self.configure('p035').parent
        # Not instances: a file, a directory without a configuration and a name the installer never makes.
        (root / 'harbor-personal-candidate.json').write_text('{}\n')
        (root / 'harbor-personal-removed').mkdir()
        (root / 'harbor-personal-Upper').mkdir()
        (root / 'harbor-personal-Upper/config.json').write_text('{}\n')
        usage = Usage(80 * GIB, 50 * GIB, 30 * GIB)
        with patch.object(deploy, 'processes_from', side_effect=self.running), \
                patch.object(deploy.shutil, 'disk_usage', return_value=usage):
            self.assertEqual(deploy.configured_instances(), ['p035'])
            self.assertIsNone(deploy.prune_refusal(self.c))
            self.assertTrue(self.preflight()['disk']['pruneAvailable'])
            self.configure('other')
            self.assertEqual(deploy.configured_instances(), ['other', 'p035'])
            before = snapshot(self.base, strict=True)
            with self.assertRaisesRegex(ValueError, 'single-instance hosts only.*: other; nothing was changed'):
                deploy.prune(argparse.Namespace(instance='p035', keep_checkpoints=2))
            disk = self.preflight()['disk']
        self.assertEqual(snapshot(self.base, strict=True), before)
        self.assertFalse(disk['pruneAvailable'])
        self.assertEqual(disk['pruneUnavailableReason'],
                         'Prune supports single-instance hosts only, and this host has 1 other instance configuration: other')
        for key in ('releases', 'checkpoints', 'pruneKeepCheckpoints', 'pruneWouldRemove', 'pruneWouldFreeBytes'):
            self.assertNotIn(key, disk)
        self.assertTrue(disk['buildFits'] and disk['checkpointFits'])
        self.configure('zeta')
        self.assertEqual(deploy.prune_refusal(self.c), 'Prune supports single-instance hosts only, and this host has '
                                                       '2 other instance configurations: other, zeta')

    @contextlib.contextmanager
    def own_device(self, root):
        """Report root and everything below it on a device of its own, like a separately mounted disk."""
        real_stat = os.stat
        def fake_stat(path, *args, **kwargs):
            info = real_stat(path, *args, **kwargs)
            resolved = None if isinstance(path, int) else os.path.realpath(path)
            if resolved != str(root) and not (resolved or '').startswith(str(root) + os.sep):
                return info
            fields = list(info[:10])
            fields[2] = -1  # st_dev: a device that no real path has
            return os.stat_result(fields)
        with patch.object(deploy.os, 'stat', side_effect=fake_stat):
            yield

    def assert_linked_root_blocks_prune(self, root, target):
        """The report says why prune cannot run and labels root by its target's mount; prune refuses."""
        before = snapshot(self.base, strict=True)
        with patch.object(deploy, 'processes_from', return_value=[]), \
                patch.object(deploy.shutil, 'disk_usage', return_value=Usage(80 * GIB, 50 * GIB, 30 * GIB)):
            with self.own_device(target):
                disk = self.preflight()['disk']
            with self.assertRaisesRegex(ValueError, 'must be a real directory'):
                deploy.prune(argparse.Namespace(instance='p035', keep_checkpoints=1))
        self.assertEqual(snapshot(self.base, strict=True), before)
        self.assertFalse(disk['pruneAvailable'])
        self.assertEqual(disk['pruneUnavailableReason'], str(root) + ' must be a real directory')
        for key in ('releases', 'checkpoints', 'pruneKeepCheckpoints', 'pruneWouldRemove', 'pruneWouldFreeBytes'):
            self.assertNotIn(key, disk)
        self.assertEqual([(fs['mount'], fs['paths']) for fs in disk['filesystems'] if str(root) in fs['paths']],
                         [(str(target), [str(root)])])

    def test_p035_08_report_survives_a_linked_backup_root_and_prune_refuses(self):
        self.populate_state()
        target = self.outside / 'backups'
        target.mkdir(parents=True, mode=0o700)
        self.backups.symlink_to(target)
        # Behind the link: checkpoints that prune would otherwise remove or trim.
        for name, created in (('r2-20260930T020000Z', '20260930T020000Z'), ('r1-20260929T010000Z', '20260929T010000Z'),
                              ('r0-20260928T010000Z', '20260928T010000Z')):
            self.checkpoint_dir(name, self.receipt('installed', created))
        self.assert_linked_root_blocks_prune(self.backups, target)

    def test_p035_08_report_survives_a_linked_release_root_and_prune_refuses(self):
        target = self.outside / 'releases'
        target.parent.mkdir(parents=True)
        os.rename(self.releases, target)
        self.releases.symlink_to(target)
        # Behind the link: releases that prune would otherwise remove; the installed one is reached through it.
        for name in ('old-1', 'old-2'):
            self.release(name)
        self.assertTrue((self.releases / 'installed/bin/node').is_file())
        self.assert_linked_root_blocks_prune(self.releases, target)

    def test_running_the_script_from_a_release_writes_no_bytecode(self):
        # A release holds infra/personal-vps without bytecode, and its manifest check refuses unlisted files.
        release = self.base / 'release'
        shutil.copytree(SCRIPT.parent, release / 'infra/personal-vps', ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
        # A separate interpreter, since loading the script here already turned bytecode off in this process.
        # -E ignores PYTHONDONTWRITEBYTECODE and PYTHONPYCACHEPREFIX, so only the script decides.
        run = REAL_RUN([sys.executable, '-E', str(release / 'infra/personal-vps/deploy-release'), 'prune', '--help'],
                       cwd=self.base, env={'PATH': os.environ.get('PATH', '/usr/bin:/bin')},
                       capture_output=True, text=True, check=True)
        self.assertIn('--keep-checkpoints', run.stdout)
        self.assertEqual([str(p.relative_to(release)) for p in release.rglob('*')
                          if p.name == '__pycache__' or p.suffix == '.pyc'], [])


if __name__ == '__main__':
    unittest.main()
