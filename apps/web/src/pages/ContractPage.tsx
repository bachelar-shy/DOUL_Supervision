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
import i18n from "../i18n/config";
import { formatDateTime, formatNumber } from "../i18n/format";

const contractMachines = [
  "contract_notice",
  "claim",
  "eot_request",
] as const;

type ContractMachine = (typeof contractMachines)[number];

const contractTabs: ReadonlyArray<{
  id: ContractMachine;
  labelKey: string;
  descriptionKey: string;
}> = [
  {
    id: "contract_notice",
    labelKey: "contract.tab.notice.label",
    descriptionKey: "contract.tab.notice.description",
  },
  {
    id: "claim",
    labelKey: "contract.tab.claim.label",
    descriptionKey: "contract.tab.claim.description",
  },
  {
    id: "eot_request",
    labelKey: "contract.tab.eot.label",
    descriptionKey: "contract.tab.eot.description",
  },
];

function tr(key: string, values: Record<string, string | number> = {}) {
  return i18n.t(key, values);
}

function tabLabel(machine: ContractMachine) {
  const tab = contractTabs.find((item) => item.id === machine);
  return tab ? tr(tab.labelKey) : machine;
}

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
  if (typeof ref.objectId !== "string") return tr("contract.value.none");
  return `${String(ref.objectType || "Object")} · ${ref.objectId.slice(0, 8)} · v${String(ref.version || "?")}`;
}

function formatDate(value: unknown) {
  if (typeof value !== "string" || !value) return tr("contract.value.none");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return formatDateTime(date);
}

function numberText(value: unknown, suffix = "") {
  return typeof value === "number" && Number.isFinite(value)
    ? `${formatNumber(value)}${suffix}`
    : tr("contract.value.none");
}

function NoticeBoundary({ record }: { record: RecordDTO }) {
  const data = objectValue(record.data);
  return (
    <StatusBoundaryGroup
      title={tr("contract.notice.boundary.title")}
      description={tr("contract.notice.boundary.description")}
      items={[
        {
          id: "notice-state",
          label: tr("contract.notice.state.label"),
          value:
            states[record.status || ""] ||
            record.status ||
            tr("contract.value.undetermined"),
          detail: tr("contract.notice.state.detail"),
        },
        {
          id: "notice-due",
          label: tr("contract.notice.due.label"),
          value: formatDate(data.noticeDueAt),
          detail:
            data.dueCalculationConfirmed === true
              ? tr("contract.notice.due.confirmed")
              : tr("contract.notice.due.pending"),
          tone:
            data.dueCalculationConfirmed === true ? "neutral" : "warning",
        },
        {
          id: "time-bar-risk",
          label: tr("contract.notice.risk.label"),
          value:
            data.timeBarRisk === true
              ? tr("contract.notice.risk.active")
              : tr("contract.notice.risk.inactive"),
          detail:
            data.timeBarRisk === true
              ? tr("contract.notice.risk.activeDetail")
              : tr("contract.notice.risk.inactiveDetail"),
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
      title={tr("contract.claim.boundary.title")}
      description={tr("contract.claim.boundary.description")}
      items={[
        {
          id: "claimed",
          label: tr("contract.claim.claimed.label"),
          value: numberText(
            data.amountClaimed,
            typeof data.currency === "string" ? ` ${data.currency}` : "",
          ),
          detail: tr("contract.claim.claimed.detail"),
        },
        {
          id: "assessed",
          label: tr("contract.claim.assessed.label"),
          value: numberText(
            data.amountAssessed,
            typeof data.currency === "string" ? ` ${data.currency}` : "",
          ),
          detail: tr("contract.claim.assessed.detail"),
          tone: "warning",
        },
        {
          id: "approved",
          label: tr("contract.claim.approved.label"),
          value: numberText(
            data.amountApproved,
            typeof data.currency === "string" ? ` ${data.currency}` : "",
          ),
          detail: data.decisionOutcome
            ? tr("contract.claim.decision", {
                outcome: String(data.decisionOutcome),
              })
            : tr("contract.claim.decisionPending"),
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
        title={tr("contract.eot.boundary.title")}
        description={tr("contract.eot.boundary.description")}
        items={[
          {
            id: "claimed-days",
            label: tr("contract.eot.claimed.label"),
            value: numberText(
              data.daysClaimed,
              tr("contract.unit.daySuffix"),
            ),
            detail: tr("contract.eot.claimed.detail"),
          },
          {
            id: "assessed-days",
            label: tr("contract.eot.assessed.label"),
            value: numberText(
              data.daysAssessed,
              tr("contract.unit.daySuffix"),
            ),
            detail: tr("contract.eot.assessed.detail"),
            tone: "warning",
          },
          {
            id: "approved-days",
            label: tr("contract.eot.approved.label"),
            value: numberText(
              data.daysApproved,
              tr("contract.unit.daySuffix"),
            ),
            detail: data.revisedCompletionDate
              ? tr("contract.eot.completionDate", {
                  date: formatDate(data.revisedCompletionDate),
                })
              : tr("contract.claim.decisionPending"),
            tone:
              typeof data.daysApproved === "number" ? "positive" : "neutral",
          },
        ]}
      />
      <Panel className="mt-3">
        <SectionHeader
          title={tr("contract.eot.baselineLink.title")}
          meta={
            record.status === "closed"
              ? tr("contract.eot.baselineLink.complete")
              : tr("contract.eot.baselineLink.separate")
          }
        />
        <div className="meta-grid">
          <div>
            <small>{tr("contract.eot.baselineLink.basis")}</small>
            <b>{refText(data.baselineRevisionBasisRef)}</b>
          </div>
          <div>
            <small>{tr("contract.eot.baselineLink.newBaseline")}</small>
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
      [
        tr("contract.details.noticeNo"),
        String(data.noticeNo || tr("contract.value.none")),
      ],
      [tr("contract.details.event"), refText(data.eventRef)],
      [tr("contract.details.eventAt"), formatDate(data.eventAt)],
      [tr("contract.details.awareAt"), formatDate(data.awareAt)],
      [
        tr("contract.details.subject"),
        String(data.subject || tr("contract.value.none")),
      ],
    );
  } else if (item.machine === "claim") {
    rows.push(
      [
        tr("contract.details.claimNo"),
        String(data.claimNo || tr("contract.value.none")),
      ],
      [
        tr("contract.details.type"),
        String(data.claimType || tr("contract.value.none")),
      ],
      [
        tr("contract.details.relief"),
        String(data.reliefRequested || tr("contract.value.none")),
      ],
      [
        tr("contract.details.entitlement"),
        String(data.entitlementBasis || tr("contract.value.none")),
      ],
      [
        tr("contract.details.decision"),
        String(data.decisionOutcome || tr("contract.value.decisionPending")),
      ],
    );
  } else {
    rows.push(
      [
        tr("contract.details.eotNo"),
        String(data.eotNo || tr("contract.value.none")),
      ],
      [tr("contract.details.baseline"), refText(data.baselineScheduleRef)],
      [
        tr("contract.details.assessedCompletion"),
        formatDate(data.assessedCompletionDate),
      ],
      [
        tr("contract.details.revisedCompletion"),
        formatDate(data.revisedCompletionDate),
      ],
      [
        tr("contract.details.decision"),
        String(data.decisionOutcome || tr("contract.value.decisionPending")),
      ],
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
  const tabName = tabLabel(machine);
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
      if (!number.trim()) throw new Error(`${tabName} 번호를 입력하십시오.`);

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
        aria-label={`${tabName} 기록 추가`}
      >
        <div className="section-heading">
          <h2>{tabName} 기록 추가</h2>
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
            {tabName} 번호 *
            <input
              aria-label={`${tabName} 번호 *`}
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
  const tab = contractTabs.find((item) => item.id === activeMachine)!;
  const tabName = tabLabel(activeMachine);
  const tabDescription = tr(tab.descriptionKey);
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
                {tr(item.labelKey)}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="px-4 py-2.5 text-[10px] text-slate-500">
            {tabDescription}
          </div>
        </Tabs>

        <WorkbenchTemplate hasDetail={Boolean(selectedItem)}>
          <Panel className="list-pane">
            <SectionHeader title={tabName} meta={`${items.length}건`} />
            <div className="schedule-list-actions">
              <ActionButton
                disabled={!online || client.kind === "mock"}
                onClick={() => setCreating(true)}
              >
                {tabName} 기록 추가
              </ActionButton>
            </div>
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
                <h2>{tabName} 상세</h2>
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
                    <span className="eyebrow">{tabName}</span>
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

        {creating ? (
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
