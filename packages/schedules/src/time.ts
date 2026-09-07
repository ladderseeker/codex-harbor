import { Temporal } from "@js-temporal/polyfill";
import { createHash } from "node:crypto";
import { setImmediate as yieldToLoop } from "node:timers/promises";
import { HarborError } from "../../policy/src/index.ts";

export type ScheduleRule =
  | { kind: "once"; local: string; timezone: string }
  | { kind: "cron"; expression: string; timezone: string };
export interface IntendedMinute {
  local: string;
  instant: string;
  offset: string;
  timezone: string;
}
interface Field {
  values: number[];
  restricted: boolean;
}
function invalid(message: string): never {
  throw new HarborError(400, "SCHEDULE_RULE", message);
}
export function canonicalTimezone(value: string) {
  if (value.length > 100 || !/^[A-Za-z_][A-Za-z0-9_+\-/]*$/.test(value))
    invalid("Choose a valid IANA timezone");
  try {
    return new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions()
      .timeZone;
  } catch {
    return invalid("Choose a valid IANA timezone");
  }
}
function field(
  raw: string,
  minimum: number,
  maximum: number,
  sunday = false,
): Field {
  const values = new Set<number>();
  for (const term of raw.split(",")) {
    const match = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(term);
    if (!match)
      invalid("Use numeric cron fields, ranges, lists and positive steps");
    const step = match[2] === undefined ? 1 : Number(match[2]);
    if (!Number.isSafeInteger(step) || step < 1 || step > maximum - minimum + 1)
      invalid("Cron step is outside its field");
    let start = minimum,
      end = maximum;
    if (match[1] !== "*") {
      const range = match[1].split("-").map(Number);
      start = range[0];
      end = range[1] ?? (match[2] ? maximum : start);
      if (start < minimum || end > maximum || start > end)
        invalid("Cron value is outside its field");
    }
    for (let value = start; value <= end; value += step)
      values.add(sunday && value === 7 ? 0 : value);
  }
  const result = [...values].sort((a, b) => a - b);
  return {
    values: result,
    restricted: !raw.includes("*"),
  };
}
export function parseCron(expression: string) {
  if (Buffer.byteLength(expression) > 200)
    invalid("Cron expression is too long");
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) invalid("Use exactly five cron fields");
  return {
    minute: field(parts[0], 0, 59),
    hour: field(parts[1], 0, 23),
    day: field(parts[2], 1, 31),
    month: field(parts[3], 1, 12),
    weekday: field(parts[4], 0, 7, true),
  };
}
function mapMinute(
  local: Temporal.PlainDateTime,
  timezone: string,
): IntendedMinute | undefined {
  const zoned = local.toZonedDateTime(timezone, { disambiguation: "earlier" });
  if (!zoned.toPlainDateTime().equals(local)) return undefined;
  return {
    local: local.toString({ smallestUnit: "minute" }),
    instant: zoned.toInstant().toString(),
    offset: zoned.offset,
    timezone,
  };
}
export function resolveOneTime(
  local: string,
  timezoneInput: string,
  after: string,
) {
  const timezone = canonicalTimezone(timezoneInput);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local))
    invalid("Use a local date and time at minute precision");
  let date: Temporal.PlainDateTime;
  try {
    date = Temporal.PlainDateTime.from(local, { overflow: "reject" });
  } catch {
    return invalid("Local date or time is invalid");
  }
  const result = mapMinute(date, timezone);
  if (!result)
    invalid("This local minute does not exist in the selected timezone");
  if (Temporal.Instant.compare(result.instant, after) <= 0)
    invalid("Choose a future one-time occurrence");
  if (
    Temporal.PlainDate.compare(
      date.toPlainDate(),
      Temporal.Instant.from(after)
        .toZonedDateTimeISO(timezone)
        .toPlainDate()
        .add({ years: 5 }),
    ) > 0
  )
    invalid("Choose an occurrence within five calendar years");
  return result;
}
/** Shared API/dispatcher evaluator: bounded dates/conversions, with no per-minute five-year scan. */
export async function nextMinutes(
  rule: ScheduleRule,
  after: string,
  limit = 8,
): Promise<IntendedMinute[]> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 128)
    throw new Error("Internal schedule preview limit");
  if (rule.kind === "once")
    return [resolveOneTime(rule.local, rule.timezone, after)];
  const timezone = canonicalTimezone(rule.timezone),
    cron = parseCron(rule.expression);
  const cursor = Temporal.Instant.from(after);
  let date = cursor.toZonedDateTimeISO(timezone).toPlainDate();
  const horizon = date.add({ years: 5 });
  const started = performance.now(),
    results: IntendedMinute[] = [];
  let dates = 0,
    conversions = 0;
  const budget = async () => {
    if (
      dates > 2000 ||
      conversions > 4096 ||
      performance.now() - started > 2000
    )
      throw new HarborError(
        422,
        "SCHEDULE_EVALUATION_LIMIT",
        "Schedule evaluation budget exhausted",
      );
    await yieldToLoop();
  };
  while (Temporal.PlainDate.compare(date, horizon) <= 0) {
    if (++dates % 32 === 0) await budget();
    const dom = cron.day.values.includes(date.day),
      dow = cron.weekday.values.includes(date.dayOfWeek % 7);
    const matchesDay =
      cron.day.restricted && cron.weekday.restricted ? dom || dow : dom && dow;
    if (cron.month.values.includes(date.month) && matchesDay) {
      const candidates: IntendedMinute[] = [];
      for (const hour of cron.hour.values)
        for (const minute of cron.minute.values) {
          conversions++;
          if (conversions > 4096 || performance.now() - started > 2000)
            await budget();
          if (conversions % 64 === 0) await budget();
          const candidate = mapMinute(
            date.toPlainDateTime({ hour, minute }),
            timezone,
          );
          if (
            candidate &&
            Temporal.Instant.compare(candidate.instant, cursor) > 0
          )
            candidates.push(candidate);
          // Local times on one date are sorted, but collect and sort instants to
          // handle historical/non-hour offset transitions without assuming it.
        }
      candidates.sort((a, b) => Temporal.Instant.compare(a.instant, b.instant));
      results.push(...candidates.slice(0, limit - results.length));
      if (results.length >= limit) return results;
    }
    date = date.add({ days: 1 });
  }
  if (!results.length)
    invalid("No future occurrence within five calendar years");
  return results;
}
export function timeFingerprint() {
  const versions = {
    node: process.versions.node,
    icu: process.versions.icu,
    tz: process.versions.tz,
    polyfill: "0.5.1",
    policy: "minute-first-fold-skip-gap-v1",
  };
  return {
    ...versions,
    digest: createHash("sha256").update(JSON.stringify(versions)).digest("hex"),
  };
}

/** Latest due occurrences inside a bounded 24-hour catch-up window, oldest first. */
export async function recentMinutes(
  rule: ScheduleRule,
  after: string,
  through: string,
  limit = 3,
): Promise<IntendedMinute[]> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 3)
    throw Error("Internal catch-up limit");
  const end = Temporal.Instant.from(through),
    start = Temporal.Instant.from(after);
  if (Temporal.Instant.compare(start, end) >= 0) return [];
  if (end.epochMilliseconds - start.epochMilliseconds > 86400000)
    throw Error("Internal catch-up window");
  if (rule.kind === "once") {
    const timezone = canonicalTimezone(rule.timezone);
    const result = mapMinute(Temporal.PlainDateTime.from(rule.local), timezone);
    return result &&
      Temporal.Instant.compare(result.instant, start) > 0 &&
      Temporal.Instant.compare(result.instant, end) <= 0
      ? [result]
      : [];
  }
  const timezone = canonicalTimezone(rule.timezone),
    cron = parseCron(rule.expression);
  let date = end.toZonedDateTimeISO(timezone).toPlainDate();
  const first = start.toZonedDateTimeISO(timezone).toPlainDate();
  const results: IntendedMinute[] = [],
    begun = performance.now();
  let conversions = 0,
    dates = 0;
  while (Temporal.PlainDate.compare(date, first) >= 0) {
    if (++dates > 4)
      throw new HarborError(
        422,
        "SCHEDULE_EVALUATION_LIMIT",
        "Catch-up date budget exhausted",
      );
    const dom = cron.day.values.includes(date.day),
      dow = cron.weekday.values.includes(date.dayOfWeek % 7);
    if (
      cron.month.values.includes(date.month) &&
      (cron.day.restricted && cron.weekday.restricted ? dom || dow : dom && dow)
    ) {
      const candidates: IntendedMinute[] = [];
      for (const hour of cron.hour.values)
        for (const minute of cron.minute.values) {
          if (++conversions > 4096 || performance.now() - begun > 2000)
            throw new HarborError(
              422,
              "SCHEDULE_EVALUATION_LIMIT",
              "Catch-up evaluation budget exhausted",
            );
          if (conversions % 64 === 0) await yieldToLoop();
          const candidate = mapMinute(
            date.toPlainDateTime({ hour, minute }),
            timezone,
          );
          if (
            candidate &&
            Temporal.Instant.compare(candidate.instant, start) > 0 &&
            Temporal.Instant.compare(candidate.instant, end) <= 0
          )
            candidates.push(candidate);
        }
      candidates.sort((a, b) => Temporal.Instant.compare(b.instant, a.instant));
      results.push(...candidates.slice(0, limit - results.length));
      if (results.length === limit) break;
    }
    date = date.subtract({ days: 1 });
  }
  return results.sort((a, b) => Temporal.Instant.compare(a.instant, b.instant));
}
