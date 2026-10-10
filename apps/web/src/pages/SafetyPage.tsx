import { recordVersionLabel } from "../labels";
import { useState } from "react";
import type { SupervisionClient } from "../data/supervision-client";
import { SafetyAuthoringPanel } from "./SafetyAuthoringPanel";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import type {
  CommandDescriptor,
  RecordDTO,
  WorkItem,
  Workspace,
} from "../data/ui-contract";
import { describeCommandAvailability } from "../data/ui-presentation";
import { commands, states } from "../labels";
import { Panel, SectionHeader, StatusBadge } from "../ui";
import {
  ActionGate,
  DetailPane,
  StatusBoundaryGroup,
} from "../ui/catalog";
import { WorkbenchTemplate } from "../ui/templates";
import { PageBoundary } from "./PageBoundary";
import { recordTitle } from "./record-utils";
import { formatDateTime } from "../i18n/format";
import i18n from "../i18n/config";
import { RecordList } from "./shared";

const safetyMachines = [
  "safety_permit",
  "safety_stop_order",
  "safety_equipment_inspection",
] as const;

type SafetyMachine = (typeof safetyMachines)[number];

const safetyTabs: ReadonlyArray<{
  id: SafetyMachine;
  labelKey: string;
  descriptionKey: string;
}> = [
  {
    id: "safety_permit",
    labelKey: "safety.tab.permit.label",
    descriptionKey: "safety.tab.permit.description",
  },
  {
    id: "safety_stop_order",
    labelKey: "safety.tab.stop.label",
    descriptionKey: "safety.tab.stop.description",
  },
  {
    id: "safety_equipment_inspection",
    labelKey: "safety.tab.equipment.label",
    descriptionKey: "safety.tab.equipment.description",
  },
];

function tr(
  key: string,
  values: Record<string, string | number | boolean> = {},
) {
  return i18n.t(key, values);
}

function isSafetyMachine(value: string): value is SafetyMachine {
  return safetyMachines.includes(value as SafetyMachine);
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function formattedDate(value: unknown) {
  if (typeof value !== "string" || !value) return tr("safety.value.recordNone");
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : formatDateTime(date);
}

function booleanLabel(value: unknown, positive: string, negative: string) {
  return value === true ? positive : negative;
}

function detailRows(record: RecordDTO) {
  const data = objectValue(record.data);
  const rows: Array<[string, string]> = [
    [
      tr("safety.detail.status"),
      states[record.status || ""] ||
        record.status ||
        tr("safety.value.originalPreserved"),
    ],
    [tr("safety.detail.sourceVersion"), recordVersionLabel(record.version)],
  ];

  if (typeof data.permitNo === "string") rows.push([tr("field.permitNo"), data.permitNo]);
  if (typeof data.workType === "string")
    rows.push([tr("safety.detail.workType"), data.workType]);
  if (typeof data.riskLevel === "string")
    rows.push([tr("safety.detail.riskLevel"), data.riskLevel]);
  if (typeof data.stopOrderNo === "string")
    rows.push([tr("field.stopOrderNo"), data.stopOrderNo]);
  if (typeof data.stopReason === "string")
    rows.push([tr("safety.detail.stopReason"), data.stopReason]);
  if (typeof data.inspectionKind === "string")
    rows.push([tr("safety.detail.inspectionKind"), data.inspectionKind]);
  if (typeof data.resultSummary === "string")
    rows.push([tr("safety.detail.resultSummary"), data.resultSummary]);
  return rows;
}

function PermitBoundary({ record }: { record: RecordDTO }) {
  const data = objectValue(record.data);
  const stopRefs = arrayValue(data.stopOrderRefs);
  return (
    <StatusBoundaryGroup
      title={tr("safety.permit.boundary.title")}
      description={tr("safety.permit.boundary.description")}
      items={[
        {
          id: "permit-state",
          label: tr("safety.permit.state.label"),
          value:
            states[record.status || ""] ||
            record.status ||
            tr("safety.value.undetermined"),
          detail: tr("safety.permit.state.detail"),
        },
        {
          id: "work-authorized",
          label: tr("safety.permit.authorization.label"),
          value: booleanLabel(
            data.workAuthorized,
            tr("safety.permit.authorization.allowed"),
            tr("safety.permit.authorization.notAllowed"),
          ),
          detail: tr("safety.permit.authorization.detail"),
          tone: data.workAuthorized === true ? "positive" : "warning",
        },
        {
          id: "stop-link",
          label: tr("safety.permit.stopLink.label"),
          value: tr("common.count", { count: stopRefs.length }),
          detail: stopRefs.length
            ? tr("safety.permit.stopLink.required")
            : tr("safety.permit.stopLink.none"),
          tone: stopRefs.length ? "critical" : "neutral",
        },
      ]}
    />
  );
}

function StopBoundary({ record }: { record: RecordDTO }) {
  const data = objectValue(record.data);
  return (
    <>
      <StatusBoundaryGroup
        title={tr("safety.stop.boundary.title")}
        description={tr("safety.stop.boundary.description")}
        items={[
          {
            id: "stop-state",
            label: tr("safety.stop.state.label"),
            value:
              states[record.status || ""] ||
              record.status ||
              tr("safety.value.undetermined"),
            detail: tr("safety.stop.state.detail"),
            tone: ["lifted", "closed", "cancelled", "superseded"].includes(
              record.status || "",
            )
              ? "positive"
              : "critical",
          },
          {
            id: "resume-request",
            label: tr("safety.stop.resumeRequest.label"),
            value: data.resumeRequestAt
              ? tr("safety.stop.resumeRequest.requested")
              : tr("safety.stop.resumeRequest.notRequested"),
            detail: formattedDate(data.resumeRequestAt),
            tone: data.resumeRequestAt ? "warning" : "neutral",
          },
          {
            id: "stop-lift",
            label: tr("safety.stop.lift.label"),
            value: data.liftedAt
              ? tr("safety.stop.lift.lifted")
              : tr("safety.stop.lift.maintained"),
            detail: formattedDate(data.liftedAt),
            tone: data.liftedAt ? "positive" : "critical",
          },
        ]}
      />
      <ResumeGate data={data} />
    </>
  );
}

function ResumeGate({ data }: { data: Record<string, unknown> }) {
  const gate = objectValue(data.resumeGate);
  const entries = Object.entries(gate);
  if (!entries.length) {
    return (
      <Panel className="mt-3">
        <SectionHeader
          title={tr("safety.resumeGate.title")}
          meta={tr("safety.resumeGate.meta")}
        />
        <p className="muted">{tr("safety.resumeGate.empty")}</p>
      </Panel>
    );
  }
  return (
    <section
      className="mt-3 rounded-sm border border-border bg-white p-3"
      data-ui-component="safety-resume-gate"
    >
      <div className="mb-3">
        <h3 className="text-[11px] font-semibold text-slate-700">
          {tr("safety.resumeGate.title")}
        </h3>
        <p className="mt-1 text-[9px] leading-4 text-slate-500">
          {tr("safety.resumeGate.description")}
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {entries.map(([key, value]) => (
          <div
            key={key}
            className={
              "rounded-sm border p-2.5 " +
              (value === true
                ? "border-doul-success/25 bg-doul-success/5"
                : "border-doul-warning/25 bg-doul-warning/5")
            }
          >
            <span className="block text-[9px] text-slate-500">
              {tr(`safety.resumeGate.${key}`, { defaultValue: key })}
            </span>
            <strong className="mt-1 block text-[11px] text-slate-700">
              {value === true
                ? tr("safety.resumeGate.satisfied")
                : tr("safety.resumeGate.unsatisfied")}
            </strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function EquipmentBoundary({ record }: { record: RecordDTO }) {
  const data = objectValue(record.data);
  return (
    <StatusBoundaryGroup
      title={tr("safety.equipment.boundary.title")}
      description={tr("safety.equipment.boundary.description")}
      items={[
        {
          id: "inspection-state",
          label: tr("safety.equipment.state.label"),
          value:
            states[record.status || ""] ||
            record.status ||
            tr("safety.value.undetermined"),
          detail: tr("safety.equipment.state.detail"),
        },
        {
          id: "equipment-available",
          label: tr("safety.equipment.availability.label"),
          value: booleanLabel(
            data.equipmentAvailable,
            tr("safety.equipment.availability.available"),
            tr("safety.equipment.availability.unavailable"),
          ),
          detail: tr("safety.equipment.availability.detail"),
          tone: data.equipmentAvailable === true ? "positive" : "warning",
        },
        {
          id: "valid-to",
          label: tr("safety.equipment.validTo.label"),
          value: formattedDate(data.validTo),
          detail: tr("safety.equipment.validTo.detail"),
        },
      ]}
    />
  );
}

function Boundary({ item }: { item: WorkItem }) {
  if (item.machine === "safety_permit")
    return <PermitBoundary record={item.record} />;
  if (item.machine === "safety_stop_order")
    return <StopBoundary record={item.record} />;
  return <EquipmentBoundary record={item.record} />;
}

export interface SafetyPageProps {
  client: SupervisionClient;
  onCreated: (record: RecordDTO) => Promise<void>;
  workspace: Workspace;
  selected: string | null;
  current: WorkItem | null;
  online: boolean;
  onSelect: (id: string | null) => void;
  onOpenCommand: (item: WorkItem, action: CommandDescriptor) => void;
}

export function SafetyPage({
  client,
  onCreated,
  workspace,
  selected,
  current,
  online,
  onSelect,
  onOpenCommand,
}: SafetyPageProps) {
  const [machine, setMachine] = useState<SafetyMachine>(
    current && isSafetyMachine(current.machine)
      ? current.machine
      : "safety_permit",
  );

  const activeMachine =
    current && isSafetyMachine(current.machine) ? current.machine : machine;
  const items = workspace.items.filter((item) => item.machine === activeMachine);
  const selectedItem =
    current && current.machine === activeMachine ? current : null;
  const tab = safetyTabs.find((item) => item.id === activeMachine)!;
  const tabName = tr(tab.labelKey);
  const tabDescription = tr(tab.descriptionKey);

  return (
    <PageBoundary name="safety">
      <section data-ui-component="safety-workspace">
        <Tabs
          value={activeMachine}
          onValueChange={(value) => {
            setMachine(value as SafetyMachine);
            onSelect(null);
          }}
          className="mb-4 gap-0 overflow-hidden rounded-sm border border-border bg-white"
        >
          <TabsList
            variant="line"
            className="w-full justify-start gap-5 border-b border-border bg-background px-4 py-1"
          >
            {safetyTabs.map((item) => (
              <TabsTrigger
                key={item.id}
                value={item.id}
                className="min-h-11 flex-none px-1.5 text-xs"
              >
                {tr(item.labelKey)}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="px-4 py-2.5 text-[10px] text-slate-500">
            {tabDescription}
          </div>
        </Tabs>

        <SafetyAuthoringPanel key={`${workspace.project.id}:${workspace.role.id}:${activeMachine}`} client={client} workspace={workspace} machine={activeMachine} online={online} onCreated={onCreated} />

        <WorkbenchTemplate hasDetail={Boolean(selectedItem)}>
          <Panel className="list-pane">
            <SectionHeader
              title={tabName}
              meta={tr("common.count", { count: items.length })}
            />
            <RecordList
              items={items}
              selected={selected}
              onSelect={(item) => onSelect(item.record.id)}
            />
          </Panel>

          <DetailPane>
            {!selectedItem ? (
              <div className="empty compact">
                <h2>{tr("safety.page.detailTitle", { tab: tabName })}</h2>
                <p>{tr("safety.page.emptyDescription")}</p>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  className="mobile-back"
                  onClick={() => onSelect(null)}
                >
                  {tr("safety.page.back")}
                </button>
                <div className="detail-head">
                  <div>
                    <span className="eyebrow">{tabName}</span>
                    <h2>{recordTitle(selectedItem.record)}</h2>
                    <p>
                      {tr("safety.page.sourceVersion", {
                        version: selectedItem.record.version,
                      })}
                    </p>
                  </div>
                  <StatusBadge status={selectedItem.record.status}>
                    {states[selectedItem.record.status || ""] ||
                      selectedItem.record.status ||
                      tr("safety.value.originalPreserved")}
                  </StatusBadge>
                </div>

                <div className="meta-grid">
                  {detailRows(selectedItem.record).map(([label, value]) => (
                    <div key={label}>
                      <span>{label}</span>
                      <strong>{value}</strong>
                    </div>
                  ))}
                </div>

                <Boundary item={selectedItem} />

                {arrayValue(
                  objectValue(selectedItem.record.data).blockedReasons,
                ).length ? (
                  <div className="notice warning mt-3">
                    <strong>{tr("safety.page.blockedReasons")}</strong>
                    <ul className="mt-1 list-disc pl-4">
                      {arrayValue(
                        objectValue(selectedItem.record.data).blockedReasons,
                      ).map((reason, index) => (
                        <li key={index}>{String(reason)}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="detail-section">
                  <SectionHeader
                    title={tr("safety.page.actionsTitle")}
                    meta={tr("safety.page.actionsMeta")}
                  />
                  {selectedItem.actions.length ? (
                    <ActionGate
                      actions={selectedItem.actions.map((action) => {
                        const presentation = describeCommandAvailability(
                          action,
                          online,
                        );
                        return {
                          id: action.command,
                          label: commands[action.command] || action.command,
                          primary: action.ready,
                          disabled: presentation.disabled,
                          availability: presentation.availability,
                          availabilityLabel: presentation.label,
                          reason: presentation.reason,
                          onAction: () => onOpenCommand(selectedItem, action),
                        };
                      })}
                    />
                  ) : (
                    <div className="empty compact">
                      {tr("safety.page.noActions")}
                    </div>
                  )}
                </div>
              </>
            )}
          </DetailPane>
        </WorkbenchTemplate>
      </section>
    </PageBoundary>
  );
}
