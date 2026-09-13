/** A failed process inspection must be visible, never reported as stopped or live. */
export async function settleBackgroundRetirement(actions: {
  retire(): Promise<boolean>;
  uncertain(): Promise<void>;
  release(): Promise<void>;
}) {
  let confirmed = false;
  try {
    confirmed = await actions.retire();
  } catch {
    // Treat transport/inspection failures exactly like an unconfirmed result.
  }
  if (!confirmed) {
    await actions.uncertain();
    return false;
  }
  await actions.release();
  return true;
}
