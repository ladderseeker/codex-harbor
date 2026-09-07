import os, json, hashlib, subprocess, tempfile, time, fcntl, contextlib, stat, resource
from config import trusted, layout


def atomic(path, value, mode=0o600):
    parent = os.path.dirname(path)
    os.makedirs(parent, mode=0o700, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=".harbor-", dir=parent)
    try:
        os.fchmod(fd, mode)
        with os.fdopen(fd, "w") as stream:
            json.dump(value, stream, separators=(",", ":"))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
        directory = os.open(parent, os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def digest(path):
    h = hashlib.sha256()
    with open(path, "rb") as stream:
        while chunk := stream.read(1048576):
            h.update(chunk)
    return h.hexdigest()


def run(
    args,
    timeout=30,
    input=None,
    env=None,
    output=None,
    output_limit=512 * 1024 * 1024,
    input_file=None,
    capture_limit=8 * 1024 * 1024,
):
    if input is not None and input_file is not None:
        raise ValueError("Choose bytes or a file for administrator input")
    if not isinstance(capture_limit, int) or not 1 <= capture_limit <= 64 * 1024**2:
        raise ValueError("Administrator capture bound")
    if not isinstance(output_limit, int) or not 0 <= output_limit <= 512 * 1024**2:
        raise ValueError("Administrator output bound")
    # Output is bounded; callers never print raw stderr or command arguments.
    with tempfile.TemporaryFile() as stdout, tempfile.TemporaryFile() as stderr:
        try:
            result = subprocess.run(
                args,
                input=input,
                stdin=input_file,
                stdout=output if output is not None else stdout,
                stderr=stderr,
                env=env,
                timeout=timeout,
                check=False,
                preexec_fn=lambda: resource.setrlimit(
                    resource.RLIMIT_FSIZE,
                    (
                        (
                            max(1, min(output_limit, 512 * 1024 * 1024))
                            if output is not None
                            else capture_limit
                        ),
                    )
                    * 2,
                ),
            )
        except subprocess.TimeoutExpired:
            raise RuntimeError("Administrator operation deadline exceeded") from None
        if result.returncode:
            raise RuntimeError(
                "Administrator operation failed: " + os.path.basename(args[0])
            )
        if output is not None:
            return ""
        if stdout.tell() > capture_limit:
            raise RuntimeError("Administrator result limit")
        stdout.seek(0)
        return stdout.read().decode()


@contextlib.contextmanager
def lock(c):
    paths = layout(c["instance"])
    os.makedirs(paths["state"], mode=0o700, exist_ok=True)
    trusted(paths["state"], private=True)
    with open(paths["state"] + "/deployment.lock", "a") as stream:
        try:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError(
                "Another deployment operation owns this instance"
            ) from None
        yield paths


def record(paths, action, operation, **fields):
    folder = paths["state"] + "/operations"
    os.makedirs(folder, mode=0o700, exist_ok=True)
    if len(os.listdir(folder)) >= 256 and not os.path.exists(
        folder + "/" + operation + ".json"
    ):
        raise RuntimeError("Deployment operation history capacity reached")
    atomic(
        folder + "/" + operation + ".json",
        {"operation": operation, "action": action, "at": time.time(), **fields},
    )
