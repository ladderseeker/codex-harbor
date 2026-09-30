#!/usr/bin/env bash
# Session start hook for Claude Code cloud sessions, run from .claude/settings.json.
# It installs the pinned Node under ~/.cache/codex-harbor, puts it first on PATH
# for the session through CLAUDE_ENV_FILE and installs the locked dependencies.
# The download and the install are bounded in time, so that a stall still ends
# with a status line within the hook's 600-second limit. Outside cloud sessions
# it does nothing. Every path exits 0 and prints at most one line.
# See docs/developer/cloud-sessions.md#prepare-a-session.

[ "${CLAUDE_CODE_REMOTE:-}" = true ] || exit 0
exec </dev/null 2>/dev/null
unset CDPATH

NODE_VERSION=24.11.1
NODE_SHA256=60e3b0a8500819514aca603487c254298cd776de0698d3cd08f11dba5b8289a8
NODE_NAME=node-v$NODE_VERSION-linux-x64
# Tests may point HARBOR_NODE_DIST at a file:// copy; the pinned SHA-256 still applies.
NODE_DIST=${HARBOR_NODE_DIST:-https://nodejs.org/dist}

fail() {
  printf 'Harbor cloud setup failed: %s. See docs/developer/cloud-sessions.md#prepare-a-session.\n' "$1"
  exit 0
}

[ "$(uname -s)" = Linux ] && [ "$(uname -m)" = x86_64 ] || fail "only Linux x86_64 is supported"
case ${HOME:-} in
  /*) ;;
  *) fail "HOME is not an absolute path" ;;
esac
[ -n "${CLAUDE_ENV_FILE:-}" ] || fail "CLAUDE_ENV_FILE is not set"

root=$HOME/.cache/codex-harbor
node_dir=$root/$NODE_NAME
# Every later command sources the PATH line, so refuse paths that would need quoting.
case $node_dir in
  *[\"\$\`\\]* | *$'\n'*) fail "the home directory path contains shell quoting characters" ;;
esac
path_line="export PATH=\"$node_dir/bin:\$PATH\""

tmp=
trap '[ -z "$tmp" ] || rm -rf "$tmp"' EXIT

node_ready() {
  [ "$("$node_dir/bin/node" --version)" = "v$NODE_VERSION" ]
}

# Download, verify and extract in a private temporary directory, then rename the
# result into place, so that a failure leaves any existing install untouched.
install_node() {
  local tarball=$NODE_NAME.tar.xz tool sum
  for tool in curl sha256sum tar xz; do
    command -v "$tool" >/dev/null || fail "$tool is needed to install Node"
  done
  mkdir -p "$root" && tmp=$(mktemp -d "$root/.install.XXXXXX") ||
    fail "cannot create a temporary directory under ~/.cache/codex-harbor"
  # Each attempt takes at most 90 seconds; retries stop once 180 seconds have passed.
  curl -fsL --connect-timeout 20 --max-time 90 --retry 2 --retry-max-time 180 \
    -o "$tmp/$tarball" "$NODE_DIST/v$NODE_VERSION/$tarball" ||
    fail "cannot download $tarball (curl exit $?)"
  sum=$(sha256sum "$tmp/$tarball") && [ "${sum%% *}" = "$NODE_SHA256" ] ||
    fail "$tarball does not match the pinned SHA-256"
  tar -xJf "$tmp/$tarball" -C "$tmp" && [ -x "$tmp/$NODE_NAME/bin/node" ] ||
    fail "cannot extract $tarball"
  if [ -e "$node_dir" ] || [ -L "$node_dir" ]; then
    mv -T "$node_dir" "$tmp/replaced" || fail "cannot replace ~/.cache/codex-harbor/$NODE_NAME"
  fi
  if ! mv -T "$tmp/$NODE_NAME" "$node_dir"; then
    [ ! -e "$tmp/replaced" ] || mv -T "$tmp/replaced" "$node_dir"
    fail "cannot move Node into ~/.cache/codex-harbor"
  fi
  rm -rf "$tmp"
  tmp=
  node_ready || fail "the installed Node does not report v$NODE_VERSION"
}

node_ready || install_node

if ! grep -qxF -- "$path_line" "$CLAUDE_ENV_FILE"; then
  # Start a new line when another hook left the file without a final newline.
  if [ -s "$CLAUDE_ENV_FILE" ] && [ -n "$(tail -c 1 "$CLAUDE_ENV_FILE")" ]; then
    printf '\n' >>"$CLAUDE_ENV_FILE"
  fi
  printf '%s\n' "$path_line" >>"$CLAUDE_ENV_FILE" || fail "cannot write to CLAUDE_ENV_FILE"
fi

project_dir=${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}
cd "$project_dir" || fail "cannot enter the project directory"
export PATH="$node_dir/bin:$PATH"
command -v timeout >/dev/null ||
  fail "the timeout command is missing, so pnpm install --frozen-lockfile did not run"
log=$root/pnpm-install.log
# Stop the install after 240 seconds, and kill it 10 seconds later if it ignores that.
if command -v pnpm >/dev/null; then
  timeout -k 10 240 pnpm install --frozen-lockfile >"$log" 2>&1
else
  COREPACK_ENABLE_DOWNLOAD_PROMPT=0 timeout -k 10 240 corepack pnpm install --frozen-lockfile >"$log" 2>&1
fi
status=$?
[ "$status" -ne 124 ] ||
  fail "pnpm install --frozen-lockfile did not finish within 240 seconds; read ~/.cache/codex-harbor/pnpm-install.log"
[ "$status" -eq 0 ] ||
  fail "pnpm install --frozen-lockfile failed; read ~/.cache/codex-harbor/pnpm-install.log"

printf 'Harbor cloud setup: Node v%s and locked dependencies ready.\n' "$NODE_VERSION"
