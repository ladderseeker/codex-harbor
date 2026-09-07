import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, mutate, newIntent, request, type Intent } from "./api.ts";

export interface CredentialStatus {
  configured: boolean;
  available: boolean;
}

export function Credentials({
  csrfToken,
  hasProjects,
  authenticated,
  changed,
  expired,
}: {
  csrfToken: string;
  hasProjects: boolean;
  authenticated: boolean;
  changed: () => void;
  expired: () => void;
}) {
  const [status, setStatus] = useState<CredentialStatus>();
  const [loading, setLoading] = useState(true);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [uncertain, setUncertain] = useState(false);
  const intentRef = useRef<Intent | undefined>(undefined);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      setStatus(
        await request<CredentialStatus>("/security/runtime-credentials"),
      );
      setError("");
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) expired();
      setError(
        "Account setup is unavailable. Check that the credential service and its private storage are configured on the server.",
      );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
    return () => {
      if (intentRef.current) intentRef.current.body = {};
      intentRef.current = undefined;
    };
  }, []);

  async function submit(intent: Intent) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    intentRef.current = intent;
    try {
      const result = await mutate<CredentialStatus>(intent, csrfToken);
      intent.body = {};
      intentRef.current = undefined;
      setApiKey("");
      setUncertain(false);
      setConfirmRemove(false);
      setStatus(result);
      setNotice(
        result.configured
          ? "Key saved. Harbor is checking account access."
          : "Key removed from Harbor. This does not revoke the key at the provider.",
      );
      changed();
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) expired();
      const unknown =
        failure instanceof ApiError &&
        (failure.status === 0 || failure.status >= 500);
      setUncertain(unknown);
      // Never render credential endpoint response text, which may contain sensitive input.
      setError(
        unknown
          ? "The result is not confirmed. Retry the same request to check; do not submit a replacement key yet."
          : failure instanceof ApiError && failure.status === 409
            ? "This change could not be applied in the current state. Finish active work and check account status before trying again."
            : "The key could not be saved. Check the key and server credential configuration.",
      );
      if (!unknown) {
        intent.body = {};
        intentRef.current = undefined;
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (!busy && !uncertain && apiKey.trim().length >= 16)
      void submit(
        newIntent(
          "/security/runtime-credentials",
          { apiKey: apiKey.trim() },
          "Save account key",
        ),
      );
  }

  return (
    <div className="account-panel">
      <p className="account-intro">
        Connect the account Codex uses for work. Keep API keys out of
        conversation messages.
      </p>
      <div className="account-status" role="status">
        <strong>
          {loading
            ? "Checking account setup…"
            : !status?.available
              ? "Account setup unavailable"
              : authenticated
                ? "Account ready"
                : status.configured
                  ? "Key saved; checking access"
                  : "No API key saved"}
        </strong>
        <p>
          {!hasProjects
            ? "Add your first project so Harbor can discover available models and check account access."
            : authenticated
              ? "The account is authenticated. Available models appear in your conversation settings."
              : "Harbor checks available models in your project. This can take a few seconds."}
        </p>
      </div>
      {(error || uncertain) && (
        <div className="dialog-error" role="alert">
          <p>
            {error ||
              "The result is not confirmed. Retry the same request to check."}
          </p>
          {busy && (
            <p className="field-help">
              Closing this dialog does not cancel a submitted account change.
            </p>
          )}
          {uncertain && (
            <button
              disabled={busy}
              onClick={() => {
                if (intentRef.current) void submit(intentRef.current);
              }}
            >
              Retry same request
            </button>
          )}
        </div>
      )}
      {notice && (
        <p className="account-notice" role="status">
          {notice}
        </p>
      )}
      {status?.available && (
        <form onSubmit={save} autoComplete="off">
          <label className="field">
            {status.configured ? "Replacement API key" : "API key"}
            <input
              type="password"
              name="harbor-api-key"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              minLength={16}
              maxLength={4096}
              disabled={busy || uncertain}
              aria-describedby="credential-help"
            />
          </label>
          <p className="field-help" id="credential-help">
            Sent securely to Harbor. The key is never saved in browser storage
            or shown in conversation history.
          </p>
          {status.configured && (
            <p className="field-help">
              Finish or stop active work before replacing or removing a key.
              Waiting requests also count as active work.
            </p>
          )}
          <div className="account-actions">
            <button
              className="primary"
              type="submit"
              disabled={busy || uncertain || apiKey.trim().length < 16}
            >
              {busy
                ? "Saving…"
                : status.configured
                  ? "Replace key"
                  : "Save key"}
            </button>
            {status.configured && (
              <button
                type="button"
                className="quiet-button danger-text"
                disabled={busy || uncertain}
                onClick={() => setConfirmRemove(true)}
              >
                Remove key
              </button>
            )}
          </div>
        </form>
      )}
      {confirmRemove && (
        <section
          className="remove-confirmation"
          aria-label="Confirm key removal"
        >
          <h3>Remove the saved key?</h3>
          <p>
            Future work will need account setup again. Finish active work before
            removing the key. Removing it from Harbor does not revoke it at the
            provider.
          </p>
          <div className="dialog-actions">
            <button disabled={busy} onClick={() => setConfirmRemove(false)}>
              Keep key
            </button>
            <button
              className="danger-button"
              disabled={busy || uncertain}
              onClick={() =>
                void submit(
                  newIntent(
                    "/security/runtime-credentials/remove",
                    {},
                    "Remove account key",
                  ),
                )
              }
            >
              Remove saved key
            </button>
          </div>
        </section>
      )}
      {busy && (
        <p className="field-help">
          Closing this dialog does not cancel a submitted account change.
        </p>
      )}
      {uncertain && (
        <p className="field-help">
          Closing this dialog clears the entered key and retry data from this
          page. Check account status before making another change.
        </p>
      )}
      <button
        className="quiet-button"
        disabled={loading || busy}
        onClick={() => {
          void refresh();
          changed();
        }}
      >
        Refresh account status
      </button>
    </div>
  );
}
