"""Fixed administrator deployment schema and trusted paths; never project inputs."""

import os, json, re, stat, urllib.parse

INSTANCE = re.compile(r"^[a-z][a-z0-9-]{0,31}$")
DIGEST = re.compile(r"^[a-f0-9]{64}$")
BASE = "/opt/codex-harbor"


def trusted(path, private=False, file=False):
    if (
        not isinstance(path, str)
        or len(path) > 4096
        or any(ord(ch) < 32 for ch in path)
    ):
        raise ValueError("Invalid administrator path")
    if not os.path.isabs(path) or os.path.realpath(path) != path:
        raise ValueError("Canonical administrator path required")
    info = os.lstat(path)
    if info.st_uid != 0 or info.st_mode & 0o022 or (private and info.st_mode & 0o077):
        raise ValueError("Unsafe administrator path permissions")
    if file and not stat.S_ISREG(info.st_mode):
        raise ValueError("Regular administrator file required")
    parent = os.path.dirname(path)
    while parent != "/":
        info = os.lstat(parent)
        if (
            info.st_uid != 0
            or stat.S_ISLNK(info.st_mode)
            or (info.st_mode & 0o022 and not info.st_mode & stat.S_ISVTX)
        ):
            raise ValueError("Untrusted administrator ancestry")
        parent = os.path.dirname(parent)
    return path


def load(path):
    trusted(path, private=True, file=True)
    with open(path) as stream:
        c = json.load(stream)
    required = {
        "instance",
        "origin",
        "oidcIssuer",
        "oidcClientId",
        "ownerSubject",
        "apiUid",
        "apiPort",
        "databasePort",
        "xfsProfile",
        "roots",
        "tls",
        "backup",
    }
    optional = {
        "oidcSecretFile",
        "models",
        "permissionCeiling",
        "dnsProfile",
        "extraCaFile",
    }
    if set(c) - required - optional or required - set(c):
        raise ValueError("Invalid deployment configuration fields")
    if not INSTANCE.fullmatch(c["instance"]):
        raise ValueError("Invalid instance ID")
    for name in ["origin", "oidcIssuer"]:
        if (
            not isinstance(c[name], str)
            or len(c[name]) > 2048
            or any(ord(ch) <= 32 or ch in '{}"\\' for ch in c[name])
        ):
            raise ValueError("Invalid HTTPS configuration")
        url = urllib.parse.urlsplit(c[name])
        if (
            url.scheme != "https"
            or not url.hostname
            or url.username
            or url.password
            or url.query
            or url.fragment
        ):
            raise ValueError("Verified HTTPS origin/issuer required")
        if name == "origin" and (url.path or c[name].endswith("/")):
            raise ValueError("Canonical origin required")
    if not isinstance(c["apiUid"], int) or not 20000 <= c["apiUid"] <= 60000:
        raise ValueError("Dedicated unprivileged API UID required")
    for name in ["apiPort", "databasePort"]:
        if not isinstance(c[name], int) or not 1024 <= c[name] <= 65535:
            raise ValueError("Invalid private service port")
    if c["apiPort"] == c["databasePort"]:
        raise ValueError("Private service ports conflict")
    if c.get("permissionCeiling", "read-only") not in ["read-only", "workspace-write"]:
        raise ValueError("Invalid permission ceiling")
    if c.get("dnsProfile", "system") not in ["system", "cloudflare-doh"]:
        raise ValueError("Invalid DNS profile")
    if not 1 <= len(c["roots"]) <= 20:
        raise ValueError("Root count limit")
    for root in c["roots"]:
        if set(root) != {"id", "name", "path"} or not re.fullmatch(
            "[a-f0-9-]{36}", root["id"]
        ):
            raise ValueError("Invalid registered root")
        trusted(root["path"])
    profile = c["xfsProfile"]
    if set(profile) != {
        "roots",
        "blockHardLimitBytes",
        "inodeHardLimit",
        "reserveBytes",
        "reserveInodes",
    }:
        raise ValueError("Invalid quota profile")
    for field, minimum, maximum in [
        ("blockHardLimitBytes", 16 * 1024**2, 1024**4),
        ("inodeHardLimit", 128, 1000000),
        ("reserveBytes", 1024**2, 1024**3),
        ("reserveInodes", 8, 10000),
    ]:
        if type(profile[field]) is not int or not minimum <= profile[field] <= maximum:
            raise ValueError("Invalid finite quota ceiling/reserve")
    if (
        profile["reserveBytes"] >= profile["blockHardLimitBytes"]
        or profile["reserveInodes"] >= profile["inodeHardLimit"]
    ):
        raise ValueError("Quota reserve exceeds ceiling")
    if len({r["id"] for r in c["roots"]}) != len(c["roots"]) or len(
        profile["roots"]
    ) != len(c["roots"]):
        raise ValueError("Duplicate root identity")
    if {r["id"] for r in profile["roots"]} != {r["id"] for r in c["roots"]}:
        raise ValueError("Root/profile mismatch")
    for root in profile["roots"]:
        if set(root) != {"id", "path", "pool"}:
            raise ValueError("Invalid quota root")
        if root["path"] != next(r["path"] for r in c["roots"] if r["id"] == root["id"]):
            raise ValueError("Quota root mismatch")
        trusted(root["path"])
        trusted(root["pool"])
        if (
            os.path.dirname(root["path"]) != os.path.dirname(root["pool"])
            or os.path.dirname(root["path"]) == "/"
        ):
            raise ValueError("Project and pool require one trusted managed parent")
    tls = c["tls"]
    if tls.get("mode") == "files" and set(tls) == {"mode", "certificate", "key"}:
        trusted(tls["certificate"], file=True)
        trusted(tls["key"], private=True, file=True)
    elif tls != {"mode": "acme"}:
        raise ValueError("ACME or verified administrator certificate files required")
    validate_backup(c["backup"])
    for key in ["oidcSecretFile", "extraCaFile"]:
        if key in c:
            trusted(c[key], private=key == "oidcSecretFile", file=True)
    return c


def validate_backup(backup):
    if set(backup) != {
        "host",
        "port",
        "user",
        "path",
        "sshKey",
        "knownHosts",
        "passwordFile",
    }:
        raise ValueError("Restricted SFTP backup configuration required")
    if not re.fullmatch(r"[A-Za-z0-9.-]+", backup["host"]) or not re.fullmatch(
        r"[a-z_][a-z0-9_-]{0,31}", backup["user"]
    ):
        raise ValueError("Invalid SFTP authority")
    if (
        not isinstance(backup["port"], int)
        or not 1 <= backup["port"] <= 65535
        or not re.fullmatch(r"/[A-Za-z0-9/_-]+", backup["path"])
    ):
        raise ValueError("Invalid SFTP destination")
    for key in ["sshKey", "knownHosts", "passwordFile"]:
        trusted(backup[key], private=True, file=True)


def layout(instance):
    if not INSTANCE.fullmatch(instance):
        raise ValueError("Invalid instance")
    return {
        "etc": "/etc/codex-harbor/" + instance,
        "state": "/var/lib/codex-harbor/" + instance,
        "run": "/run/codex-harbor/" + instance,
        "unit": "codex-harbor-" + instance,
    }
