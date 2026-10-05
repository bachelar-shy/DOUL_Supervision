import { useEffect, useState } from "react";
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
        <RegisterTable
          rows={rows}
          rowKey={(row) => row.id}
          columns={[
            {
              id: "actorGroup",
              header: "사용자군",
              cell: (row) =>
                roles[String(row.actorGroup)] || String(row.actorGroup),
            },
            {
              id: "roleCode",
              header: "프로젝트 역할",
              cell: (row) => String(row.roleCode),
            },
            {
              id: "scope",
              header: "분야",
              cell: () => "건축 / 지정 패키지",
            },
            {
              id: "validTo",
              header: "배치 종료",
              cell: (row) => String(row.validTo).slice(0, 10),
            },
            {
              id: "active",
              header: "상태",
              cell: (row) => (row.active ? "유효" : "중지"),
            },
          ]}
        />
      </RegisterTemplate>
    </PageBoundary>
  );
}
