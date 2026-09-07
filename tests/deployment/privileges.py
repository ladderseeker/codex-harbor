"""Actual Linux DAC and PostgreSQL transport probes; no project code is executed."""

import os, json, socket, subprocess, stat

m = json.load(open("/var/lib/harbor-p009-tools/admission.json"))
c = json.load(open(m["config"]))
run = "/run/codex-harbor/" + m["id"]
etc = "/etc/codex-harbor/" + m["id"]


def as_uid(uid, fn):
    pid = os.fork()
    if pid == 0:
        try:
            os.setgroups([])
            os.setgid(uid)
            os.setuid(uid)
            fn()
            os._exit(0)
        except:
            os._exit(1)
    _, status = os.waitpid(pid, 0)
    assert os.waitstatus_to_exitcode(status) == 0


def denied_connect():
    for path in [
        run + "/storage.sock",
        run + "/credentials.sock",
        run + "/postgres/.s.PGSQL.5432",
    ]:
        s = socket.socket(socket.AF_UNIX)
        try:
            try:
                s.connect(path)
            except PermissionError:
                continue
            raise AssertionError("Unrelated UID reached private socket")
        finally:
            s.close()


for uid in [10001, 10002, 23008]:
    as_uid(uid, denied_connect)


def api_paths():
    for path in [etc + "/model.key", c["roots"][0]["path"]]:
        try:
            os.open(path, os.O_RDONLY)
        except PermissionError:
            pass
        else:
            raise AssertionError("API obtained protected filesystem access")
    for path in [run + "/storage.sock", run + "/postgres/.s.PGSQL.5432"]:
        try:
            os.unlink(path)
        except PermissionError:
            pass
        else:
            raise AssertionError("API replaced protected socket entry")


as_uid(c["apiUid"], api_paths)
container = "harbor-" + m["id"] + "-postgres-1"
info = json.loads(
    subprocess.run(
        ["docker", "inspect", container], check=True, capture_output=True, text=True
    ).stdout
)[0]
assert info["HostConfig"]["NetworkMode"] == "none"
assert not info["NetworkSettings"]["Ports"] or all(
    not value for value in info["NetworkSettings"]["Ports"].values()
)
wrong = subprocess.run(
    [
        "docker",
        "exec",
        "--env",
        "PGPASSWORD=synthetic-wrong-password",
        container,
        "psql",
        "-U",
        "harbor",
        "-d",
        "harbor",
        "-c",
        "SELECT 1",
    ],
    capture_output=True,
)
assert wrong.returncode != 0 and b"password authentication failed" in wrong.stderr
print(
    json.dumps(
        {
            "privateSocketUnrelatedUidDenial": True,
            "apiCannotReadModelKeyOrProjects": True,
            "apiCannotReplaceSocketEntries": True,
            "databaseNoNetwork": True,
            "scramWrongPasswordDenied": True,
        }
    )
)
