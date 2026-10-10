import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { SupervisionClient } from "../data/supervision-client";

export function PasswordLogin({ client, onAuthenticated, notice }: {
  client: SupervisionClient;
  onAuthenticated: () => void;
  notice?: "expired" | "logoutUnverified" | "configMismatch";
}) {
  const { t } = useTranslation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await client.loginPassword(username, password);
      setPassword("");
      onAuthenticated();
    } catch {
      setError(t("auth.login.invalid"));
      setPassword("");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <form onSubmit={event => void submit(event)} className="panel"
        style={{ width: "100%", maxWidth: 420, padding: 32, display: "grid", gap: 16 }}>
        <h1>{t("auth.login.title")}</h1>
        <p>{t("auth.login.help")}</p>
        {notice && <p role="alert">{t("auth.login." + notice)}</p>}
        <label style={{ display: "grid", gap: 6 }}>{t("auth.login.username")}
          <input autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} required maxLength={64} />
        </label>
        <label style={{ display: "grid", gap: 6 }}>{t("auth.login.password")}
          <input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required />
        </label>
        {error && <p role="alert" style={{ color: "#b42318" }}>{error}</p>}
        <button className="primary" type="submit" disabled={busy}>
          {busy ? t("auth.login.submitting") : t("auth.login.submit")}
        </button>
      </form>
    </main>
  );
}
