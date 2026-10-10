import { useState, type FormEvent } from "react";
import type { SupervisionClient } from "../data/supervision-client";

export function PasswordLogin({ client, onAuthenticated }: {client: SupervisionClient; onAuthenticated: () => void}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault(); setError(""); setBusy(true);
    try { await client.loginPassword(username, password); onAuthenticated(); }
    catch { setError("아이디 또는 비밀번호를 확인해 주세요."); }
    finally { setBusy(false); }
  }
  return <main style={{minHeight:"100vh",display:"grid",placeItems:"center",padding:24}}>
    <form onSubmit={e=>void submit(e)} className="panel" style={{width:"100%",maxWidth:420,padding:32,display:"grid",gap:16}}>
      <h1>DOUL 감리</h1><p>관리자가 발급한 계정으로 로그인하세요.</p>
      <label style={{display:"grid",gap:6}}>아이디<input autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)} required maxLength={64}/></label>
      <label style={{display:"grid",gap:6}}>비밀번호<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/></label>
      {error && <p role="alert" style={{color:"#b42318"}}>{error}</p>}
      <button className="primary" type="submit" disabled={busy}>{busy?"로그인 중…":"로그인"}</button>
    </form>
  </main>;
}
