#!/usr/bin/env python3
"""Create a fresh complete P015 release from built source and pinned native packages."""
import argparse
import hashlib
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile

loader = importlib.machinery.SourceFileLoader('personal_installer', str(Path(__file__).with_name('harbor-personal')))
spec = importlib.util.spec_from_loader(loader.name, loader)
installer = importlib.util.module_from_spec(spec)
loader.exec_module(installer)


def package(source, node, vendor, output):
    source, node, vendor, output = map(lambda p: Path(p).resolve(), (source, node, vendor, output))
    if output.exists():
        raise ValueError('Output exists; refusing overwrite')
    installer.validate_native_distribution(vendor, require_root=False)
    with tempfile.TemporaryDirectory(prefix='harbor-package-version-') as temporary:
        home = Path(temporary)
        (home / 'codex').mkdir(mode=0o700)
        env = {'PATH': '/usr/bin:/bin', 'HOME': str(home), 'CODEX_HOME': str(home / 'codex')}
        if subprocess.run([str(node), '--version'], env=env, check=True, capture_output=True, text=True).stdout.strip() != 'v24.11.1':
            raise ValueError('Pinned Node 24.11.1 required')
        if subprocess.run([str(vendor / 'bin/codex'), '--version'], env=env, check=True, capture_output=True, text=True).stdout.strip() != 'codex-cli 0.153.4':
            raise ValueError('Pinned Codex 0.153.4 required')
    for name in ('apps/web/dist/index.html', 'node_modules', 'pnpm-lock.yaml'):
        if not (source / name).exists():
            raise ValueError('Built source with locked installed dependencies required')
    output.mkdir(mode=0o700)
    release = output / 'release'
    release.mkdir(mode=0o755)
    for name in ('apps', 'packages', 'infra', 'node_modules'):
        shutil.copytree(source / name, release / name, symlinks=True,
                        ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
    for name in ('package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json'):
        shutil.copy2(source / name, release / name)
    # Preserve the vendor target's entire layout, including package metadata,
    # companion executables, sandbox/shell resources and PATH utilities.
    for entry in vendor.iterdir():
        target = release / entry.name
        if entry.is_symlink():
            raise ValueError('Vendor top-level symlinks are not supported')
        if entry.is_dir():
            shutil.copytree(entry, target, symlinks=True)
        else:
            shutil.copy2(entry, target)
    if (release / 'bin/node').exists():
        raise ValueError('Vendor unexpectedly contains Node')
    shutil.copy2(node, release / 'bin/node')
    files = []
    for path in sorted(release.rglob('*')):
        if path.is_symlink():
            if not path.resolve().is_relative_to(release):
                raise ValueError('Release symlink escapes its immutable layout')
        elif path.is_file():
            path.chmod(0o755 if path.stat().st_mode & 0o111 else 0o644)
            files.append([str(path.relative_to(release)), hashlib.sha256(path.read_bytes()).hexdigest()])
        elif path.is_dir():
            path.chmod(0o755)
        else:
            raise ValueError('Release contains a special file')
    native = installer.validate_native_distribution(release, require_root=False)
    base = subprocess.run(['git', '-C', str(source), 'rev-parse', 'HEAD'], check=True,
                          capture_output=True, text=True).stdout.strip()
    manifest = {'profile': 'personal-vps', 'baseRevision': base, 'node': '24.11.1',
                'codex': '0.153.4', 'nativePackage': native, 'files': files,
                'acceptance': 'Candidate only; real model tool/read/write and installed acceptance required'}
    (release / 'artifact.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (release / 'artifact.json').chmod(0o644)
    archive = output / 'harbor-personal-candidate.tar.gz'
    with tarfile.open(archive, 'w:gz') as stream:
        stream.add(release, arcname='release')
    result = {'archive': str(archive), 'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
              'fileCount': len(files), 'bytes': archive.stat().st_size}
    (output / 'package-result.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('source', 'node', 'vendor', 'output'):
        parser.add_argument('--' + name, required=True)
    args = parser.parse_args()
    package(args.source, args.node, args.vendor, args.output)
