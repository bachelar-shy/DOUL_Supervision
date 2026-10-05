import { useEffect, useMemo, useState } from "react";
import { Eye, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SupervisionClient } from "../data/supervision-client";
import type { RegisterProjectionRow, Workspace } from "../data/ui-contract";
import {
  formatRegisterValue,
  registerFieldLabel,
  registerRowSearchText,
  registerRowTitle,
  registerSourceLabel,
} from "../data/register-format";
import {
  registerProjectionCatalog,
  type RegisterProjectionDefinition,
} from "../data/register-projection-catalog.generated";
import { states } from "../labels";
import { EmptyState, SectionHeader, StatusBadge } from "../ui";
import {
  DetailDrawer,
  FilterBar,
  RegisterTable,
  type RegisterColumn,
} from "../ui/catalog";
import { RegisterTemplate } from "../ui/templates";

const recordDetailFields = [
  "status",
  "subtype",
  "discipline",
  "locationId",
  "packageId",
  "revision",
  "dueAt",
  "createdAt",
  "updatedAt",
] as const;

const recordFieldLabels: Record<string, string> = {
  status: "원본 상태",
  subtype: "하위 유형",
  discipline: "분야",
  locationId: "위치",
  packageId: "패키지",
  revision: "개정",
  dueAt: "처리 기한",
  createdAt: "생성 시각",
  updatedAt: "갱신 시각",
};

function sourceType(row: RegisterProjectionRow) {
  return row.sourceDomainRefs[0]?.objectType || "Unknown";
}

function sourceTypeOptionLabel(
  objectType: string,
  definition: RegisterProjectionDefinition,
) {
  const source = definition.sources.find((item) => item.objectType === objectType);
  const subtype = source?.subtype ? ` / ${source.subtype}` : "";
  return `${registerSourceLabel(objectType)}${subtype}`;
}

function RegisterDetail({
  row,
  definition,
}: {
  row: RegisterProjectionRow;
  definition: RegisterProjectionDefinition;
}) {
  const ref = row.sourceDomainRefs[0];
  const detailFields = recordDetailFields.filter(
    (key) => row.data[key] !== undefined && row.data[key] !== null,
  );

  return (
    <div className="space-y-5 py-4 text-sm">
      <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
        이 화면은 원본 업무 객체의 읽기 전용 Projection입니다. 상태 변경은 해당
        업무 화면의 명령과 권한 검증을 통해서만 수행됩니다.
      </div>

      <section>
        <h3 className="mb-2 text-xs font-semibold text-foreground">원본 객체</h3>
        <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
          <dt className="text-muted-foreground">유형</dt>
          <dd>{registerSourceLabel(ref?.objectType)}</dd>
          <dt className="text-muted-foreground">원본 ID</dt>
          <dd className="break-all font-mono">{ref?.objectId || "미확인"}</dd>
          <dt className="text-muted-foreground">원본 버전</dt>
          <dd>v{ref?.version ?? "-"}</dd>
          {detailFields.map((key) => (
            <FragmentPair
              key={key}
              label={recordFieldLabels[key] || key}
              value={formatRegisterValue(row.data[key], key)}
            />
          ))}
        </dl>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold text-foreground">
          계산·Projection 필드
        </h3>
        <dl className="grid grid-cols-[140px_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
          {definition.calculatedFields.map((field) => (
            <FragmentPair
              key={field}
              label={registerFieldLabel(field)}
              value={formatRegisterValue(row.calculated[field], field)}
              muted={row.unavailableFields.includes(field)}
            />
          ))}
        </dl>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold text-foreground">연결 원본</h3>
        <div className="space-y-2">
          {row.sourceDomainRefs.map((item) => (
            <div
              key={`${item.objectType}:${item.objectId}:${item.version}`}
              className="rounded-md border border-border px-3 py-2 text-xs"
            >
              <strong>{registerSourceLabel(item.objectType)}</strong>
              <span className="ml-2 text-muted-foreground">
                {item.objectId.slice(0, 12)} · v{item.version}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function FragmentPair({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={muted ? "text-muted-foreground" : ""}>{value}</dd>
    </>
  );
}

export function RegisterPage({
  client,
  workspace,
}: {
  client: SupervisionClient;
  workspace: Workspace;
}) {
  const [registerId, setRegisterId] = useState("11");
  const [rows, setRows] = useState<RegisterProjectionRow[]>([]);
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const definition =
    registerProjectionCatalog.find((item) => item.id === registerId) ||
    registerProjectionCatalog[10];

  async function load() {
    setLoading(true);
    try {
      const nextRows = await client.request<RegisterProjectionRow[]>(
        client.path(`/registers/${registerId}`),
      );
      setRows(nextRows);
      setError("");
    } catch (e) {
      setRows([]);
      setError(e instanceof Error ? e.message : "관리대장을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    client
      .request<RegisterProjectionRow[]>(
        client.path(`/registers/${registerId}`),
      )
      .then((nextRows) => {
        if (!active) return;
        setRows(nextRows);
        setError("");
      })
      .catch((e) => {
        if (!active) return;
        setRows([]);
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, registerId]);

  function changeRegister(nextRegisterId: string) {
    setLoading(true);
    setSourceFilter("all");
    setStatusFilter("all");
    setQuery("");
    setRegisterId(nextRegisterId);
  }

  const sourceOptions = useMemo(
    () => [...new Set(rows.map(sourceType))].sort(),
    [rows],
  );
  const statusOptions = useMemo(
    () =>
      [
        ...new Set(
          rows
            .map((row) => row.data.status)
            .filter((status): status is string => Boolean(status)),
        ),
      ].sort(),
    [rows],
  );

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (sourceFilter !== "all" && sourceType(row) !== sourceFilter) return false;
      if (statusFilter !== "all" && row.data.status !== statusFilter) return false;
      if (
        normalizedQuery &&
        !registerRowSearchText(row).includes(normalizedQuery)
      ) {
        return false;
      }
      return true;
    });
  }, [query, rows, sourceFilter, statusFilter]);

  const columns = useMemo<RegisterColumn<RegisterProjectionRow>[]>(
    () => [
      {
        id: "source",
        header: "원본",
        className: "min-w-28",
        cell: (row) => {
          const ref = row.sourceDomainRefs[0];
          return (
            <div className="space-y-0.5">
              <strong className="block font-medium text-slate-700">
                {registerSourceLabel(ref?.objectType)}
              </strong>
              <span className="block text-[9px] text-slate-400">
                {ref?.objectId.slice(0, 8)} · v{ref?.version}
              </span>
            </div>
          );
        },
      },
      {
        id: "record",
        header: "기록",
        className: "min-w-60 max-w-80",
        cell: (row) => (
          <div className="space-y-1 whitespace-normal">
            <strong className="block text-[11px] font-semibold text-slate-800">
              {registerRowTitle(row)}
            </strong>
            <span className="block text-[9px] text-slate-400">
              {row.data.locationId || "위치 미지정"}
              {row.data.discipline ? ` · ${row.data.discipline}` : ""}
            </span>
          </div>
        ),
      },
      {
        id: "status",
        header: "원본 상태",
        className: "min-w-28",
        cell: (row) => (
          <StatusBadge status={row.data.status}>
            {states[row.data.status || ""] || row.data.status || "상태 없음"}
          </StatusBadge>
        ),
      },
      ...definition.calculatedFields.map(
        (field): RegisterColumn<RegisterProjectionRow> => ({
          id: field,
          header: registerFieldLabel(field),
          className: "min-w-28",
          cell: (row) => (
            <span
              className={
                row.unavailableFields.includes(field)
                  ? "text-slate-400"
                  : "text-slate-700"
              }
            >
              {formatRegisterValue(row.calculated[field], field)}
            </span>
          ),
        }),
      ),
      {
        id: "detail",
        header: "상세",
        className: "w-20 text-right",
        cell: (row) => (
          <DetailDrawer
            title={registerRowTitle(row)}
            description={`${definition.id} ${definition.name} · 읽기 전용 Projection`}
            trigger={
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 gap-1 text-[10px]"
              >
                <Eye aria-hidden="true" className="size-3.5" />
                보기
              </Button>
            }
          >
            <RegisterDetail row={row} definition={definition} />
          </DetailDrawer>
        ),
      },
    ],
    [definition],
  );

  return (
    <RegisterTemplate
      header={
        <SectionHeader
          title="29개 표준 관리대장"
          meta={`${definition.id} · ${definition.name}`}
        />
      }
      notice={
        <div className="mb-4 grid gap-3 rounded-lg border border-border bg-slate-50 p-3 text-[10px] leading-5 text-slate-500 md:grid-cols-[1fr_auto] md:items-center">
          <span>
            관리대장은 업무 원본을 재작성하지 않는 읽기 전용 Projection입니다.
            원본 상태는 업무 화면의 권한·명령·Gate를 통해 변경됩니다.
          </span>
          <span className="font-medium text-slate-700">
            {workspace.project.name} · {definition.mode === "actionable" ? "업무 연결형" : "조회형"}
          </span>
        </div>
      }
    >
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="min-w-64 flex-1 md:max-w-md">
          <span className="mb-1.5 block text-[10px] font-medium text-slate-500">
            관리대장 선택
          </span>
          <Select value={registerId} onValueChange={changeRegister}>
            <SelectTrigger
              aria-label="관리대장 선택"
              className="h-10 w-full bg-white text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="start">
              <SelectGroup>
                {registerProjectionCatalog.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.id} · {item.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </label>

        <div className="min-w-0 text-[10px] leading-5 text-slate-400">
          원본 {definition.sources.length}종 · 계산필드{" "}
          {definition.calculatedFields.length}개
        </div>
      </div>

      <FilterBar
        query={query}
        onQueryChange={setQuery}
        queryPlaceholder="제목, 상태, 위치, ID 검색"
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1 text-[10px]"
            disabled={loading}
            onClick={() => void load()}
          >
            <RefreshCw aria-hidden="true" className="size-3.5" />
            새로고침
          </Button>
        }
      >
        <Select value={sourceFilter} onValueChange={setSourceFilter}>
          <SelectTrigger
            aria-label="원본 유형 필터"
            size="sm"
            className="min-w-36 bg-white text-[10px]"
          >
            <SelectValue placeholder="원본 유형" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">원본 전체</SelectItem>
            {sourceOptions.map((option) => (
              <SelectItem key={option} value={option}>
                {sourceTypeOptionLabel(option, definition)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger
            aria-label="상태 필터"
            size="sm"
            className="min-w-32 bg-white text-[10px]"
          >
            <SelectValue placeholder="상태" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">상태 전체</SelectItem>
            {statusOptions.map((status) => (
              <SelectItem key={status} value={status}>
                {states[status] || status}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterBar>

      {error ? (
        <EmptyState
          compact
          title="관리대장을 불러오지 못했습니다."
          description={error}
          action={
            <Button type="button" variant="outline" onClick={() => void load()}>
              다시 시도
            </Button>
          }
        />
      ) : (
        <>
          <div className="mt-3 flex items-center justify-between text-[10px] text-slate-400">
            <span>
              {loading
                ? "조회 중…"
                : `전체 ${rows.length}건 · 표시 ${filteredRows.length}건`}
            </span>
            <span>원본 상태 직접 수정 없음</span>
          </div>
          <RegisterTable
            rows={filteredRows}
            columns={columns}
            rowKey={(row) =>
              `${row.sourceDomainRefs[0]?.objectType}:${row.sourceDomainRefs[0]?.objectId}:${row.sourceDomainRefs[0]?.version}`
            }
            emptyMessage={
              loading ? "관리대장을 조회하고 있습니다." : "조건에 맞는 기록이 없습니다."
            }
          />
        </>
      )}
    </RegisterTemplate>
  );
}
