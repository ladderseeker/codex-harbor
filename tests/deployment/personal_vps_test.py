import copy
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import subprocess

SCRIPT = Path(__file__).resolve().parents[2] / 'infra/personal-vps/harbor-personal'
loader = importlib.machinery.SourceFileLoader('personal_vps', str(SCRIPT))
spec = importlib.util.spec_from_loader(loader.name, loader)
personal = importlib.util.module_from_spec(spec)
loader.exec_module(personal)


class PersonalVpsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='harbor-p015-')
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name).resolve()
        (self.base / 'release').mkdir()
        (self.base / 'project').mkdir()
        self.c = dict(instance='test', origin='https://harbor.example.org',
                      oidcIssuer='https://identity.example.org', oidcClientId='harbor',
                      ownerSubject='owner', oidcSecretFile=None, release=str(self.base / 'release'),
                      user='harbor-test', apiPort=3000, databasePort=5544,
                      roots=[dict(id='da5e7d09-b8e7-4e1c-9c25-f64d06bf4866', name='Existing', path=str(self.base / 'project'))],
                      postgresImage='postgres:17.6-bookworm@sha256:' + 'a' * 64,
                      models=['gpt-5.4'], traefik=True, apparmorUserns=False)

    def test_render_is_private_non_overwriting_and_does_not_touch_projects(self):
        marker = self.base / 'project/keep'
        marker.write_text('untouched')
        output = self.base / 'bundle'
        personal.render(self.c, output)
        self.assertEqual(output.stat().st_mode & 0o777, 0o700)
        for p in output.iterdir():
            self.assertEqual(p.stat().st_mode & 0o777, 0o600)
        self.assertEqual(marker.read_text(), 'untouched')
        with self.assertRaises(ValueError):
            personal.render(self.c, output)
        env = (output / 'service.env').read_text()
        self.assertIn('HARBOR_PERSONAL_VPS_MODE="personal"', env)
        self.assertIn('HARBOR_HOST="127.0.0.1"', env)
        self.assertNotIn('HARBOR_LOCAL_MODE=', env)
        self.assertNotIn('OPENAI_API_KEY', env)
        self.assertNotIn('HARBOR_CONTROL_SOCKET=', env)
        self.assertNotIn('HARBOR_CREDENTIAL_KEY_FILE=', env)
        self.assertIn('HARBOR_PERSONAL_VPS_STATE_DIR=', env)

    def test_rendered_services_keep_admin_boundary_and_loopback_routing(self):
        files = personal.artifacts(self.c, 'a' * 64, None)
        compose = json.loads(files['compose.json'])
        self.assertEqual(compose['services']['postgres']['ports'], ['127.0.0.1:5544:5432'])
        self.assertEqual(compose['services']['routing']['network_mode'], 'host')
        self.assertNotIn('volumes', compose['services']['routing'])
        for role in ('api', 'supervisor'):
            unit = files['harbor-personal-test-' + role + '.service']
            self.assertIn('User=harbor-test\n', unit)
            self.assertIn('Restart=on-failure', unit)
            self.assertIn('ProtectSystem=strict', unit)
            self.assertIn('NoNewPrivileges=yes', unit)
            self.assertIn('KillMode=control-group', unit)
            self.assertIn('MemoryMax=', unit)
            self.assertIn('CPUQuota=', unit)
            self.assertIn('TasksMax=', unit)
            self.assertIn(self.c['roots'][0]['path'], unit)
            self.assertNotIn('ExecStart=/usr/bin/docker', unit)

    def test_preview_routes_only_fixed_distinct_origins_to_gateway(self):
        self.c['previews'] = [{'name': 'App', 'port': 3100, 'origin': 'https://preview.example.org'}]
        self.c['previewPort'] = 3350
        personal.validate(self.c)
        files = personal.artifacts(self.c, 'a' * 64, None)
        labels = json.loads(files['compose.json'])['services']['routing']['labels']
        self.assertEqual(labels['traefik.http.services.harbor-personal-test-preview-0.loadbalancer.server.port'], '3350')
        self.assertIn('HARBOR_PERSONAL_PREVIEWS=', files['service.env'])
        for port in (3000, 5544, 3350):
            self.c['previews'][0]['port'] = port
            with self.assertRaises(ValueError):
                personal.validate(self.c)
        self.c['previews'][0]['port'] = 3100
        self.c['previews'][0]['origin'] = self.c['origin']
        with self.assertRaises(ValueError):
            personal.validate(self.c)

    def test_apparmor_opt_in_is_exact_binary_only(self):
        files = personal.artifacts(self.c, 'a' * 64, None)
        self.assertFalse(any(k.endswith('.apparmor') for k in files))
        self.c['apparmorUserns'] = True
        files = personal.artifacts(self.c, 'a' * 64, None)
        profile = files['harbor-personal-test.apparmor']
        self.assertIn(self.c['release'] + '/bin/codex flags=(unconfined)', profile)
        self.assertIn('userns,', profile)
        self.assertNotIn('*', profile)
        self.assertNotIn('capability', profile)

    def test_environment_retains_literal_secrets(self):
        env = personal.environment(self.c, 'a' * 64, 'literal-$HOME-\"-é-\\')
        self.assertIn('literal-$HOME-', env)
        self.assertIn('é', env)
        with self.assertRaises(ValueError):
            personal.environment(self.c, 'a' * 64, 'bad\nsecret')

    def test_rejects_unsafe_configuration(self):
        cases = [('user', 'root'), ('apiPort', 443), ('databasePort', 3000),
                 ('origin', 'http://harbor.example.org'), ('origin', 'https://harbor.example.org/'),
                 ('origin', 'https://harbor.example.org:443'), ('origin', 'https://harbor.example.org:8443'),
                 ('oidcIssuer', 'https://127.0.0.1'), ('instance', 'test%h'),
                 ('release', str(self.base) + '/release/../release'),
                 ('postgresImage', 'postgres:latest'), ('models', [])]
        for key, value in cases:
            with self.subTest(key=key, value=value):
                c = copy.deepcopy(self.c)
                c[key] = value
                with self.assertRaises(ValueError):
                    personal.validate(c)
        c = copy.deepcopy(self.c)
        c['extraEnvironment'] = {'NODE_TLS_REJECT_UNAUTHORIZED': '0'}
        with self.assertRaises(ValueError):
            personal.validate(c)

    def test_rejects_system_roots_overlap_and_symlinks(self):
        for p in ('/home', '/var', '/tmp', '/etc', '/', self.c['release']):
            with self.subTest(path=p):
                c = copy.deepcopy(self.c)
                c['roots'][0]['path'] = p
                with self.assertRaises(ValueError):
                    personal.validate(c)
        alias = self.base / 'alias'
        alias.symlink_to(self.base / 'project')
        self.c['roots'][0]['path'] = str(alias)
        with self.assertRaises(ValueError):
            personal.validate(self.c)

    @unittest.skipUnless(Path('/root').is_dir(), 'Explicit /root admission is a Linux host contract')
    def test_explicit_root_browse_ceiling_is_supported_without_registering_projects(self):
        self.c['roots'][0]['path'] = '/root'
        personal.validate(self.c)
        files = personal.artifacts(self.c, 'a' * 64, None)
        self.assertIn(' /root\n', files['harbor-personal-test-supervisor.service'])
        self.assertIn(' /root\n', files['harbor-personal-test-api.service'])
        self.assertIn('\\"path\\":\\"/root\\"', files['service.env'])
        self.assertNotIn('INSERT', ''.join(files.values()))
        with self.assertRaises(ValueError):
            personal.outside_projects(self.c, '/root/candidate.json')
        with self.assertRaises(ValueError):
            personal.render(self.c, '/root/harbor-must-not-create')
        # The editable checkout is beneath /root; it cannot be an installed release.
        self.c['release'] = str(SCRIPT.parents[2])
        if Path('/root') in SCRIPT.parents:
            with self.assertRaises(ValueError):
                personal.validate(self.c)

    def test_readable_traversable_browse_root_does_not_need_write_access(self):
        observed = []
        def permissions(command):
            observed.append(command[-2])
            if command[-2] == '-w':
                raise subprocess.CalledProcessError(1, command)
        with patch.object(personal, 'run', side_effect=permissions):
            personal.check_browse_access(self.c)
        self.assertEqual(set(observed), {'-r', '-x'})
        for denied in ('-r', '-x'):
            def reject(command):
                if command[-2] == denied:
                    raise subprocess.CalledProcessError(1, command)
            with self.subTest(denied=denied), patch.object(personal, 'run', side_effect=reject):
                with self.assertRaises(subprocess.CalledProcessError):
                    personal.check_browse_access(self.c)

    def test_native_distribution_rejects_missing_helper_and_resources(self):
        import platform
        native = self.base / 'native'
        native.mkdir()
        target = {'x86_64': 'x86_64-unknown-linux-musl', 'aarch64': 'aarch64-unknown-linux-musl'}.get(platform.machine())
        if target is None:
            self.skipTest('Unsupported personal VPS architecture')
        metadata = {'layoutVersion': 1, 'version': '0.153.4', 'target': target,
                    'variant': 'codex', 'entrypoint': 'bin/codex',
                    'resourcesDir': 'codex-resources', 'pathDir': 'codex-path'}
        (native / 'codex-package.json').write_text(json.dumps(metadata))
        for name in personal.NATIVE_EXECUTABLES:
            p = native / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(b'fixture executable')
            p.chmod(0o755)
        personal.validate_native_distribution(native, require_root=False)
        for name in personal.NATIVE_EXECUTABLES:
            p = native / name
            saved = p.with_suffix('.saved')
            p.rename(saved)
            with self.subTest(missing=name), self.assertRaises(ValueError):
                personal.validate_native_distribution(native, require_root=False)
            p.symlink_to(saved)
            with self.subTest(symlink=name), self.assertRaises(ValueError):
                personal.validate_native_distribution(native, require_root=False)
            p.unlink()
            saved.rename(p)
        metadata['version'] = '0.154.0'
        (native / 'codex-package.json').write_text(json.dumps(metadata))
        with self.assertRaises(ValueError):
            personal.validate_native_distribution(native, require_root=False)

    def test_packager_preserves_full_vendor_layout_and_manifest(self):
        import platform
        target = {'x86_64': 'x86_64-unknown-linux-musl', 'aarch64': 'aarch64-unknown-linux-musl'}.get(platform.machine())
        if not target:
            self.skipTest('Unsupported personal VPS architecture')
        package_spec = importlib.util.spec_from_file_location('personal_package', SCRIPT.with_name('package-release.py'))
        packager = importlib.util.module_from_spec(package_spec)
        package_spec.loader.exec_module(packager)
        source, vendor = self.base / 'source', self.base / 'vendor'
        for name in ('apps/web/dist', 'packages', 'infra', 'node_modules'):
            (source / name).mkdir(parents=True)
        for name in ('apps/web/dist/index.html', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json'):
            (source / name).write_text('fixture')
        for name in personal.NATIVE_EXECUTABLES:
            path = vendor / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('fixture-' + name)
            path.chmod(0o755)
        metadata = {'layoutVersion': 1, 'version': '0.153.4', 'target': target, 'variant': 'codex',
                    'entrypoint': 'bin/codex', 'resourcesDir': 'codex-resources', 'pathDir': 'codex-path'}
        (vendor / 'codex-package.json').write_text(json.dumps(metadata))
        node = self.base / 'node'
        node.write_text('fixture-node')
        node.chmod(0o755)
        output = self.base / 'packaged'
        pnpm_package, pnpm_binary = self.base / 'pnpm-package', self.base / 'pnpm-native'
        (pnpm_package / 'dist').mkdir(parents=True)
        (pnpm_package / 'package.json').write_text(json.dumps({'name': 'pnpm', 'version': '12.3.4'}))
        pnpm_binary.write_text('fixture-pnpm')
        pnpm_binary.chmod(0o755)
        def command(args, **kwargs):
            value = ('v24.11.1' if args[0] == str(node) else '12.3.4' if args[0] == str(pnpm_binary) else 'codex-cli 0.153.4') if args[-1] == '--version' else 'fixture-revision'
            return subprocess.CompletedProcess(args, 0, stdout=value)
        with patch.object(packager.subprocess, 'run', side_effect=command):
            packager.package(source, node, vendor, output, pnpm_package, pnpm_binary)
        for name in personal.NATIVE_EXECUTABLES:
            self.assertEqual((output / 'release' / name).read_bytes(), (vendor / name).read_bytes())
        artifact = json.loads((output / 'release/artifact.json').read_text())
        self.assertEqual(artifact['nativePackage'], metadata)
        self.assertEqual(artifact['pnpm'], '12.3.4')
        self.assertIn('toolchain/pnpm/pnpm-native', (output / 'release/bin/pnpm').read_text())
        self.assertEqual((output / 'release/toolchain/pnpm/pnpm-native').read_bytes(), pnpm_binary.read_bytes())
        self.assertTrue((output / 'harbor-personal-candidate.tar.gz').exists())
        with self.assertRaises(ValueError):
            packager.package(source, node, vendor, output, pnpm_package, pnpm_binary)

    def test_private_candidate_output_cannot_be_inside_approved_root(self):
        with self.assertRaises(ValueError):
            personal.render(self.c, self.base / 'project/private-bundle')
        self.assertFalse((self.base / 'project/private-bundle').exists())
        with self.assertRaises(ValueError):
            personal.outside_projects(self.c, self.base / 'project/config.json')

    def test_rejects_secrets_in_projects_or_public_files(self):
        secret = self.base / 'project/oidc'
        secret.write_text('private-secret')
        secret.chmod(0o600)
        self.c['oidcSecretFile'] = str(secret)
        with self.assertRaises(ValueError):
            personal.validate(self.c)
        secret = self.base / 'oidc'
        secret.write_text('private-secret')
        secret.chmod(0o644)
        self.c['oidcSecretFile'] = str(secret)
        with self.assertRaises(ValueError):
            personal.validate(self.c)
        secret.chmod(0o600)
        personal.validate(self.c)


if __name__ == '__main__':
    unittest.main()
