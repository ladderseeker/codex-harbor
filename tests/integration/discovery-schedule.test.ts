import test from "node:test";
import assert from "node:assert/strict";
import {
  DISCOVERY_REFRESH_SECONDS,
  DISCOVERY_RETRY_MS,
  discoveryDue,
} from "../../apps/supervisor/src/discovery-schedule.ts";

const now = 1_800_000_000_000;
const signedIn = (ageSeconds: number) => ({ ageSeconds, authenticated: true });
const signedOut = (ageSeconds: number) => ({
  ageSeconds,
  authenticated: false,
});

test("P035-03 discovery refreshes every 30 minutes and retries after one minute", () => {
  assert.equal(DISCOVERY_REFRESH_SECONDS, 1800);
  assert.equal(DISCOVERY_RETRY_MS, 60_000);
});

test("P035-03 without a stored record only a recent failure waits", () => {
  assert.equal(discoveryDue(now, undefined, undefined), true);
  // A successful attempt whose record was deleted since, as a credential change
  // does, probes again on the next tick.
  assert.equal(
    discoveryDue(now, { at: now - 1_000, failed: false }, undefined),
    true,
  );
  assert.equal(
    discoveryDue(now, { at: now - 1_000, failed: true }, undefined),
    false,
  );
  assert.equal(
    discoveryDue(now, { at: now - 59_999, failed: true }, undefined),
    false,
  );
  // A failed attempt waits the full retry interval, then probes again.
  assert.equal(
    discoveryDue(now, { at: now - 60_000, failed: true }, undefined),
    true,
  );
  assert.equal(
    discoveryDue(now, { at: now - 3_600_000, failed: true }, undefined),
    true,
  );
});

test("P035-03 a signed-in record refreshes only once it is 30 minutes old", () => {
  const old = { at: now - 3_600_000, failed: false };
  assert.equal(discoveryDue(now, old, signedIn(0)), false);
  assert.equal(discoveryDue(now, undefined, signedIn(0)), false);
  assert.equal(discoveryDue(now, old, signedIn(29 * 60)), false);
  assert.equal(discoveryDue(now, old, signedIn(1799.9)), false);
  assert.equal(discoveryDue(now, old, signedIn(30 * 60)), true);
  assert.equal(discoveryDue(now, undefined, signedIn(30 * 60)), true);
  // Even a stale record waits for the retry interval after any attempt.
  assert.equal(
    discoveryDue(now, { at: now - 1_000, failed: false }, signedIn(7200)),
    false,
  );
  assert.equal(
    discoveryDue(now, { at: now - 1_000, failed: true }, signedIn(7200)),
    false,
  );
  assert.equal(
    discoveryDue(now, { at: now - 60_000, failed: true }, signedIn(7200)),
    true,
  );
});

test("P035-03 a record that is not signed in probes every minute", () => {
  for (const failed of [false, true]) {
    assert.equal(
      discoveryDue(now, { at: now - 30_000, failed }, signedOut(30)),
      false,
    );
    assert.equal(
      discoveryDue(now, { at: now - 59_999, failed }, signedOut(60)),
      false,
    );
    assert.equal(
      discoveryDue(now, { at: now - 60_000, failed }, signedOut(60)),
      true,
    );
    assert.equal(
      discoveryDue(now, { at: now - 90_000, failed }, signedOut(1)),
      true,
    );
  }
  assert.equal(discoveryDue(now, undefined, signedOut(0)), true);
});

test("P035-03 an attempt time after now counts as recent when the clock moved backwards", () => {
  const future = (failed: boolean) => ({ at: now + 3_600_000, failed });
  assert.equal(discoveryDue(now, future(false), signedIn(7200)), false);
  assert.equal(discoveryDue(now, future(true), signedOut(0)), false);
  assert.equal(discoveryDue(now, future(true), undefined), false);
  // The deleted-record exception still applies to a successful attempt.
  assert.equal(discoveryDue(now, future(false), undefined), true);
});
