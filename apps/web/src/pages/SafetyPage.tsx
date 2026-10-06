import { useState } from "react";

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
import { RecordList } from "./shared";

const safetyMachines = [
  "safety_permit",
  "safety_stop_order",
  "safety_equipment_inspection",
] as const;

type SafetyMachine = (typeof safetyMachines)[number];

const safetyTabs: ReadonlyArray<{
  id: SafetyMachine;
  label: string;
  description: string;
}> = [
  {
    id: "safety_permit",
    label: "작업허가",
    description: "허가 상태와 실제 작업 허용 상태를 분리해 확인합니다.",
  },
  {
    id: "safety_stop_order",
    label: "작업중지",
    description: "중지 발행부터 재개 검증·해제까지 별도 절차로 추적합니다.",
  },
  {
    id: "safety_equipment_inspection",
    label: "장비 안전검사",
    description: "검사 판정과 현재 장비 사용 가능 상태를 구분합니다.",
  },
];

const resumeGateLabels: Record<string, string> = {
  causeIdentified: "원인 확인",
  correctiveActionComplete: "시정조치 완료",
  correctiveEvidencePresent: "시정 증빙 확보",
  issueActionsVerified: "연결 조치 검증",
  reinspectionPassed: "재검증 적합",
  permitValid: "작업허가 유효",
  methodStatementCurrent: "작업계획서 최신",
  riskAssessmentCurrent: "위험성평가 최신",
  equipmentReady: "장비 준비",
  personnelQualified: "작업자 자격",
  controlMeasuresReady: "안전조치 준비",
  environmentalConditionsReady: "환경조건 적합",
  reportingObligationsSatisfied: "보고 의무 충족",
};

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
  if (typeof value !== "string" || !value) return "기록 없음";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("ko-KR", {
        dateStyle: "medium",
        timeStyle: "short",
      });
}

function booleanLabel(value: unknown, positive: string, negative: string) {
  return value === true ? positive : negative;
}

function detailRows(record: RecordDTO) {
  const data = objectValue(record.data);
  const rows: Array<[string, string]> = [
    ["상태", states[record.status || ""] || record.status || "원본 보존"],
    ["원본 버전", `v${record.version}`],
  ];

  if (typeof data.permitNo === "string") rows.push(["Permit No.", data.permitNo]);
  if (typeof data.workType === "string") rows.push(["작업 유형", data.workType]);
  if (typeof data.riskLevel === "string") rows.push(["위험도", data.riskLevel]);
  if (typeof data.stopOrderNo === "string")
    rows.push(["Stop No.", data.stopOrderNo]);
  if (typeof data.stopReason === "string")
    rows.push(["중지 사유", data.stopReason]);
  if (typeof data.inspectionKind === "string")
    rows.push(["검사 유형", data.inspectionKind]);
  if (typeof data.resultSummary === "string")
    rows.push(["검사 결과", data.resultSummary]);
  return rows;
}

function PermitBoundary({ record }: { record: RecordDTO }) {
  const data = objectValue(record.data);
  const stopRefs = arrayValue(data.stopOrderRefs);
  return (
    <StatusBoundaryGroup
      title="허가 · 작업 허용 상태 경계"
      description="Permit 승인과 실제 작업 허용은 같은 상태가 아닙니다. 서버가 계산한 workAuthorized를 별도로 확인합니다."
      items={[
        {
          id: "permit-state",
          label: "Permit 상태",
          value: states[record.status || ""] || record.status || "미정",
          detail: "현재 SafetyPermit 공식 상태",
        },
        {
          id: "work-authorized",
          label: "Work Authorized",
          value: booleanLabel(data.workAuthorized, "작업 허용", "작업 미허용"),
          detail: "작업 허용 Gate의 서버 계산 결과",
          tone: data.workAuthorized === true ? "positive" : "warning",
        },
        {
          id: "stop-link",
          label: "연결 Stop",
          value: `${stopRefs.length}건`,
          detail: stopRefs.length
            ? "연결된 Stop 상태를 확인해야 합니다."
            : "연결된 Stop 참조 없음",
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
        title="중지 · 재개 상태 경계"
        description="시정 완료나 Issue 종결만으로 Stop이 해제되지 않습니다. Stop Lift와 Permit 재개도 서로 다른 승인 단계입니다."
        items={[
          {
            id: "stop-state",
            label: "Stop 상태",
            value: states[record.status || ""] || record.status || "미정",
            detail: "현재 SafetyStopOrder 공식 상태",
            tone: ["lifted", "closed", "cancelled", "superseded"].includes(
              record.status || "",
            )
              ? "positive"
              : "critical",
          },
          {
            id: "resume-request",
            label: "재개 요청",
            value: data.resumeRequestAt ? "요청됨" : "미요청",
            detail: formattedDate(data.resumeRequestAt),
            tone: data.resumeRequestAt ? "warning" : "neutral",
          },
          {
            id: "stop-lift",
            label: "Stop Lift",
            value: data.liftedAt ? "해제됨" : "중지 유지",
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
        <SectionHeader title="재개 Gate" meta="서버 계산" />
        <p className="muted">
          현재 단계에서 서버가 생성한 재개 Gate snapshot이 없습니다.
        </p>
      </Panel>
    );
  }
  return (
    <section
      className="mt-3 rounded-sm border border-border bg-white p-3"
      data-ui-component="safety-resume-gate"
    >
      <div className="mb-3">
        <h3 className="text-[11px] font-semibold text-slate-700">재개 Gate</h3>
        <p className="mt-1 text-[9px] leading-4 text-slate-500">
          아래 값은 UI 계산값이 아니라 서버가 현재 원본을 다시 검증해 저장한
          resumeGate입니다.
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
              {resumeGateLabels[key] || key}
            </span>
            <strong className="mt-1 block text-[11px] text-slate-700">
              {value === true ? "충족" : "미충족"}
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
      title="검사 · 장비 사용 상태 경계"
      description="검사 결과가 적합이어도 인증서·교정 유효기간을 포함한 현재 조건이 충족되어야 equipmentAvailable=true가 됩니다."
      items={[
        {
          id: "inspection-state",
          label: "검사 상태",
          value: states[record.status || ""] || record.status || "미정",
          detail: "현재 SafetyEquipmentInspection 공식 상태",
        },
        {
          id: "equipment-available",
          label: "Equipment Available",
          value: booleanLabel(
            data.equipmentAvailable,
            "사용 가능",
            "사용 불가",
          ),
          detail: "현재 인증·교정 조건을 반영한 서버 계산값",
          tone: data.equipmentAvailable === true ? "positive" : "warning",
        },
        {
          id: "valid-to",
          label: "유효기한",
          value: formattedDate(data.validTo),
          detail: "현재 검사/인증 자료의 유효기간 확인",
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
  workspace: Workspace;
  selected: string | null;
  current: WorkItem | null;
  online: boolean;
  onSelect: (id: string | null) => void;
  onOpenCommand: (item: WorkItem, action: CommandDescriptor) => void;
}

export function SafetyPage({
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
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="px-4 py-2.5 text-[10px] text-slate-500">
            {tab.description}
          </div>
        </Tabs>

        <WorkbenchTemplate hasDetail={Boolean(selectedItem)}>
          <Panel className="list-pane">
            <SectionHeader title={tab.label} meta={`${items.length}건`} />
            <RecordList
              items={items}
              selected={selected}
              onSelect={(item) => onSelect(item.record.id)}
            />
          </Panel>

          <DetailPane>
            {!selectedItem ? (
              <div className="empty compact">
                <h2>{tab.label} 상세</h2>
                <p>
                  목록에서 원본을 선택하면 상태 경계, 서버 Gate와 허용 명령을
                  확인할 수 있습니다.
                </p>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  className="mobile-back"
                  onClick={() => onSelect(null)}
                >
                  ← 목록
                </button>
                <div className="detail-head">
                  <div>
                    <span className="eyebrow">{tab.label}</span>
                    <h2>{recordTitle(selectedItem.record)}</h2>
                    <p>
                      원본 v{selectedItem.record.version} · UI에서 상태를 직접
                      변경하지 않습니다.
                    </p>
                  </div>
                  <StatusBadge status={selectedItem.record.status}>
                    {states[selectedItem.record.status || ""] ||
                      selectedItem.record.status ||
                      "원본 보존"}
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
                    <strong>현재 차단 사유</strong>
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
                    title="가능한 업무 명령"
                    meta="서버 Action Descriptor"
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
                      현재 역할과 상태에서 서버가 허용한 명령이 없습니다.
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
