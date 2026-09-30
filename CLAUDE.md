@AGENTS.md

## Claude Code

These notes add Claude Code specifics to the shared rules above. Where they seem to conflict with `AGENTS.md` or the [delivery workflow](design/workflow.md), those win; report the conflict.

- **Session setup.** In cloud sessions, the SessionStart hook in `.claude/settings.json` runs `scripts/cloud-session-setup.sh` and prints one status line. If that line reports a failure, or no status line appears, follow [Prepare a session](docs/developer/cloud-sessions.md#prepare-a-session) before running checks.
- **Git.** Commit with the configured Git identity, which signs commits in cloud sessions, and never with the owner's or another contributor's name or email. End commit messages and pull request descriptions with the attribution lines the session asks for. Push checkpoints to the branch the session assigns. The environment's stop check reports uncommitted or unpushed work at the end of each turn: commit and push a checkpoint, marked `WIP` until it passes its gate. Deliver finished work to `main` as [Commits and delivery](docs/developer/cloud-sessions.md#commits-and-delivery) describes.
- **GitHub.** Use the built-in GitHub tools; the `gh` CLI may be missing. Never open a pull request to ask the owner for review. When Git cannot push to `main`, deliver finished work through a pull request that you merge at once with a merge commit, which keeps the reviewed commits' identities.
- **Roles.** Run the implementer and each reviewer as a fresh-context subagent whose self-contained brief names its role document. Subagents never commit. When a checkpoint commit includes a running implementer's files, tell the implementer which commit to diff against.
- **Parallel work.** Give concurrent implementers disjoint file fences. Put a second implementer in its own worktree outside the repository directory, so that document checks do not scan another worker's unfinished files.
