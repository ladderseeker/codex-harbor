"""First actual root/API-separated production service startup; no Harbor fixture mode."""

import os, json, subprocess, sys, urllib.parse

source = os.path.realpath(os.path.join(os.path.dirname(__file__), "../.."))
os.chdir(source)
tools = os.environ.get("HARBOR_DEPLOY_TEST_TOOLS", "/var/lib/harbor-p009-tools")
manifest = json.load(open(tools + "/admission.json"))
c = json.load(open(manifest["config"]))
control = manifest["control"]
unit = "harbor-p009-oidc-" + manifest["id"]
fixture = (
    """[Unit]
Description=Run-owned external P009 identity fixture
[Service]
WorkingDirectory="""
    + source
    + """
Environment=NODE_ENV=test HARBOR_FIXTURE_MODE=private-test OIDC_PORT="""
    + str(urllib.parse.urlsplit(c["oidcIssuer"]).port)
    + """ HARBOR_OIDC_CLIENT_ID=p009-test HARBOR_ORIGIN="""
    + c["origin"]
    + """
Environment=OIDC_TLS_CERT="""
    + control
    + """/tls.crt OIDC_TLS_KEY="""
    + control
    + """/tls.key
ExecStart=/opt/harbor-node/bin/node --import """
    + source
    + """/node_modules/tsx/dist/loader.mjs """
    + source
    + """/tests/fixtures/oidc/server.ts
Restart=on-failure
[Install]
WantedBy=multi-user.target
"""
)
with open("/etc/systemd/system/" + unit + ".service", "w") as stream:
    stream.write(fixture)
subprocess.run(["systemctl", "daemon-reload"], check=True)
subprocess.run(["systemctl", "enable", "--now", unit], check=True)
# Build immediately before admission so the artifact records the actual source.
subprocess.run(["git", "add", "."], check=True)
result = subprocess.run(
    [
        "python3",
        "infra/deploy/package.py",
        "--node",
        "/opt/harbor-node/bin/node",
        "--restic",
        tools + "/restic",
        "--output",
        tools + "/releases",
    ],
    check=True,
    capture_output=True,
    text=True,
)
package = json.loads(result.stdout)
with open(control + "/package.json", "w") as stream:
    json.dump(package, stream)
subprocess.run(
    [
        "python3",
        "infra/deploy/harborctl",
        "--config",
        manifest["config"],
        "install",
        "--archive",
        package["archive"],
        "--sha256",
        package["sha256"],
        *(
            ["--resume"]
            if os.path.exists(
                "/var/lib/codex-harbor/" + manifest["id"] + "/installation.json"
            )
            else []
        ),
    ],
    check=True,
)
