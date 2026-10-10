import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { RecordDTO, Workspace } from "../data/ui-contract";
import type { SupervisionClient } from "../data/supervision-client";
import { roles } from "../labels";
import { RegisterTemplate } from "../ui/templates";
import { SectionHeader } from "../ui";
import { RegisterTable } from "../ui/catalog";
import { PageBoundary } from "./PageBoundary";

export function AdminPage({
  client,
  workspace,
}: {
  client: SupervisionClient;
  workspace: Workspace;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<RecordDTO[]>([]);
  const [accountRole, setAccountRole] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [creating, setCreating] = useState(false);
  const [accountMessage, setAccountMessage] = useState("");
  const [accountError, setAccountError] = useState("");
  const passwordMode = client.session?.mode === "PASSWORD";
  async function createAccount(event: React.FormEvent) {
    event.preventDefault(); setCreating(true); setAccountMessage(""); setAccountError("");
    const selected = rows.find(row => row.id === accountRole);
    if (!selected) {setCreating(false); return;}
    try {
      await client.request("/auth/accounts", {method:"POST",body:JSON.stringify({username,password,partyId:selected.partyId,roleAssignmentId:selected.id})});
      setAccountMessage("계정이 생성되었습니다. 사용자에게 아이디와 초기 비밀번호를 안전하게 전달하세요.");
      setUsername(""); setPassword(""); setAccountRole("");
    } catch {setAccountError("계정 생성에 실패했습니다. 중복 아이디, 역할·권한, 비밀번호 규칙을 확인하세요.");}
    finally {setCreating(false);}
  }
  useEffect(() => {
    client
      .request<RecordDTO[]>(client.path("/roles"))
      .then(setRows)
      .catch(() => setRows([]));
  }, [client, workspace]);
  return (
    <PageBoundary name="admin">
      <RegisterTemplate
        header={
          <SectionHeader
            title={t("admin.title")}
            meta={t("admin.meta")}
          />
        }
        notice={
          <div className="notice">{t("admin.notice")}</div>
        }
      >
        {passwordMode && client.session?.actor.actorGroup === "ADM" && (
          <form onSubmit={event => void createAccount(event)} className="panel" style={{padding:20,display:"grid",gap:12,maxWidth:600}}>
            <h2>사용자 계정 생성</h2>
            <p>기존 프로젝트 관계자에게 로그인 계정을 발급합니다. 담당자와 역할은 먼저 등록되어 있어야 합니다.</p>
            <label>담당자·역할<select required value={accountRole} onChange={event=>setAccountRole(event.target.value)}>
              <option value="">담당자 선택</option>
              {rows.filter(row => row.active && row.partyId).map(row=><option key={row.id} value={row.id}>{roles[String(row.actorGroup)] || String(row.actorGroup)} · {String(row.roleCode)} · {String(row.partyId).slice(0,8)}</option>)}
            </select></label>
            <label>로그인 아이디<input value={username} onChange={event=>setUsername(event.target.value)} pattern="[a-z][a-z0-9._-]{2,63}" maxLength={64} autoComplete="off" required/></label>
            <label>초기 비밀번호 (12자 이상)<input type="password" value={password} onChange={event=>setPassword(event.target.value)} minLength={12} maxLength={128} autoComplete="new-password" required/></label>
            {accountError && <p role="alert">{accountError}</p>}
            {accountMessage && <p role="status">{accountMessage}</p>}
            <button className="primary" type="submit" disabled={creating || !accountRole}>{creating?"생성 중…":"계정 생성"}</button>
          </form>
        )}
        <RegisterTable
          rows={rows}
          rowKey={(row) => row.id}
          columns={[
            {
              id: "actorGroup",
              header: t("admin.column.actorGroup"),
              cell: (row) =>
                roles[String(row.actorGroup)] || String(row.actorGroup),
            },
            {
              id: "roleCode",
              header: t("admin.column.role"),
              cell: (row) => String(row.roleCode),
            },
            {
              id: "scope",
              header: t("admin.column.scope"),
              cell: () => t("admin.scopeValue"),
            },
            {
              id: "validTo",
              header: t("admin.column.validTo"),
              cell: (row) => String(row.validTo).slice(0, 10),
            },
            {
              id: "active",
              header: t("admin.column.status"),
              cell: (row) =>
                row.active ? t("admin.status.active") : t("admin.status.inactive"),
            },
          ]}
        />
      </RegisterTemplate>
    </PageBoundary>
  );
}
