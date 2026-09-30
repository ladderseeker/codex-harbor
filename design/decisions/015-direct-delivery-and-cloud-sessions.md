# D015 — Direct delivery and cloud sessions

- Decision: Accepted, 30 September 2026, on three messages from the owner that day and one default that main kept, all of which [P036](../proposals/036-cloud-agent-sessions.md) also summarizes:
  - On a decision card in this project's thread, posted during P035, the owner chose to allow branch commits. Main could then commit and push checkpoints to its working branch without asking, while merging to `main` still waited for the owner.
  - The owner asked for `AGENTS.md` and `CLAUDE.md` to be updated for the work agents can do in the cloud environment, following the project's best practice.
  - At 02:54 UTC the owner wrote that Harbor is their private work and needs no review: finished work goes straight to `main`, and the rules should say so. Once CI/CD exists, finishing something should also finish its deployment. This message replaces the first choice's reservation about merging.
  - Keeping the automatic design and provenance reviews is main's own default, not the owner's direction. Main told the owner so at 03:00 UTC and offered to skip them; the owner had not asked for that when this decision was recorded.
- Changes: collaboration rules only; no application, runtime, deployment or security behavior.
- Amends: two [D013](013-evidence-based-delivery-workflow.md) rules.
  - The owner no longer confirms each commit. Agents deliver finished work straight to `main`, with no owner confirmation or review.
  - When a mandatory gate cannot run, the reviews are no longer advisory. A result may reach `main` once every other gate passed and both reviews are clear, and it stays Accepted until that gate passes.
- Retains:
  - the rest of D013, including the automatic design and provenance reviews, the three-round cap and the owner's decision on remaining blockers;
  - the owner's authority over deployment until a plan that delivers CI/CD is Implemented and changes these rules, and over credentials and host work;
  - every gate, which still decides Implemented.
- Execution record: [P036](../proposals/036-cloud-agent-sessions.md).
- Current contract: the [workflow's commit rules](../workflow.md#proposal-completion-and-archive), [AGENTS.md](../../AGENTS.md#delivery-and-delegation) and the [cloud session guide](../../docs/developer/cloud-sessions.md#commits-and-delivery).

## Context

Harbor is the owner's private work. Agents now also work on it in cloud sessions. Each session runs in its own disposable container, and uncommitted work and ignored evidence vanish when the container is reclaimed. At the end of every turn, the environment's stop check asks for work to be committed and pushed. Under D013 the owner confirmed each commit, so every turn stalled on that confirmation. Agent work used to reach `main` through pull requests from the agent's branch, such as pull request #4, which GitHub records as merged under the owner's account. Then the owner found review unnecessary.

## Options and decision

Keeping per-commit confirmation loses work when a container is reclaimed and blocks every turn.

Committing on working branches and having the owner review each pull request was the owner's first choice. At 02:54 UTC on 30 September the owner rejected it, writing that this private work needs no review.

The selected option commits checkpoints on working branches and pushes finished work straight to `main`. Implementers never commit. Main commits with the configured identity and may push coherent checkpoints to an assigned working branch without asking; a checkpoint that has not passed its gate says `WIP`. The automatic design and provenance reviews stay. The decision also sets these rules:

- Finished means what the [workflow](../workflow.md#proposal-completion-and-archive) says: every gate that can run passed, every other gate is recorded as unverified with an issue, both reviews are clear and the plan records the result. Work with review blockers left after three rounds stays off `main` until the owner decides.
- An outcome is delivered only when every commit between `origin/main` and it belongs to a finished outcome or is a plan or issue record.
- Where Git cannot push to `main`, a pull request merged at once with a merge commit delivers the reviewed commits unchanged. It is not a review request.
- Unavailable gates stay unverified, and hosted CI or a supported Linux host supplies them. Container, network and sandbox isolation is never weakened to make a check run.
- Deployment stays manual, with the owner's go-ahead for every run other than `preflight`, until a plan that delivers CI/CD is Implemented and changes these rules. Adding an automatic deploy trigger is the owner's decision. After that, finishing an outcome includes deploying it and checking the deployment, as the owner directed.

## Consequences

- `main` history includes the `WIP` checkpoints of each delivered outcome, but `main`'s tip only ever holds finished work.
- The automatic reviews are the only review before `main`, so main does not skip them unless the owner changes this rule. They start once every gate that can run is green.
- A proposal can be on `main` while still Accepted, with a dated delivery entry, because a mandatory gate that could not run keeps it from Implemented.
- Outcomes that share a working branch reach `main` in their order on the branch, because each waits for the outcomes below it, or from a branch cut from `origin/main` that holds only finished outcomes and records.
- Reviewers can identify the reviewed source by commit, not only by an uncommitted diff.
- Evidence that must survive the container goes into tracked records. Raw artifacts kept nowhere else are recorded as unavailable once the container is gone.
