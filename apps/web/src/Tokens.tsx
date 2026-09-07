import { useEffect, useRef, useState } from "react";
import { ApiError, mutate, newIntent, request, type Intent } from "./api.ts";
interface Token {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  project_ids: string[];
  permission_profile: string;
  expires_at: string;
  revoked: boolean;
  last_used_at: string | null;
}
export function Tokens({
  csrf,
  projects,
}: {
  csrf: string;
  projects: { id: string; name: string }[];
}) {
  const [tokens, setTokens] = useState<Token[]>([]),
    [name, setName] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [scopes, setScopes] = useState<string[]>(["read"]),
    [profile, setProfile] = useState("read-only"),
    [days, setDays] = useState(30),
    [raw, setRaw] = useState(""),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const pending = useRef<Intent | undefined>(undefined);
  const refresh = async () =>
    setTokens(
      (await request<{ tokens: Token[] }>("/security/api-tokens")).tokens,
    );
  useEffect(() => {
    void refresh().catch(() => setError("Token settings unavailable"));
  }, []);
  async function submit(intent: Intent) {
    if (busy) return;
    setBusy(true);
    setError("");
    pending.current = intent;
    try {
      const result = await mutate<{
        secret?: string;
        secretUnavailable?: boolean;
      }>(intent, csrf);
      pending.current = undefined;
      setRaw(result.secret ?? "");
      setNotice(
        result.secretUnavailable
          ? "This creation was already accepted. Its secret cannot be shown again. Revoke the token and create a replacement."
          : result.secret
            ? "Copy this token now. Harbor will never show it again."
            : "Token revoked. Running work continues; queued work and streams lose access.",
      );
      await refresh();
    } catch (failure) {
      if (
        failure instanceof ApiError &&
        failure.status >= 400 &&
        failure.status < 500
      ) {
        pending.current = undefined;
        setError(failure.message);
      } else
        setError(
          "Request could not be confirmed. Retry the same request to reconcile its result.",
        );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="token-settings">
      <p>
        Create limited credentials for scripts. Tokens expire within 90 days and
        only access selected projects.
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {raw && (
        <label>
          One-time API token
          <input
            aria-label="One-time API token"
            readOnly
            value={raw}
            autoComplete="off"
          />
          <button onClick={() => setRaw("")}>Hide secret</button>
        </label>
      )}
      {pending.current && (
        <button disabled={busy} onClick={() => void submit(pending.current!)}>
          Retry token request
        </button>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(
            newIntent(
              "/security/api-tokens",
              {
                name,
                projectIds: selected,
                scopes,
                permissionProfile: profile,
                expiresInDays: days,
              },
              "Create API token",
            ),
          );
        }}
      >
        <fieldset disabled={busy || !!pending.current}>
          <legend>New API token</legend>
          <label>
            Token name
            <input
              aria-label="Token name"
              required
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <fieldset>
            <legend>Allowed projects</legend>
            {projects.map((p) => (
              <label key={p.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(p.id)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...selected, p.id]
                        : selected.filter((id) => id !== p.id),
                    )
                  }
                />
                {p.name}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Capabilities</legend>
            {[
              "read",
              "execute",
              "approve",
              "cancel",
              "files:read",
              "files:write",
              "git:read",
              "git:write",
            ].map((scope) => (
              <label key={scope}>
                <input
                  type="checkbox"
                  aria-label={`Token scope ${scope}`}
                  checked={scopes.includes(scope)}
                  onChange={(e) =>
                    setScopes(
                      e.target.checked
                        ? [...scopes, scope]
                        : scopes.filter((s) => s !== scope),
                    )
                  }
                />
                {scope}
              </label>
            ))}
          </fieldset>
          <label>
            Maximum execution permissions
            <select
              aria-label="Token permission ceiling"
              value={profile}
              onChange={(e) => setProfile(e.target.value)}
            >
              <option value="read-only">Read only</option>
              <option value="workspace-write">Workspace write</option>
            </select>
          </label>
          <label>
            Expires in days
            <input
              aria-label="Token expiry days"
              type="number"
              min={1}
              max={90}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            />
          </label>
          <button disabled={!name || !selected.length || !scopes.length}>
            Create API token
          </button>
        </fieldset>
      </form>
      <h3>Issued tokens</h3>
      {tokens.length === 0 && <p>No tokens issued.</p>}
      <ul>
        {tokens.map((t) => (
          <li key={t.id}>
            <strong>{t.name}</strong> <code>{t.prefix}…</code>
            <p>
              {t.scopes.join(", ")} · {t.permission_profile} · Expires{" "}
              {new Date(t.expires_at).toLocaleDateString()}
            </p>
            <p>
              Last used:{" "}
              {t.last_used_at
                ? new Date(t.last_used_at).toLocaleString()
                : "Never"}
            </p>
            {t.revoked ? (
              <span>Revoked</span>
            ) : (
              <button
                disabled={busy}
                aria-label={`Revoke ${t.name}`}
                onClick={() =>
                  void submit(
                    newIntent(
                      `/security/api-tokens/${t.id}/revoke`,
                      {},
                      "Revoke API token",
                    ),
                  )
                }
              >
                Revoke
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
