#!/usr/bin/env python3
"""Build a matching-Linux immutable release; never invoked by promotion."""
import os, sys, json, hashlib, shutil, tarfile, tempfile, platform, argparse, subprocess, zipapp
from common import digest, atomic, run

IMAGES = {
    "postgres": "postgres:17.6-bookworm",
    "caddy": "caddy:2.10.2-alpine",
    "runner": "codex-harbor-runner:0.153.4",
    "gateway": "codex-harbor-egress:1",
    "git": "codex-harbor-git:2.39.5-p003",
    "files": "codex-harbor-files:2.39.5-p004",
    "previewRelay": "codex-harbor-preview-relay:24.11.1-p011",
}


def files(root):
    result = {}
    for base, dirs, names in os.walk(root, followlinks=False):
        for name in sorted(dirs + names):
            path = os.path.join(base, name)
            relative = os.path.relpath(path, root)
            info = os.lstat(path)
            if os.path.islink(path):
                target = os.readlink(path)
                if (
                    os.path.isabs(target)
                    or os.path.commonpath([root, os.path.realpath(path)]) != root
                ):
                    raise ValueError("Package symlink escapes release")
                result[relative] = {"link": target}
            elif os.path.isfile(path):
                result[relative] = {
                    "sha256": digest(path),
                    "size": info.st_size,
                    "executable": bool(info.st_mode & 0o111),
                }
            elif not os.path.isdir(path):
                raise ValueError("Unsupported package entry")
    return result


def build(source, node, restic, output, predecessor=None):
    if sys.platform != "linux" or platform.machine() not in ["aarch64", "x86_64"]:
        raise ValueError("Matching supported Linux build host required")
    source = os.path.realpath(source)
    if run([node, "--version"]).strip() != "v24.11.1" or not run(
        [restic, "version"]
    ).startswith("restic 0.19.1 "):
        raise ValueError("Pinned Node/Restic binary required")
    if not os.path.isfile(source + "/apps/web/dist/index.html"):
        raise ValueError("Build web assets before packaging")
    (
        run(
            [node, "node_modules/typescript/bin/tsc", "--noEmit"],
            timeout=60,
            env={**os.environ, "PWD": source},
        )
        if os.getcwd() == source
        else None
    )
    with tempfile.TemporaryDirectory(prefix="harbor-release-") as staging:
        payload = staging + "/payload"
        os.mkdir(payload)
        selected = run(
            ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"]
        ).split("\0")
        allowed = {
            "package.json",
            "pnpm-lock.yaml",
            "pnpm-workspace.yaml",
            "tsconfig.json",
        }
        for name in sorted(set(selected)):
            if not name or not (
                name in allowed
                or name.split("/")[0] in ["apps", "packages", "infra", "scripts"]
            ):
                continue
            if name.startswith("/") or ".." in name.split("/"):
                raise ValueError("Unsafe source inventory")
            src = source + "/" + name
            dst = payload + "/" + name
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            if os.path.islink(src):
                os.symlink(os.readlink(src), dst)
            elif os.path.isfile(src):
                shutil.copy2(src, dst)
            else:
                raise ValueError("Non-file source inventory")
        shutil.copytree(
            source + "/node_modules",
            payload + "/node_modules",
            symlinks=True,
            ignore=shutil.ignore_patterns("__pycache__", ".DS_Store"),
        )
        # Vite output is ignored by Git, but the installed API serves this exact
        # directory. Include it explicitly in the authenticated release inventory.
        shutil.copytree(source + "/apps/web/dist", payload + "/apps/web/dist")
        os.makedirs(payload + "/bin")
        shutil.copyfile(node, payload + "/bin/node")
        shutil.copyfile(restic, payload + "/bin/restic")
        os.chmod(payload + "/bin/node", 0o755)
        os.chmod(payload + "/bin/restic", 0o755)
        with tempfile.TemporaryDirectory(prefix="harbor-admin-") as admin:
            for name in os.listdir(source + "/infra/deploy"):
                if name.endswith(".py"):
                    shutil.copyfile(
                        source + "/infra/deploy/" + name, admin + "/" + name
                    )
            shutil.copyfile(source + "/infra/deploy/harborctl", admin + "/__main__.py")
            zipapp.create_archive(
                admin,
                payload + "/bin/harborctl",
                interpreter="/usr/bin/python3",
                compressed=True,
            )
            os.chmod(payload + "/bin/harborctl", 0o755)
        images = {}
        for role, tag in IMAGES.items():
            info = json.loads(run(["docker", "image", "inspect", tag]))[0]
            images[role] = {
                "tag": tag,
                "id": info["Id"],
                "architecture": info["Architecture"],
                "repoDigests": info.get("RepoDigests", []),
            }
            if info["Architecture"] != (
                "arm64" if platform.machine() == "aarch64" else "amd64"
            ):
                raise ValueError("Image architecture mismatch")
        content = files(payload)
        source_id = run(
            [
                node,
                "--import",
                "tsx",
                "--input-type=module",
                "-e",
                "import {sourceDigest} from './scripts/source-digest.ts';console.log(JSON.stringify(sourceDigest()))",
            ],
            timeout=30,
        )
        manifest = {
            "format": 1,
            "backupSchema": 1,
            "configurationSchema": 1,
            "node": "24.11.1",
            "pnpm": "12.3.4",
            "restic": "0.19.1",
            "codex": "0.153.4",
            "nativeCompatibility": "codex-0.153.4",
            "architecture": platform.machine(),
            "source": json.loads(source_id),
            "images": images,
            "migrations": {
                p.rsplit("/", 1)[-1]: v["sha256"]
                for p, v in content.items()
                if p.startswith("packages/storage/src/migrations/")
                and p.endswith(".sql")
            },
            "seccomp": content["infra/runner/seccomp.json"]["sha256"],
            "terminalSeccomp": content["infra/runner/seccomp-terminal.json"]["sha256"],
            "files": content,
        }
        manifest["supportedPredecessors"] = []
        if predecessor:
            prior = json.load(open(predecessor))
            manifest["supportedPredecessors"] = [
                {
                    "artifact": prior["artifact"],
                    "migrations": prior["migrations"],
                    "orderPolicy": "explicit-supported-predecessor",
                }
            ]
        identity = hashlib.sha256(
            json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        manifest["artifact"] = identity
        atomic(payload + "/release.json", manifest, 0o644)
        os.makedirs(output, exist_ok=True)
        archive = os.path.realpath(output) + "/" + identity + ".tar"
        with tarfile.open(archive, "w", format=tarfile.PAX_FORMAT) as tar:
            tar.add(payload, arcname="payload", recursive=True)
        bootstrap = os.path.realpath(output) + "/" + identity + "-harborctl"
        shutil.copyfile(payload + "/bin/harborctl", bootstrap)
        os.chmod(bootstrap, 0o755)
        result = {
            "artifact": identity,
            "archive": archive,
            "sha256": digest(archive),
            "administrator": bootstrap,
            "administratorSha256": digest(bootstrap),
            "source": manifest["source"],
        }
        atomic(archive + ".manifest.json", result, 0o644)
        print(json.dumps(result))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--node", required=True)
    parser.add_argument("--restic", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--predecessor-manifest")
    args = parser.parse_args()
    build(
        os.getcwd(),
        os.path.realpath(args.node),
        os.path.realpath(args.restic),
        args.output,
        args.predecessor_manifest,
    )
