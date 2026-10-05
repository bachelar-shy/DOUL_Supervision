import { useEffect, useState } from "react";
import type { RecordDTO, Workspace } from "../data/ui-contract";
import type { SupervisionClient } from "../data/supervision-client";
import { roles } from "../labels";
import { RegisterTemplate } from "../ui/templates";
import { SectionHeader } from "../ui";
import { PageBoundary } from "./PageBoundary";

export function AdminPage({
  client,
  workspace,
}: {
  client: SupervisionClient;
  workspace: Workspace;
}) {
  const [rows, setRows] = useState<RecordDTO[]>([]);
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
        <SectionHeader title="프로젝트 역할배정" meta="현재 조회 전용" />
      }
      notice={
        <div className="notice">
          관리자 계정은 기술승인·법정서명 권한을 자동으로 갖지 않습니다.
          시험기관·외부검토기관은 자료 출처만 보존하고 로그인 대상에서 제외합니다.
        </div>
      }
    >
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>사용자군</th>
              <th>프로젝트 역할</th>
              <th>분야</th>
              <th>배치 종료</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{roles[String(r.actorGroup)] || String(r.actorGroup)}</td>
                <td>{String(r.roleCode)}</td>
                <td>건축 / 지정 패키지</td>
                <td>{String(r.validTo).slice(0, 10)}</td>
                <td>{r.active ? "유효" : "중지"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </RegisterTemplate>
    </PageBoundary>
  );
}
