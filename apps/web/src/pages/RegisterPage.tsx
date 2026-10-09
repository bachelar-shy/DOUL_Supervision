import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { koreanRegisterRecordFieldLabels } from "@doul/localization";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  registerNavigationGroups,
  roleRegisterEntries,
} from "../app/register-navigation";
import { ApiError, type SupervisionClient } from "../data/supervision-client";
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
import { reasonLabel, states } from "../labels";
import { EmptyState, SectionHeader, StatusBadge } from "../ui";
import {
  DetailDrawer,
  FilterBar,
  RegisterNavigator,
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

function sourceType(row: RegisterProjectionRow) {
  return row.sourceDomainRefs[0]?.objectType || "Unknown";
}

function registerName(
  definition: RegisterProjectionDefinition,
  t: TFunction,
) {
  return t(`register.name.${definition.id}`, {
    defaultValue: definition.name,
  });
}

function sourceTypeOptionLabel(
  objectType: string,
  definition: RegisterProjectionDefinition,
  t: TFunction,
) {
  const source = definition.sources.find((item) => item.objectType === objectType);
  const subtype = source?.subtype
    ? ` / ${t(`register.subtype.${source.subtype}`, {
        defaultValue: source.subtype,
      })}`
    : "";
  return `${registerSourceLabel(objectType)}${subtype}`;
}

function registerModeLabel(
  definition: RegisterProjectionDefinition,
  t: TFunction,
) {
  return definition.mode === "actionable"
    ? t("register.mode.actionable")
    : t("register.mode.readonly");
}

function RegisterDetail({
  row,
  definition,
}: {
  row: RegisterProjectionRow;
  definition: RegisterProjectionDefinition;
}) {
  const { t } = useTranslation();
  const ref = row.sourceDomainRefs[0];
  const detailFields = recordDetailFields.filter(
    (key) => row.data[key] !== undefined && row.data[key] !== null,
  );

  return (
    <div className="space-y-5 py-4 text-sm">
      <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
        {t("register.detail.readonlyNotice")}
      </div>

      <section>
        <h3 className="mb-2 text-xs font-semibold text-foreground">
          {t("register.detail.sourceObject")}
        </h3>
        <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
          <dt className="text-muted-foreground">{t("register.detail.type")}</dt>
          <dd>{registerSourceLabel(ref?.objectType)}</dd>
          <dt className="text-muted-foreground">{t("register.detail.sourceId")}</dt>
          <dd className="break-all font-mono">
            {ref?.objectId || t("common.unknown")}
          </dd>
          <dt className="text-muted-foreground">
            {t("register.detail.sourceVersion")}
          </dt>
          <dd>v{ref?.version ?? "-"}</dd>
          {detailFields.map((key) => (
            <FragmentPair
              key={key}
              label={t(`register.recordField.${key}`, {
                defaultValue: koreanRegisterRecordFieldLabels[key] || key,
              })}
              value={formatRegisterValue(row.data[key], key)}
            />
          ))}
        </dl>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold text-foreground">
          {t("register.detail.calculatedFields")}
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
        <h3 className="mb-2 text-xs font-semibold text-foreground">
          {t("register.detail.linkedSources")}
        </h3>
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
  const { t } = useTranslation();
  const entrySpec = roleRegisterEntries[workspace.role.actorGroup];
  const [registerId, setRegisterId] = useState(entrySpec.defaultRegisterId);
  const [rows, setRows] = useState<RegisterProjectionRow[]>([]);
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestSequence = useRef(0);

  const definition =
    registerProjectionCatalog.find((item) => item.id === registerId) ||
    registerProjectionCatalog[10];

  const navigationItems = useMemo(() => {
    const byId = new Map<string, RegisterProjectionDefinition>(
      registerProjectionCatalog.map((item) => [item.id, item]),
    );
    const toItem = (id: string) => {
      const item = byId.get(id);
      return item
        ? {
            id: item.id,
            name: registerName(item, t),
            modeLabel: registerModeLabel(item, t),
          }
        : null;
    };
    return {
      recommendedItems: entrySpec.recommendedRegisterIds
        .map(toItem)
        .filter((item): item is NonNullable<typeof item> => item !== null),
      groups: registerNavigationGroups.map((group) => ({
        ...group,
        label: t(group.labelKey, { defaultValue: group.label }),
        description: t(group.descriptionKey, {
          defaultValue: group.description,
        }),
        items: group.registerIds
          .map(toItem)
          .filter((item): item is NonNullable<typeof item> => item !== null),
      })),
    };
  }, [entrySpec, t]);

  async function load() {
    const sequence = ++requestSequence.current;
    setLoading(true);
    try {
      const nextRows = await client.request<RegisterProjectionRow[]>(
        client.path(`/registers/${registerId}`),
      );
      if (sequence !== requestSequence.current) return;
      setRows(nextRows);
      setError("");
    } catch (e) {
      if (sequence !== requestSequence.current) return;
      setRows([]);
      setError(
        e instanceof ApiError ? reasonLabel(e.detail.code) : t("register.error.load"),
      );
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }

  useEffect(() => {
    const sequence = ++requestSequence.current;
    client
      .request<RegisterProjectionRow[]>(
        client.path(`/registers/${registerId}`),
      )
      .then((nextRows) => {
        if (sequence !== requestSequence.current) return;
        setRows(nextRows);
        setError("");
      })
      .catch((e) => {
        if (sequence !== requestSequence.current) return;
        setRows([]);
        setError(
          e instanceof ApiError ? reasonLabel(e.detail.code) : t("register.error.load"),
        );
      })
      .finally(() => {
        if (sequence === requestSequence.current) setLoading(false);
      });

    return () => {
      if (sequence === requestSequence.current) {
        requestSequence.current += 1;
      }
    };
  }, [client, registerId, t]);

  function changeRegister(nextRegisterId: string) {
    // Invalidate any in-flight manual refresh before the new selection renders.
    requestSequence.current += 1;
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
        header: t("register.column.source"),
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
        header: t("register.column.record"),
        className: "min-w-60 max-w-80",
        cell: (row) => (
          <div className="space-y-1 whitespace-normal">
            <strong className="block text-[11px] font-semibold text-slate-800">
              {registerRowTitle(row)}
            </strong>
            <span className="block text-[9px] text-slate-400">
              {row.data.locationId || t("register.value.locationUnspecified")}
              {row.data.discipline ? ` · ${row.data.discipline}` : ""}
            </span>
          </div>
        ),
      },
      {
        id: "status",
        header: t("register.column.sourceStatus"),
        className: "min-w-28",
        cell: (row) => (
          <StatusBadge status={row.data.status}>
            {states[row.data.status || ""] ||
              row.data.status ||
              t("register.value.statusNone")}
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
        header: t("register.column.detail"),
        className: "w-20 text-right",
        cell: (row) => (
          <DetailDrawer
            title={registerRowTitle(row)}
            description={`${definition.id} ${registerName(definition, t)} · ${t("register.detail.readonlyProjection")}`}
            trigger={
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 gap-1 text-[10px]"
              >
                <Eye aria-hidden="true" className="size-3.5" />
                {t("register.detail.view")}
              </Button>
            }
          >
            <RegisterDetail row={row} definition={definition} />
          </DetailDrawer>
        ),
      },
    ],
    [definition, t],
  );

  return (
    <RegisterTemplate
      header={
        <SectionHeader
          title={t("register.page.title")}
          meta={`${definition.id} · ${registerName(definition, t)}`}
        />
      }
      notice={
        <div className="mb-4 grid gap-3 rounded-lg border border-border bg-slate-50 p-3 text-[10px] leading-5 text-slate-500 md:grid-cols-[1fr_auto] md:items-center">
          <span>{t("register.page.notice")}</span>
          <span className="font-medium text-slate-700">
            {workspace.project.name} · {registerModeLabel(definition, t)}
          </span>
        </div>
      }
    >
      <RegisterNavigator
        roleLabel={t(entrySpec.labelKey, { defaultValue: entrySpec.label })}
        roleDescription={t(entrySpec.descriptionKey, {
          defaultValue: entrySpec.description,
        })}
        activeId={registerId}
        recommendedItems={navigationItems.recommendedItems}
        groups={navigationItems.groups}
        onSelect={changeRegister}
      />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[10px] leading-5 text-slate-400">
        <span className="font-medium text-slate-600">
          {t("register.page.current", {
            id: definition.id,
            name: registerName(definition, t),
          })}
        </span>
        <span>
          {t("register.page.summary", {
            sourceCount: definition.sources.length,
            fieldCount: definition.calculatedFields.length,
            mode: registerModeLabel(definition, t),
          })}
        </span>
      </div>

      <FilterBar
        query={query}
        onQueryChange={setQuery}
        queryPlaceholder={t("register.search.placeholder")}
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
            {t("register.refresh")}
          </Button>
        }
      >
        <Select value={sourceFilter} onValueChange={setSourceFilter}>
          <SelectTrigger
            aria-label={t("register.filter.sourceAria")}
            size="sm"
            className="min-w-36 bg-white text-[10px]"
          >
            <SelectValue placeholder={t("register.filter.sourcePlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("register.filter.sourceAll")}</SelectItem>
            {sourceOptions.map((option) => (
              <SelectItem key={option} value={option}>
                {sourceTypeOptionLabel(option, definition, t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger
            aria-label={t("register.filter.statusAria")}
            size="sm"
            className="min-w-32 bg-white text-[10px]"
          >
            <SelectValue placeholder={t("register.filter.statusPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("register.filter.statusAll")}</SelectItem>
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
          title={t("register.error.load")}
          description={error}
          action={
            <Button type="button" variant="outline" onClick={() => void load()}>
              {t("register.retry")}
            </Button>
          }
        />
      ) : (
        <>
          <div className="mt-3 flex items-center justify-between text-[10px] text-slate-400">
            <span>
              {loading
                ? t("register.loading.short")
                : t("register.count.summary", {
                    total: rows.length,
                    visible: filteredRows.length,
                  })}
            </span>
            <span>{t("register.noDirectStateEdit")}</span>
          </div>
          <RegisterTable
            rows={filteredRows}
            columns={columns}
            rowKey={(row) =>
              `${row.sourceDomainRefs[0]?.objectType}:${row.sourceDomainRefs[0]?.objectId}:${row.sourceDomainRefs[0]?.version}`
            }
            emptyMessage={
              loading
                ? t("register.loading.long")
                : t("register.empty.filtered")
            }
          />
        </>
      )}
    </RegisterTemplate>
  );
}
