import test from "node:test";
import assert from "node:assert/strict";
import { RuntimeMailbox } from "../../apps/supervisor/src/runtime-mailbox.ts";
test("P001-05 overflow terminal bypasses full mailbox and discards queued completion", async () => {
  let terminal = 0,
    applied = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const mailbox = new RuntimeMailbox(() => {
    terminal++;
    mailbox.poison("synchronous disconnect");
  });
  mailbox.enqueue(1, async () => {
    await held;
    applied++;
  });
  await Promise.resolve();
  for (let n = 0; n < 300; n++)
    mailbox.enqueue(1, async () => {
      applied++;
    });
  assert.equal(terminal, 1);
  assert.equal(mailbox.poisoned, true);
  release();
  await mailbox.drained();
  assert.equal(applied, 1);
  mailbox.enqueue(1, async () => {
    applied++;
  });
  await mailbox.drained();
  assert.equal(applied, 1);
});
test("P001-05 failed commit poisons captured turn and rejects later completion", async () => {
  const terminal: string[] = [];
  let committed = false;
  const mailbox = new RuntimeMailbox((reason) => terminal.push(reason));
  mailbox.enqueue(1, async () => {
    throw Error("COMMIT lost");
  });
  mailbox.enqueue(1, async () => {
    committed = true;
  });
  await mailbox.drained();
  assert.equal(terminal.length, 1);
  assert.equal(committed, false);
});
