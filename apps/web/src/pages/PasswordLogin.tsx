import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { SupervisionClient } from "../data/supervision-client";
import "./fieldwire-auth-settings.css";

const testRoles = [
  { id: "OWN", label: "발주처", description: "발주처 업무 확인" },
  { id: "CON", label: "시공사", description: "현장 기록·검측 요청" },
  { id: "SUP", label: "감리자", description: "검측·감리 업무" },
  { id: "ADM", label: "어드민", description: "프로젝트·계정 관리" },
] as const;

export function PasswordLogin({ client, onAuthenticated, notice, testRoleMode = false }: {
  client: SupervisionClient;
  onAuthenticated: () => void;
  notice?: "expired" | "logoutUnverified" | "configMismatch";
  testRoleMode?: boolean;
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

  async function testLogin(role: "OWN" | "CON" | "SUP" | "ADM") {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      await client.loginTestRole(role);
      window.history.replaceState(null, "", "#/today");
      onAuthenticated();
    } catch {
      setError("테스트 역할로 접속할 수 없습니다. 테스트 서버 상태를 확인하십시오.");
    } finally {
      setBusy(false);
    }
  }

  if (testRoleMode) {
    return <main className="test-role-login-screen" data-ui-component="test-role-login">
      <section className="test-role-login-card" aria-labelledby="test-role-login-title">
        <div className="test-role-login-brand">DOUL <span>INTERNATIONAL</span></div>
        <p className="test-role-login-kicker">감리앱 · 테스트 전용</p>
        <h1 id="test-role-login-title">테스트 역할 선택</h1>
        <p className="test-role-login-help">사용할 역할을 선택하면 비밀번호 없이 메인 화면으로 이동합니다.</p>
        {notice && <p role="alert" className="test-role-login-notice">{t("auth.login." + notice)}</p>}
        {error && <p role="alert" className="test-role-login-error">{error}</p>}
        <div className="test-role-login-choices" role="group" aria-label="테스트 로그인 역할 선택">
          {testRoles.map(role => <button
            type="button" key={role.id}
            className="test-role-login-option"
            data-test-role={role.id}
            disabled={busy}
            onClick={() => { void testLogin(role.id); }}
          >
            <strong>{role.label}</strong>
            <span>{role.description}</span>
          </button>)}
        </div>
        <p className="test-role-login-footnote">DOUL 합성 테스트 프로젝트에만 접속됩니다. 실제 현장 증빙이나 정식 운영 계정이 아닙니다.</p>
      </section>
    </main>;
  }

  return (
    <main className="doul-auth-screen" data-ui-component="password-login">
      <form onSubmit={event => void submit(event)} className="panel doul-auth-card">
        <div className="doul-auth-brand" aria-label="DOUL INTERNATIONAL">
          DOUL <span>INTERNATIONAL</span>
        </div>
        <h1 className="doul-auth-title">{t("auth.login.title")}</h1>
        <p className="doul-auth-description">{t("auth.login.help")}</p>
        {notice && <p className="doul-auth-notice" role="alert">{t("auth.login." + notice)}</p>}
        <label className="doul-auth-field">{t("auth.login.username")}
          <input autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} required maxLength={64} />
        </label>
        <label className="doul-auth-field">{t("auth.login.password")}
          <input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required />
        </label>
        {error && <p role="alert" className="doul-auth-error">{error}</p>}
        <button className="primary doul-auth-submit" type="submit" disabled={busy}>
          {busy ? t("auth.login.submitting") : t("auth.login.submit")}
        </button>
      </form>
    </main>
  );
}
