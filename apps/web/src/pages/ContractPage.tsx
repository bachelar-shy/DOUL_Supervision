import { useMemo, useState } from "react";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import type { SupervisionClient } from "../data/supervision-client";
import { ApiError } from "../data/supervision-client";
import type {
  CommandDescriptor,
  RecordDTO,
  WorkItem,
  Workspace,
} from "../data/ui-contract";
import { describeCommandAvailability } from "../data/ui-presentation";
import { commands, reasonLabel, states } from "../labels";
import { ActionButton, Panel, SectionHeader, StatusBadge } from "../ui";
import {
  ActionGate,
  DetailPane,
  StatusBoundaryGroup,
} from "../ui/catalog";
import { WorkbenchTemplate } from "../ui/templates";
import { machineLabels } from "../app/routes";
import { PageBoundary } from "./PageBoundary";
import { recordRef, recordTitle } from "./record-utils";
import { RecordList } from "./shared";

const contractMachines = [
  "contract_notice",
  "claim",
  "eot_request",
] as const;

type ContractMachine = (typeof contractMachines)[number];

type CreationCapability = {
  machine: string;
  authority: string | null;
  status: "available" | "unauthorized" | "prerequisites_missing" | "unavailable";
  canCreate: boolean;
  reasons: string[];
};

function creationCapability(workspace: Workspace, machine: string) {
  const context = workspace.context as Workspace["context"] & {
    creationCapabilities?: Record<string, CreationCapability>;
  };
  return context.creationCapabilities?.[machine];
}

function creationUnavailableReason(
  capability: CreationCapability | undefined,
  online: boolean,
  mock: boolean,
) {
  if (!online) return "연결이 복구되어야 서버 생성 기능을 확인할 수 있습니다.";
  if (mock) return "UI Mock Preview에서는 공식 기록을 생성하지 않습니다.";
  if (!capability) return "서버 생성 권한 정보를 불러올 수 없습니다.";
  if (capability.status === "unauthorized")
    return "현재 역할에는 이 기록의 생성 권한이 없습니다.";
  if (capability.status === "prerequisites_missing")
    return "프로젝트 범위 또는 자격 선행조건을 확인해야 합니다.";
  if (capability.status === "unavailable")
    return "현재 연결에서 생성 기능을 사용할 수 없습니다.";
  return "서버가 생성 권한을 확인하지 못했습니다.";
}

const contractTabs: ReadonlyArray<{
  id: ContractMachine;
  label: string;
  description: string;
}> = [
  {
    id: "contract_notice",
    label: "계약통지",
    description:
      "통지기한과 권리보전 기록을 추적합니다. 기한 초과 위험 표시는 권리상실 판정이 아닙니다.",
  },
  {
    id: "claim",
    label: "클레임",
    description:
      "원 청구액, 감리 검토액, 발주처 승인액과 분쟁 잔액을 서로 다른 값으로 보존합니다.",
  },
  {
    id: "eot_request",
    label: "공기연장(EOT)",
    description:
      "지연사건·계약통지·기준공정·영향분석을 연결하고 발주처 결정과 기준공정 개정을 분리합니다.",
  },
];

function isContractMachine(value: string): value is ContractMachine {
  return contractMachines.includes(value as ContractMachine);
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function refText(value: unknown) {
  const ref = objectValue(value);
  if (typeof ref.objectId !== "string") return "기록 없음";
  return `${String(ref.objectType || "Object")} · ${ref.objectId.slice(0, 8)} · v${String(ref.version || "?")}`;
}

function formatDate(value: unknown) {
  if (typeof value !== "string" || !value) return "기록 없음";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function numberText(value: unknown, suffix = "") {
  return typeof value === "number" && Number.isFinite(value)
    ? `${value.toLocaleString("ko-KR")}${suffix}`
    : "기록 없음";
}

function NoticeBoundary({ record }: { record: RecordDTO }) {
  const data = objectValue(record.data);
  return (
    <StatusBoundaryGroup
      title="계약통지 · 통지기한 상태 경계"
      description="통지기한 초과는 서버의 timeBarRisk 병렬 표시입니다. UI가 권리상실이나 계약효과를 판정하지 않습니다."
      items={[
        {
          id: "notice-state",
          label: "계약통지 상태",
          value: states[record.status || ""] || record.status || "미정",
          detail: "현재 ContractNotice 공식 상태",
        },
        {
          id: "notice-due",
          label: "공식 통지기한",
          value: formatDate(data.noticeDueAt),
          detail:
            data.dueCalculationConfirmed === true
              ? "인간 권한으로 확인된 기한"
              : "공식 기한 확인 전",
          tone:
            data.dueCalculationConfirmed === true ? "neutral" : "warning",
        },
        {
          id: "time-bar-risk",
          label: "기한초과 위험",
          value: data.timeBarRisk === true ? "위험 표시" : "위험 미표시",
          detail:
            data.timeBarRisk === true
              ? "위험 신호일 뿐 자동 권리상실 판정이 아님"
              : "현재 서버 원본 기준",
          tone: data.timeBarRisk === true ? "critical" : "neutral",
        },
      ]}
    />
  );
}

function ClaimBoundary({ record }: { record: RecordDTO }) {
  const data = objectValue(record.data);
  return (
    <StatusBoundaryGroup
      title="청구 · 검토 · 발주처 계약결정 경계"
      description="감리의 기술·금액 검토는 발주처의 계약상 승인과 다릅니다. 원 청구액은 부분승인 이후에도 보존됩니다."
      items={[
        {
          id: "claimed",
          label: "원 청구액",
          value: numberText(
            data.amountClaimed,
            typeof data.currency === "string" ? ` ${data.currency}` : "",
          ),
          detail: "시공사 원 청구값",
        },
        {
          id: "assessed",
          label: "감리 검토액",
          value: numberText(
            data.amountAssessed,
            typeof data.currency === "string" ? ` ${data.currency}` : "",
          ),
          detail: "기술·금액 검토 결과",
          tone: "warning",
        },
        {
          id: "approved",
          label: "발주처 승인액",
          value: numberText(
            data.amountApproved,
            typeof data.currency === "string" ? ` ${data.currency}` : "",
          ),
          detail: data.decisionOutcome
            ? `계약결정: ${String(data.decisionOutcome)}`
            : "발주처 계약결정 전",
          tone:
            typeof data.amountApproved === "number" ? "positive" : "neutral",
        },
      ]}
    />
  );
}

function EotBoundary({ record }: { record: RecordDTO }) {
  const data = objectValue(record.data);
  return (
    <>
      <StatusBoundaryGroup
        title="공기연장 · 기준공정 개정 상태 경계"
        description="공기연장 승인 자체는 기존 기준공정을 변경하지 않습니다. 승인 EOT exact version을 근거로 새 기준공정이 별도 승인·적용되어야 합니다."
        items={[
          {
            id: "claimed-days",
            label: "청구 일수",
            value: numberText(data.daysClaimed, "일"),
            detail: "시공사 EOT 요청",
          },
          {
            id: "assessed-days",
            label: "감리 검토 일수",
            value: numberText(data.daysAssessed, "일"),
            detail: "공기영향 기술검토",
            tone: "warning",
          },
          {
            id: "approved-days",
            label: "발주처 승인 일수",
            value: numberText(data.daysApproved, "일"),
            detail: data.revisedCompletionDate
              ? `계약완료일 ${formatDate(data.revisedCompletionDate)}`
              : "발주처 계약결정 전",
            tone:
              typeof data.daysApproved === "number" ? "positive" : "neutral",
          },
        ]}
      />
      <Panel className="mt-3">
        <SectionHeader
          title="기준공정 개정 연결"
          meta={record.status === "closed" ? "연결 완료" : "별도 절차"}
        />
        <div className="meta-grid">
          <div>
            <small>승인 EOT exact version</small>
            <b>{refText(data.baselineRevisionBasisRef)}</b>
          </div>
          <div>
            <small>새 기준공정</small>
            <b>{refText(data.baselineRevisionRef)}</b>
          </div>
        </div>
      </Panel>
    </>
  );
}

function ContractBoundary({ item }: { item: WorkItem }) {
  if (item.machine === "contract_notice")
    return <NoticeBoundary record={item.record} />;
  if (item.machine === "claim") return <ClaimBoundary record={item.record} />;
  return <EotBoundary record={item.record} />;
}

function ContractDetails({ item }: { item: WorkItem }) {
  const data = objectValue(item.record.data);
  const rows: Array<[string, string]> = [];

  if (item.machine === "contract_notice") {
    rows.push(
      ["계약통지 번호", String(data.noticeNo || "기록 없음")],
      ["계약사건", refText(data.eventRef)],
      ["사건 발생", formatDate(data.eventAt)],
      ["인지 시각", formatDate(data.awareAt)],
      ["통지 제목", String(data.subject || "기록 없음")],
    );
  } else if (item.machine === "claim") {
    rows.push(
      ["클레임 번호", String(data.claimNo || "기록 없음")],
      ["유형", String(data.claimType || "기록 없음")],
      ["요구 구제", String(data.reliefRequested || "기록 없음")],
      ["계약상 근거", String(data.entitlementBasis || "기록 없음")],
      ["결정 결과", String(data.decisionOutcome || "결정 전")],
    );
  } else {
    rows.push(
      ["공기연장 번호", String(data.eotNo || "기록 없음")],
      ["기준공정", refText(data.baselineScheduleRef)],
      ["검토 완료예정일", formatDate(data.assessedCompletionDate)],
      ["변경 계약완료일", formatDate(data.revisedCompletionDate)],
      ["결정 결과", String(data.decisionOutcome || "결정 전")],
    );
  }

  return (
    <div className="meta-grid">
      {rows.map(([label, value]) => (
        <div key={label}>
          <small>{label}</small>
          <b>{value}</b>
        </div>
      ))}
    </div>
  );
}

function CreateContractRecord({
  machine,
  client,
  workspace,
  online,
  onClose,
  onCreated,
}: {
  machine: ContractMachine;
  client: SupervisionClient;
  workspace: Workspace;
  online: boolean;
  onClose: () => void;
  onCreated: (id: string) => Promise<void>;
}) {
  const tab = contractTabs.find((item) => item.id === machine)!;
  const [title, setTitle] = useState("");
  const [number, setNumber] = useState("");
  const [eventId, setEventId] = useState("");
  const [recipientPartyId, setRecipientPartyId] = useState("");
  const [subject, setSubject] = useState("");
  const [eventAt, setEventAt] = useState(() => new Date().toISOString());
  const [awareAt, setAwareAt] = useState(() => new Date().toISOString());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const eventItems = useMemo(
    () =>
      workspace.items.filter(
        (item) =>
          recordRef(item).objectType === "WorkItem" &&
          !isContractMachine(item.machine),
      ),
    [workspace.items],
  );
  const recipients = useMemo(() => {
    const sender = client.session?.actor.partyId;
    return workspace.participants.filter((party) => party.partyId !== sender);
  }, [client.session, workspace.participants]);

  async function submit() {
    setBusy(true);
    setErr("");
    try {
      if (!online) throw new Error("연결 복구 후 다시 제출하십시오.");
      if (client.kind === "mock")
        throw new Error("UI Mock Preview에서는 공식 기록을 생성하지 않습니다.");
      if (!title.trim()) throw new Error("제목을 입력하십시오.");
      if (!number.trim()) throw new Error(`${tab.label} 번호를 입력하십시오.`);

      let data: Record<string, unknown>;
      if (machine === "contract_notice") {
        const event = eventItems.find((item) => item.record.id === eventId);
        const senderPartyId = client.session?.actor.partyId;
        if (!event) throw new Error("계약사건 원본을 선택하십시오.");
        if (!senderPartyId) throw new Error("현재 로그인 사용자를 확인할 수 없습니다.");
        if (!recipientPartyId) throw new Error("수신자를 선택하십시오.");
        if (!subject.trim()) throw new Error("통지 제목을 입력하십시오.");
        if (Number.isNaN(Date.parse(eventAt)) || Number.isNaN(Date.parse(awareAt)))
          throw new Error("사건 발생·인지 시각은 시간대가 포함된 날짜여야 합니다.");

        data = {
          noticeNo: number.trim(),
          eventRef: recordRef(event),
          clauseRef: workspace.context.requirementRef,
          contractRuleRef: workspace.context.requirementRef,
          eventAt,
          awareAt,
          senderPartyId,
          recipientPartyId,
          subject: subject.trim(),
        };
      } else if (machine === "claim") {
        data = { claimNo: number.trim() };
      } else {
        data = { eotNo: number.trim() };
      }

      const result = await client.create(machine, {
        ...workspace.context.scope,
        title: title.trim(),
        data,
      });
      await onCreated(result.record.id);
    } catch (e) {
      setErr(
        e instanceof ApiError
          ? `${reasonLabel(e.detail.code)} ${e.message}`
          : e instanceof Error
            ? e.message
            : String(e),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${tab.label} 기록 추가`}
      >
        <div className="section-heading">
          <h2>{tab.label} 기록 추가</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="대화상자 닫기"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <p className="muted">
          생성 권한과 범위는 제출 시 서버가 다시 검증합니다. UI가 계약 권한을
          확정하지 않습니다.
        </p>
        <div className="modal-fields">
          <label>
            제목 *
            <input
              aria-label="제목 *"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label>
            {tab.label} 번호 *
            <input
              aria-label={`${tab.label} 번호 *`}
              value={number}
              onChange={(event) => setNumber(event.target.value)}
            />
          </label>
          {machine === "contract_notice" ? (
            <>
              <label>
                계약사건 원본 *
                <select
                  aria-label="계약사건 원본 *"
                  value={eventId}
                  onChange={(event) => setEventId(event.target.value)}
                >
                  <option value="">원본 선택</option>
                  {eventItems.map((item) => (
                    <option key={item.record.id} value={item.record.id}>
                      {machineLabels[item.machine] || item.machine} ·{" "}
                      {recordTitle(item.record)} · v{item.record.version}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                수신자 *
                <select
                  aria-label="수신자 *"
                  value={recipientPartyId}
                  onChange={(event) => setRecipientPartyId(event.target.value)}
                >
                  <option value="">수신자 선택</option>
                  {recipients.map((party) => (
                    <option key={party.partyId} value={party.partyId}>
                      {party.name} · {party.actorGroup}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                통지 제목 *
                <input
                  aria-label="통지 제목 *"
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                />
              </label>
              <label>
                사건 발생 시각 *
                <input
                  aria-label="사건 발생 시각 *"
                  value={eventAt}
                  onChange={(event) => setEventAt(event.target.value)}
                />
              </label>
              <label>
                인지 시각 *
                <input
                  aria-label="인지 시각 *"
                  value={awareAt}
                  onChange={(event) => setAwareAt(event.target.value)}
                />
              </label>
              <div className="notice">
                계약조항·통지기한 규정은 현재 프로젝트의 versioned Contract
                Requirement를 exact reference로 연결합니다.
              </div>
            </>
          ) : (
            <div className="notice">
              초안에는 식별번호만 등록합니다. 제출 단계의 계약통지·지연사건·
              기준공정·영향분석 등은 서버가 제공한 command fields에서 연결하고
              다시 검증합니다.
            </div>
          )}
        </div>
        {err ? (
          <div role="alert" className="error-box">
            {err}
          </div>
        ) : null}
        <div className="modal-actions">
          <button className="secondary" onClick={onClose} disabled={busy}>
            취소
          </button>
          <button
            className="primary"
            disabled={busy || !online || client.kind === "mock"}
            onClick={() => void submit()}
          >
            {busy ? "서버 검증 중…" : "기록 추가"}
          </button>
        </div>
      </section>
    </div>
  );
}

export function ContractPage({
  client,
  workspace,
  selected,
  current,
  online,
  onSelect,
  onOpenCommand,
  refresh,
}: {
  client: SupervisionClient;
  workspace: Workspace;
  selected: string | null;
  current: WorkItem | null;
  online: boolean;
  onSelect: (id: string | null) => void;
  onOpenCommand: (item: WorkItem, action: CommandDescriptor) => void;
  refresh: () => Promise<void>;
}) {
  const [machine, setMachine] = useState<ContractMachine>(
    current && isContractMachine(current.machine)
      ? current.machine
      : "contract_notice",
  );
  const [creating, setCreating] = useState(false);

  const activeMachine =
    current && isContractMachine(current.machine) ? current.machine : machine;
  const createCapability = creationCapability(workspace, activeMachine);
  const canCreate =
    online &&
    client.kind !== "mock" &&
    createCapability?.status === "available" &&
    createCapability.canCreate === true;
  const tab = contractTabs.find((item) => item.id === activeMachine)!;
  const items = workspace.items.filter((item) => item.machine === activeMachine);
  const selectedItem =
    current && current.machine === activeMachine ? current : null;

  return (
    <PageBoundary name="contract">
      <section data-ui-component="contract-workspace">
        <Tabs
          value={activeMachine}
          onValueChange={(value) => {
            setMachine(value as ContractMachine);
            onSelect(null);
          }}
          className="mb-4 gap-0 overflow-hidden rounded-sm border border-border bg-white"
        >
          <TabsList
            variant="line"
            className="h-auto w-full flex-wrap justify-start gap-5 border-b border-border bg-background px-4 py-1"
          >
            {contractTabs.map((item) => (
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
            <div className="schedule-list-actions">
              <ActionButton
                disabled={!online || client.kind === "mock" || !canCreate}
                onClick={() => setCreating(true)}
              >
                {tab.label} 기록 추가
              </ActionButton>
            </div>
            {!canCreate ? (
              <p role="status" className="muted" data-testid="creation-capability-reason">
                {creationUnavailableReason(
                  createCapability,
                  online,
                  client.kind === "mock",
                )}
              </p>
            ) : null}
            <p className="muted">
              생성·전이 권한은 버튼 표시와 관계없이 서버가 현재 역할·범위·원본
              버전으로 재검증합니다.
            </p>
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
                  목록에서 원본을 선택하면 계약 상태 경계, exact reference와 현재
                  역할에 대해 서버가 반환한 업무 명령을 확인할 수 있습니다.
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
                      원본 v{selectedItem.record.version} · UI에서 상태나 계약효과를
                      직접 변경하지 않습니다.
                    </p>
                  </div>
                  <StatusBadge status={selectedItem.record.status}>
                    {states[selectedItem.record.status || ""] ||
                      selectedItem.record.status ||
                      "원본 보존"}
                  </StatusBadge>
                </div>

                <ContractDetails item={selectedItem} />
                <div className="mt-3">
                  <ContractBoundary item={selectedItem} />
                </div>

                <div className="detail-section">
                  <SectionHeader
                    title="가능한 업무 명령"
                    meta="서버 권한 · 선행조건"
                  />
                  {selectedItem.actions.length ? (
                    <ActionGate
                      actions={selectedItem.actions.map((action) => {
                        const presentation = describeCommandAvailability(
                          action.requiresEvidence && !action.ready
                            ? { ...action, requiresInput: true }
                            : action,
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
                          onAction: () =>
                            onOpenCommand(selectedItem, action),
                        };
                      })}
                    />
                  ) : (
                    <div className="empty compact">
                      현재 역할과 상태에서 가능한 명령이 없습니다.
                    </div>
                  )}
                </div>

                <details className="technical">
                  <summary>연결 원본 · exact version 확인</summary>
                  <pre>{JSON.stringify(selectedItem.record, null, 2)}</pre>
                </details>
              </>
            )}
          </DetailPane>
        </WorkbenchTemplate>

        {creating && canCreate ? (
          <CreateContractRecord
            machine={activeMachine}
            client={client}
            workspace={workspace}
            online={online}
            onClose={() => setCreating(false)}
            onCreated={async (id) => {
              setCreating(false);
              await refresh();
              onSelect(id);
            }}
          />
        ) : null}
      </section>
    </PageBoundary>
  );
}
