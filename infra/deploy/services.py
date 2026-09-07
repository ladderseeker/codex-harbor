import os, json, pwd, grp, hashlib, shlex, urllib.parse
from config import layout, BASE, trusted
from common import run, atomic


def text(path, value, mode=0o600, uid=0, gid=0):
    with open(path, "w") as stream:
        stream.write(value)
        stream.flush()
        os.fsync(stream.fileno())
    os.chmod(path, mode)
    os.chown(path, uid, gid)


def account(c):
    name = "harbor-api-" + hashlib.sha256(c["instance"].encode()).hexdigest()[:8]
    try:
        existing = pwd.getpwuid(c["apiUid"])
        if existing.pw_name != name:
            raise ValueError("API UID already belongs to another account")
    except KeyError:
        try:
            grp.getgrgid(c["apiUid"])
            raise ValueError("API GID already belongs to another group")
        except KeyError:
            pass
        run(["groupadd", "--gid", str(c["apiUid"]), name])
        run(
            [
                "useradd",
                "--uid",
                str(c["apiUid"]),
                "--gid",
                str(c["apiUid"]),
                "--no-create-home",
                "--shell",
                "/usr/sbin/nologin",
                name,
            ]
        )
    return name


def environment(c, release, role):
    p = layout(c["instance"])
    password = open(p["etc"] + "/database.password").read().strip()
    values = {
        "NODE_ENV": "production",
        "PATH": release + "/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        "HARBOR_MANAGED_RELEASE": release,
        "HARBOR_INSTANCE_ID": c["instance"],
        "DATABASE_URL": "postgres://harbor:"
        + password
        + "@localhost/harbor?host="
        + urllib.parse.quote(p["run"] + "/postgres", safe=""),
        "HARBOR_ORIGIN": c["origin"],
        "HARBOR_OIDC_ISSUER": c["oidcIssuer"],
        "HARBOR_OIDC_CLIENT_ID": c["oidcClientId"],
        "HARBOR_OWNER_SUBJECT": c["ownerSubject"],
        "HARBOR_PROJECT_ROOTS": json.dumps(c["roots"], separators=(",", ":")),
        "HARBOR_PERMISSION_CEILING": c.get("permissionCeiling", "read-only"),
        "HARBOR_MODELS": ",".join(c.get("models", ["gpt-5.4"])),
        "HARBOR_PORT": str(c["apiPort"]),
        "HARBOR_HOST": "127.0.0.1",
        "HARBOR_STORAGE_SOCKET": p["run"] + "/storage.sock",
        "HARBOR_FILE_SOCKET": p["run"] + "/storage.sock",
        "HARBOR_GIT_AUTHOR_NAME": c.get("gitAuthor", {}).get("name", "Harbor owner"),
        "HARBOR_GIT_AUTHOR_EMAIL": c.get("gitAuthor", {}).get("email", "harbor@localhost"),
        "HARBOR_CONTROL_SOCKET": p["run"] + "/credentials.sock",
    }
    if c.get("oidcSecretFile"):
        values["HARBOR_OIDC_CLIENT_SECRET"] = open(c["oidcSecretFile"]).read().strip()
    if c.get("extraCaFile"):
        values["NODE_EXTRA_CA_CERTS"] = p["etc"] + "/issuer-ca.pem"
    if role != "api":
        values.update(
            {
                "HARBOR_LAUNCHER_STATE_DIR": p["state"] + "/launcher",
                "HARBOR_XFS_PROFILE": json.dumps(
                    c["xfsProfile"], separators=(",", ":")
                ),
                "HARBOR_STORAGE_CLIENT_UID": str(c["apiUid"]),
                "HARBOR_STORAGE_CLIENT_GID": str(c["apiUid"]),
                "HARBOR_CONTROL_CLIENT_UID": str(c["apiUid"]),
                "HARBOR_CONTROL_CLIENT_GID": str(c["apiUid"]),
                "HARBOR_CREDENTIAL_KEY_FILE": p["etc"] + "/model.key",
                "HARBOR_EGRESS_DNS_PROFILE": c.get("dnsProfile", "system"),
            }
        )
    return values


def envfile(values):
    # systemd EnvironmentFile quoting, not shell execution.
    return "".join(k + "=" + json.dumps(v) + "\n" for k, v in values.items())


def write(c, release):
    p = layout(c["instance"])
    manifest = json.load(open(release + "/release.json"))
    name = account(c)
    os.chown(p["etc"], 0, c["apiUid"])
    os.chmod(p["etc"], 0o710)
    if c.get("extraCaFile"):
        text(p["etc"] + "/issuer-ca.pem", open(c["extraCaFile"]).read(), 0o444)
    os.makedirs(p["run"], mode=0o710, exist_ok=True)
    os.chown(p["run"], 0, c["apiUid"])
    os.chmod(p["run"], 0o710)
    text(p["etc"] + "/postgres-hba.conf", "local all all scram-sha-256\n", 0o444)
    text(
        p["etc"] + "/postgres.pgpass",
        "*:5432:harbor:harbor:"
        + open(p["etc"] + "/database.password").read().strip()
        + "\n",
        0o400,
        999,
        999,
    )
    os.makedirs(p["run"] + "/postgres", mode=0o755, exist_ok=True)
    os.chown(p["run"] + "/postgres", 999, 999)
    for sub, uid in [
        ("postgres", 999),
        ("caddy-data", 10005),
        ("caddy-config", 10005),
        ("launcher", 0),
        ("staging", 0),
    ]:
        target = p["state"] + "/" + sub
        if not os.path.exists(target):
            os.mkdir(target, 0o700)
            os.chown(target, uid, uid)
    # PostgreSQL has only its private Unix socket. Caddy alone has the public listener.
    compose = {
        "name": "harbor-" + c["instance"],
        "services": {
            "postgres": {
                "image": manifest["images"]["postgres"]["id"],
                "pull_policy": "never",
                "user": "999:999",
                "read_only": True,
                "cap_drop": ["ALL"],
                "security_opt": ["no-new-privileges:true"],
                "pids_limit": 256,
                "mem_limit": "512m",
                "cpus": 1,
                "shm_size": "128m",
                "environment": {
                    "POSTGRES_USER": "harbor",
                    "POSTGRES_DB": "harbor",
                    "PGPASSFILE": "/run/secrets/pgpass",
                    "POSTGRES_PASSWORD_FILE": "/run/secrets/password",
                    "POSTGRES_INITDB_ARGS": "--auth-local=scram-sha-256 --auth-host=scram-sha-256",
                },
                "network_mode": "none",
                "command": [
                    "postgres",
                    "-c",
                    "listen_addresses=",
                    "-c",
                    "unix_socket_permissions=0777",
                    "-c",
                    "hba_file=/etc/postgresql/harbor_hba.conf",
                ],
                "volumes": [
                    p["state"] + "/postgres:/var/lib/postgresql/data",
                    p["etc"] + "/database.password:/run/secrets/password:ro",
                    p["run"] + "/postgres:/var/run/postgresql",
                    p["etc"] + "/postgres.pgpass:/run/secrets/pgpass:ro",
                    p["etc"] + "/postgres-hba.conf:/etc/postgresql/harbor_hba.conf:ro",
                ],
                "tmpfs": ["/tmp:size=16m,noexec,nosuid,nodev"],
                "healthcheck": {
                    "test": ["CMD", "pg_isready", "-U", "harbor", "-d", "harbor"],
                    "interval": "2s",
                    "timeout": "2s",
                    "retries": 30,
                },
                "labels": {"org.codex-harbor.instance": c["instance"]},
            },
            "caddy": {
                "image": manifest["images"]["caddy"]["id"],
                "pull_policy": "never",
                "user": "10005:10005",
                "network_mode": "host",
                "read_only": True,
                "cap_drop": ["ALL"],
                "cap_add": ["NET_BIND_SERVICE"],
                "security_opt": ["no-new-privileges:true"],
                "pids_limit": 128,
                "mem_limit": "256m",
                "cpus": 1,
                "command": [
                    "caddy",
                    "run",
                    "--config",
                    "/etc/caddy/Caddyfile",
                    "--adapter",
                    "caddyfile",
                ],
                "volumes": [
                    p["etc"] + "/Caddyfile:/etc/caddy/Caddyfile:ro",
                    p["state"] + "/caddy-data:/data",
                    p["state"] + "/caddy-config:/config",
                ],
                "tmpfs": ["/tmp:size=16m,noexec,nosuid,nodev"],
                "labels": {"org.codex-harbor.instance": c["instance"]},
            },
        },
    }
    tls = "  tls {\n    issuer acme { disable_http_challenge }\n  }\n"
    if c["tls"]["mode"] == "files":
        tls = "  tls /etc/caddy/certificate.pem /etc/caddy/private.key\n"
        compose["services"]["caddy"]["volumes"] += [
            p["etc"] + "/tls-certificate.pem:/etc/caddy/certificate.pem:ro",
            p["etc"] + "/tls-private.key:/etc/caddy/private.key:ro",
        ]
        text(
            p["etc"] + "/tls-certificate.pem",
            open(c["tls"]["certificate"]).read(),
            0o400,
            10005,
            10005,
        )
        text(
            p["etc"] + "/tls-private.key",
            open(c["tls"]["key"]).read(),
            0o400,
            10005,
            10005,
        )
    caddy = (
        "{\n admin off\n auto_https disable_redirects\n}\n"
        + c["origin"]
        + " {\n"
        + tls
        + "  reverse_proxy 127.0.0.1:"
        + str(c["apiPort"])
        + "\n}\n"
    )
    text(p["etc"] + "/Caddyfile", caddy, 0o444)
    atomic(p["etc"] + "/compose.json", compose)
    for role in ["api", "supervisor", "storage"]:
        text(p["etc"] + "/" + role + ".env", envfile(environment(c, release, role)))
    unit = p["unit"]
    dependencies = (
        """[Unit]
Description=Codex Harbor private dependencies
After=docker.service network-online.target
Requires=docker.service
[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/bin/docker compose -f """
        + p["etc"]
        + """/compose.json up -d --wait
ExecStop=/usr/bin/docker compose -f """
        + p["etc"]
        + """/compose.json stop
TimeoutStartSec=120
TimeoutStopSec=60
[Install]
WantedBy=multi-user.target
"""
    )
    text("/etc/systemd/system/" + unit + "-dependencies.service", dependencies, 0o644)
    for role, entry in [
        ("storage", "infra/storage/server.ts"),
        ("supervisor", "apps/supervisor/src/main.ts"),
        ("api", "apps/api/src/main.ts"),
    ]:
        paths = " ".join(
            shlex.quote(parent)
            for parent in sorted(
                {os.path.dirname(r["path"]) for r in c["xfsProfile"]["roots"]}
            )
        )
        unittext = (
            """[Unit]
Description=Codex Harbor """
            + role
            + """
After="""
            + unit
            + """-dependencies.service
Requires="""
            + unit
            + """-dependencies.service
RequiresMountsFor="""
            + paths
            + " "
            + p["state"]
            + """
"""
            + (
                "After="
                + unit
                + "-storage.service\nRequires="
                + unit
                + "-storage.service\n"
                if role != "storage"
                else ""
            )
            + """[Service]
Type=simple
User="""
            + (name if role == "api" else "root")
            + """
Group="""
            + (name if role == "api" else "root")
            + """
WorkingDirectory="""
            + release
            + """
EnvironmentFile="""
            + p["etc"]
            + "/"
            + role
            + """.env
ExecStart="""
            + release
            + """/bin/node --import tsx """
            + release
            + "/"
            + entry
            + """
Restart=on-failure
RestartSec=2
TimeoutStopSec=45
KillMode=control-group
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
ReadWritePaths="""
            + p["state"]
            + " "
            + p["run"]
            + (" " + paths if role != "api" else "")
            + """
[Install]
WantedBy=multi-user.target
"""
        )
        text("/etc/systemd/system/" + unit + "-" + role + ".service", unittext, 0o644)
    # /run is recreated by systemd-tmpfiles before services on every boot.
    text(
        "/etc/tmpfiles.d/" + unit + ".conf",
        "d "
        + p["run"]
        + " 0710 root "
        + name
        + " -\nd "
        + p["run"]
        + "/postgres 0755 999 999 -\n",
        0o644,
    )
    run(["systemctl", "daemon-reload"])
    run(["systemd-tmpfiles", "--create", "/etc/tmpfiles.d/" + unit + ".conf"])
