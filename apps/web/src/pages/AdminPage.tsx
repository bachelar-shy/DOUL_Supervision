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
