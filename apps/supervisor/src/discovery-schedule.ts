/** A stored capability record this old is refreshed by the next probe. */
export const DISCOVERY_REFRESH_SECONDS = 1800;
/** Minimum wait after a discovery attempt; see discoveryDue for the exception. */
export const DISCOVERY_RETRY_MS = 60_000;

/** The supervisor's last probe: when it started and whether it failed. */
export type DiscoveryAttempt = { at: number; failed: boolean };
/** The stored capability record's age and account state. */
export type StoredCapabilities = { ageSeconds: number; authenticated: boolean };

/**
 * Whether a capability probe is due. A recent attempt is one that started less
 * than DISCOVERY_RETRY_MS before now; an attempt time after now, from a clock
 * that moved backwards, also counts as recent, so the wait always holds.
 *
 * Without a stored record, a probe is due unless the recent attempt failed: a
 * successful attempt whose record was deleted since, as a credential change
 * does, probes again at once. With a record, no probe starts after a recent
 * attempt; otherwise one is due while the account is not signed in or once the
 * record is DISCOVERY_REFRESH_SECONDS old.
 */
export function discoveryDue(
  now: number,
  last: DiscoveryAttempt | undefined,
  stored: StoredCapabilities | undefined,
): boolean {
  const recent = last !== undefined && now - last.at < DISCOVERY_RETRY_MS;
  if (!stored) return !(recent && last?.failed);
  if (recent) return false;
  return (
    !stored.authenticated || stored.ageSeconds >= DISCOVERY_REFRESH_SECONDS
  );
}
