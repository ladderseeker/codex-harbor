import test from "node:test";
import assert from "node:assert/strict";
import {
  nextMinutes,
  parseCron,
  resolveOneTime,
  timeFingerprint,
} from "../../packages/schedules/src/time.ts";

test("P008-02 spring gaps skip; autumn folds select only the first instant", async () => {
  const rule = {
    kind: "cron" as const,
    expression: "30 2 * * *",
    timezone: "America/New_York",
  };
  const spring = await nextMinutes(rule, "2026-03-07T08:00:00Z", 2);
  assert.deepEqual(
    spring.map((x) => x.instant),
    ["2026-03-09T06:30:00Z", "2026-03-10T06:30:00Z"],
  );
  assert.throws(
    () =>
      resolveOneTime("2026-03-08T02:30", rule.timezone, "2026-03-01T00:00:00Z"),
    /does not exist/,
  );
  const fold = { ...rule, expression: "30 1 * * *" };
  assert.equal(
    (await nextMinutes(fold, "2026-11-01T04:00:00Z", 1))[0].instant,
    "2026-11-01T05:30:00Z",
  );
  assert.equal(
    (await nextMinutes(fold, "2026-11-01T05:31:00Z", 1))[0].instant,
    "2026-11-02T06:30:00Z",
  );
});
test("P008-02 non-hour and whole-day gaps never shift a requested local minute", async () => {
  assert.throws(
    () =>
      resolveOneTime(
        "2026-10-04T02:15",
        "Australia/Lord_Howe",
        "2026-10-01T00:00:00Z",
      ),
    /does not exist/,
  );
  assert.throws(
    () =>
      resolveOneTime(
        "2011-12-30T12:00",
        "Pacific/Apia",
        "2011-12-28T00:00:00Z",
      ),
    /does not exist/,
  );
  const result = await nextMinutes(
    { kind: "cron", expression: "0 12 * * *", timezone: "Pacific/Apia" },
    "2011-12-29T23:00:00Z",
    2,
  );
  assert.deepEqual(
    result.map((x) => x.local),
    ["2011-12-31T12:00", "2012-01-01T12:00"],
  );
});
test("P008-02 finite cron fields, leap dates, OR days, aliases and rejected syntax", async () => {
  for (const text of [
    "* * * * * *",
    "@hourly",
    "0 0 ? * *",
    "0 0 L * *",
    "60 * * * *",
    "*/0 * * * *",
    "0 0 * JAN *",
    "0 0 * * 9",
    "1-0 * * * *",
    "* * * * *;echo",
  ])
    assert.throws(() => parseCron(text));
  assert.deepEqual(parseCron("0 0 * * 0,7").weekday.values, [0]);
  assert.equal(
    (
      await nextMinutes(
        { kind: "cron", expression: "0 0 29 2 *", timezone: "UTC" },
        "2026-01-01T00:00:00Z",
        8,
      )
    ).length,
    1,
  );
  await assert.rejects(
    nextMinutes(
      { kind: "cron", expression: "0 0 30 2 *", timezone: "UTC" },
      "2026-01-01T00:00:00Z",
    ),
    /No future occurrence/,
  );
  const or = await nextMinutes(
    { kind: "cron", expression: "0 0 15 * 1", timezone: "UTC" },
    "2026-09-13T00:00:00Z",
    2,
  );
  assert.deepEqual(
    or.map((x) => x.local),
    ["2026-09-14T00:00", "2026-09-15T00:00"],
  );
  assert.throws(() =>
    resolveOneTime("2026-02-30T12:00", "UTC", "2026-01-01T00:00:00Z"),
  );
  assert.throws(() =>
    resolveOneTime("2026-09-08T12:00", "+08:00", "2026-01-01T00:00:00Z"),
  );
  assert.throws(() =>
    resolveOneTime("2032-01-01T12:00", "UTC", "2026-01-01T00:00:00Z"),
  );
});
test("P008-02 dense rules are bounded, yield to control work and preserve strict cursor", async () => {
  let yielded = false;
  setImmediate(() => {
    yielded = true;
  });
  const rows = await nextMinutes(
    { kind: "cron", expression: "* * * * *", timezone: "UTC" },
    "2026-09-08T23:58:30Z",
    128,
  );
  assert.equal(rows.length, 128);
  assert.equal(rows[0].instant, "2026-09-08T23:59:00Z");
  assert.equal(new Set(rows.map((x) => x.local)).size, 128);
  assert.equal(yielded, true);
  assert.equal(timeFingerprint().digest.length, 64);
});

test("P008-02 catch-up selects the latest three once, excluding the second fold", async () => {
  const { recentMinutes } = await import(
    "../../packages/schedules/src/time.ts"
  );
  const rule = {
    kind: "cron" as const,
    expression: "* * * * *",
    timezone: "America/New_York",
  };
  const result = await recentMinutes(
    rule,
    "2026-11-01T00:00:00Z",
    "2026-11-01T06:30:00Z",
  );
  assert.deepEqual(
    result.map((v) => v.instant),
    ["2026-11-01T05:57:00Z", "2026-11-01T05:58:00Z", "2026-11-01T05:59:00Z"],
  );
  const dense = await recentMinutes(
    { ...rule, timezone: "UTC" },
    "2026-01-01T00:00:00Z",
    "2026-01-02T00:00:00Z",
  );
  assert.deepEqual(
    dense.map((v) => v.instant),
    ["2026-01-01T23:58:00Z", "2026-01-01T23:59:00Z", "2026-01-02T00:00:00Z"],
  );
});

test("P008-02 wildcard syntax governs day restriction and old one-time catch-up skips", async () => {
  const full = await nextMinutes(
    { kind: "cron", expression: "0 9 1-31 * 1", timezone: "UTC" },
    "2026-09-14T10:00:00Z",
    2,
  );
  assert.deepEqual(
    full.map((x) => x.local),
    ["2026-09-15T09:00", "2026-09-16T09:00"],
  );
  const stepped = await nextMinutes(
    { kind: "cron", expression: "0 9 */2 * 1", timezone: "UTC" },
    "2026-09-14T10:00:00Z",
    2,
  );
  assert.deepEqual(
    stepped.map((x) => x.local),
    ["2026-09-21T09:00", "2026-10-05T09:00"],
  );
  const { recentMinutes } = await import(
    "../../packages/schedules/src/time.ts"
  );
  assert.deepEqual(
    await recentMinutes(
      { kind: "once", local: "2026-09-01T09:00", timezone: "UTC" },
      "2026-09-02T00:00:00Z",
      "2026-09-03T00:00:00Z",
    ),
    [],
  );
});
