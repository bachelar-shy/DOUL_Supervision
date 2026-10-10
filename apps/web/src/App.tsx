import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppShell } from "./app/AppShell";
import { createSupervisionClient } from "./data/supervision-client";
import { PasswordLogin } from "./pages/PasswordLogin";
import "./App.css";

const client = createSupervisionClient();

export default function App() {
  const { t } = useTranslation();
  const [authorized, setAuthorized] = useState(false);
  const [notice, setNotice] = useState<"expired" | "logoutUnverified" | undefined>();
  const [checked, setChecked] = useState<"checking" | "valid" | "invalid">("checking");
  const configured = import.meta.env.VITE_DOUL_AUTH_MODE;
  const passwordMode = client.kind === "http" && configured === "password";
  const localDev = client.kind === "mock" || (import.meta.env.DEV && configured !== "password");

  useEffect(() => {
    if (!passwordMode) return;
    let active = true;
    void client.authMode().then(
      mode => { if (active) setChecked(mode === "password" ? "valid" : "invalid"); },
      () => { if (active) setChecked("invalid"); },
    );
    return () => { active = false; };
  }, [passwordMode]);

  useEffect(() => client.onAuthenticationExpired(() => {
    setAuthorized(false);
    setNotice("expired");
  }), []);

  if (!localDev && !passwordMode)
    return <main role="alert">{t("auth.login.externalUnavailable")}</main>;
  if (passwordMode && checked !== "valid")
    return <main role={checked === "invalid" ? "alert" : "status"}>
      {checked === "invalid" ? t("auth.login.configMismatch") : t("auth.login.submitting")}
    </main>;

  if (passwordMode && !authorized)
    return <PasswordLogin client={client} notice={notice} onAuthenticated={() => {
      setNotice(undefined);
      setAuthorized(true);
    }} />;
  return <AppShell client={client} passwordMode={passwordMode} onLogout={(revoked) => {
    setAuthorized(false);
    setNotice(revoked ? undefined : "logoutUnverified");
  }} />;
}
