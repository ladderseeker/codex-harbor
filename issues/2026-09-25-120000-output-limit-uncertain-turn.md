# One oversized reply makes a conversation uncertain

- Severity: Medium; in the personal profiles the affected conversation can never take another turn. The resulting deploy blockage is recorded separately as High.
- Owner: Inbox. [P028](../design/proposals/028-live-conversation-streaming.md) is the proposed receiving plan (Draft, not yet selected).
- Status: Open; found by source inspection, not reproduced.
- Recorded: 25 September 2026.
- Related: [project review](../docs/reports/2026-09-25-project-review.md#transcript-fidelity), [P021](../design/proposals/021-long-conversation-history-and-capacity.md), [uncertain-turn issue](2026-09-26-034257-uncertain-turn-blocks-deploy.md).

Source inspection of `d0c505b` found that output persistence in [conversation-output.ts](../apps/supervisor/src/conversation-output.ts) throws "Conversation output quota" when an assistant message would exceed 262,144 characters, when assistant text would take the conversation's stored text, including the owner's own messages, past 2 MiB, or when a new assistant message would be added to a conversation that already holds 2,000 messages. Command output already has a gentler rule: it is truncated at 32 KiB and, near the limits, replaced by one notice. Assistant text has no such rule.

The throw rolls back that delta's transaction, and the runtime mailbox treats the failure as fatal: the callback in [main.ts](../apps/supervisor/src/main.ts) marks the running operation `uncertain` and retires the runtime. The text persisted before the failing delta remains. In the managed and fixture profiles the owner can acknowledge the uncertain operation through the recovery panel. In both personal profiles the API refuses the recovery routes, and turn admission in [turns.ts](../packages/storage/src/turns.ts) refuses every new turn while an unacknowledged uncertain operation exists, so the conversation stays readable but blocked for good.

Impact: rare in normal use, but a model asked to print a large file or log can exceed the per-message limit in one reply, and a long-lived conversation eventually reaches the lifetime limits during a turn. The owner then loses the conversation for further work instead of receiving a truncated reply, and until the [uncertain-turn issue](2026-09-26-034257-uncertain-turn-blocks-deploy.md) is fixed, every later deploy refuses as well. Admission already refuses a new turn once the conversation is full, with "Conversation storage limit reached", but a turn admitted just under a limit can still cross it.

A correction must keep every storage limit bounded and must not label an operation complete when its native completion was not observed. Prefer truncating an oversized reply at the limit with a visible notice while the turn continues to its native end, as command output already does. The lifetime limits themselves remain with P021.

Recheck with the Codex fixture on the real Harbor stack, in the fixture and personal VPS profiles: stream an assistant reply above 262,144 characters, and run a turn whose output crosses 2 MiB and one that crosses 2,000 messages; confirm the turn's final state, the visible notice, and that the next turn is accepted or refused with the storage-limit explanation.
