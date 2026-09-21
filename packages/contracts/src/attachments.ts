/** Shared attachment budgets; this module is safe to import in the browser. */
export const ATTACHMENT_LIMITS = Object.freeze({
  imageBytes: 10485760,
  textBytes: 10485760,
  fileBytes: 10485760,
  turnBytes: 20971520,
  turnCount: 4,
  sessionCount: 32,
  sessionBytes: 104857600,
  instanceBytes: 524288000,
  expiryHours: 24,
});
