import { AppShell } from "./app/AppShell";
import { createSupervisionClient } from "./data/supervision-client";
import "./App.css";
import { useState } from "react";
import { PasswordLogin } from "./pages/PasswordLogin";

const client = createSupervisionClient();

export default function App() {
  const [authorized, setAuthorized] = useState(false);
  const passwordMode = client.kind === "http" && (import.meta.env.VITE_DOUL_AUTH_MODE === "password" || (!import.meta.env.DEV && import.meta.env.VITE_DOUL_AUTH_MODE !== "demo"));
  if (passwordMode && !authorized) return <PasswordLogin client={client} onAuthenticated={() => setAuthorized(true)} />;
  return <AppShell client={client} passwordMode={passwordMode} onLogout={() => setAuthorized(false)} />;
}
