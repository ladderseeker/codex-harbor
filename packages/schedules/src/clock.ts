import type { DB } from "../../storage/src/index.ts";
/** Test scheduling time never substitutes for authentication, lease or approval clocks. */
export async function schedulerNow(db: DB): Promise<string> {
  if (process.env.HARBOR_SCHEDULE_TEST_CLOCK !== undefined) {
    if (
      process.env.HARBOR_SCHEDULE_TEST_CLOCK !== "1" ||
      process.env.NODE_ENV !== "test" ||
      process.env.HARBOR_FIXTURE_MODE !== "private-test"
    )
      throw Error(
        "Private schedule test clock requires the external-fixture profile",
      );
    const row = (
      await db.query("SELECT now_at FROM schedule_test_clock WHERE singleton")
    ).rows[0];
    if (!row) throw Error("Owned schedule test clock is not initialized");
    return row.now_at.toISOString();
  }
  return (
    await db.query("SELECT clock_timestamp() AS now")
  ).rows[0].now.toISOString();
}
