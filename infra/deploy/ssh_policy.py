"""One exact SSH trust policy for public probes and encrypted repository transport."""


def options(backup):
    values = [
        "BatchMode=yes",
        "IdentitiesOnly=yes",
        "IdentityAgent=none",
        "StrictHostKeyChecking=yes",
        "GlobalKnownHostsFile=/dev/null",
        "UserKnownHostsFile=" + backup["knownHosts"],
        "HostKeyAlgorithms=ssh-ed25519",
        "KnownHostsCommand=none",
        "VerifyHostKeyDNS=no",
        "UpdateHostKeys=no",
        "CheckHostIP=no",
        "CanonicalizeHostname=no",
        "ProxyCommand=none",
        "ProxyJump=none",
        "ForwardAgent=no",
        "PermitLocalCommand=no",
        "ClearAllForwardings=yes",
        "ControlMaster=no",
        "ControlPath=none",
        "ControlPersist=no",
        "ConnectTimeout=10",
        "ConnectionAttempts=1",
    ]
    return [
        "-F",
        "/dev/null",
        *[part for value in values for part in ["-o", value]],
        "-i",
        backup["sshKey"],
    ]
