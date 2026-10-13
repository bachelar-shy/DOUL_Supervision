import { recordVersionLabel } from "../labels";
import { RecordDetails } from "./RecordDetails";
import { useMemo, useState } from "react";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import type { SupervisionClient } from "../data/supervision-client";
import { ApiError } from "../data/supervision-client";
import type {
  CommandDescriptor,
  CreationCapability,
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
import { formatCurrency, formatDateTime } from "../i18n/format";

const contractMachines = [
  "contract_notice",
  "claim",
  "eot_request",
] as const;

type ContractMachine = (typeof contractMachines)[number];

class ContractInputError extends Error {}

function creationCapability(workspace: Workspace, machine: string) {
  return workspace.context.creationCapabilities?.[machine];
}

function creationUnavailableReason(
  capability: CreationCapability | undefined,
  online: boolean,
  mock: boolean,
) {
  if (!online) return i18n.t('creation.offline');
  if (mock) return i18n.t('creation.mock');
  if (!capability) return i18n.t('creation.missing');
  if (capability.status === "unauthorized")
    return i18n.t('creation.unauthorized');
  if (capability.status === "prerequisites_missing")
    return i18n.t('creation.prerequisites');
  if (capability.status === "unavailable")
    return i18n.t('creation.unavailable');
  return i18n.t('creation.unknown');
}

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
  return `${String(ref.objectType || "Object")} · ${ref.objectId.slice(0, 8)} · ${recordVersionLabel(String(ref.version || "?"))}`;
}

function formatDate(value: unknown) {
  if (typeof value !== "string" || !value) return tr("contract.value.none");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return formatDateTime(date);
}

function numberText(value: unknown, currency?: string) {
  return typeof value === "number" && Number.isFinite(value)
    ? formatCurrency(value, currency)
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
            typeof data.currency === "string" ? data.currency : undefined,
          ),
          detail: tr("contract.claim.claimed.detail"),
        },
        {
          id: "assessed",
          label: tr("contract.claim.assessed.label"),
          value: numberText(
            data.amountAssessed,
            typeof data.currency === "string" ? data.currency : undefined,
          ),
          detail: tr("contract.claim.assessed.detail"),
          tone: "warning",
        },
        {
          id: "approved",
          label: tr("contract.claim.approved.label"),
          value: numberText(
            data.amountApproved,
            typeof data.currency === "string" ? data.currency : undefined,
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
      if (!online) throw new ContractInputError(tr("contract.error.offline"));
      if (client.kind === "mock")
        throw new ContractInputError(tr("contract.error.mockCreate"));
      if (!title.trim()) throw new ContractInputError(tr("contract.error.titleRequired"));
      if (!number.trim()) throw new ContractInputError(tr("contract.error.numberRequired", { tab: tabName }));

      let data: Record<string, unknown>;
      if (machine === "contract_notice") {
        const event = eventItems.find((item) => item.record.id === eventId);
        const senderPartyId = client.session?.actor.partyId;
        if (!event) throw new ContractInputError(tr("contract.error.eventRequired"));
        if (!senderPartyId) throw new ContractInputError(tr("contract.error.senderRequired"));
        if (!recipientPartyId) throw new ContractInputError(tr("contract.error.recipientRequired"));
        if (!subject.trim()) throw new ContractInputError(tr("contract.error.subjectRequired"));
        if (Number.isNaN(Date.parse(eventAt)) || Number.isNaN(Date.parse(awareAt)))
          throw new ContractInputError(tr("contract.error.dateRequired"));

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
          ? reasonLabel(e.detail.code)
          : e instanceof ContractInputError
            ? e.message
            : reasonLabel(),
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
        aria-label={tr("contract.create.dialogAria", { tab: tabName })}
      >
        <div className="section-heading">
          <h2>{tr("contract.create.title", { tab: tabName })}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label={tr("contract.create.closeAria")}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <p className="muted">
          {tr("contract.create.description")}
        </p>
        {client.kind === "mock" ? (
          <div role="status" className="notice">
            {tr("contract.create.mockPreviewNotice")}
          </div>
        ) : null}
        <div className="modal-fields">
          <label>
            {tr("contract.create.titleField")}
            <input
              aria-label={tr("contract.create.titleField")}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label>
            {tr("contract.create.numberField", { tab: tabName })}
            <input
              aria-label={tr("contract.create.numberField", { tab: tabName })}
              value={number}
              onChange={(event) => setNumber(event.target.value)}
            />
          </label>
          {machine === "contract_notice" ? (
            <>
              <label>
                {tr("contract.create.eventField")}
                <select
                  aria-label={tr("contract.create.eventField")}
                  value={eventId}
                  onChange={(event) => setEventId(event.target.value)}
                >
                  <option value="">{tr("contract.create.eventSelect")}</option>
                  {eventItems.map((item) => (
                    <option key={item.record.id} value={item.record.id}>
                      {machineLabels[item.machine] || item.machine} ·{" "}
                      {recordTitle(item.record)} · {recordVersionLabel(item.record.version)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {tr("contract.create.recipientField")}
                <select
                  aria-label={tr("contract.create.recipientField")}
                  value={recipientPartyId}
                  onChange={(event) => setRecipientPartyId(event.target.value)}
                >
                  <option value="">{tr("contract.create.recipientSelect")}</option>
                  {recipients.map((party) => (
                    <option key={party.partyId} value={party.partyId}>
                      {party.name} · {party.actorGroup}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {tr("contract.create.subjectField")}
                <input
                  aria-label={tr("contract.create.subjectField")}
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                />
              </label>
              <label>
                {tr("contract.create.eventAtField")}
                <input
                  aria-label={tr("contract.create.eventAtField")}
                  value={eventAt}
                  onChange={(event) => setEventAt(event.target.value)}
                />
              </label>
              <label>
                {tr("contract.create.awareAtField")}
                <input
                  aria-label={tr("contract.create.awareAtField")}
                  value={awareAt}
                  onChange={(event) => setAwareAt(event.target.value)}
                />
              </label>
              <div className="notice">
                {tr("contract.create.noticeHelp")}
              </div>
            </>
          ) : (
            <div className="notice">
              {tr("contract.create.draftHelp")}
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
            {tr("contract.create.cancel")}
          </button>
          <button
            className="primary"
            disabled={busy || !online || client.kind === "mock"}
            onClick={() => void submit()}
          >
            {busy ? tr("contract.create.validating") : tr("contract.create.submit")}
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
          <Panel className="list-pane" aria-label={tabName}>
            <p className="mb-2 text-xs text-muted-foreground" data-ui-component="list-record-count">{tr("contract.page.count", { count: items.length })}</p>
            <div className="schedule-list-actions">
              <ActionButton
                disabled={!online || client.kind === "mock" || !canCreate}
                onClick={() => setCreating(true)}
              >
                {tr("contract.page.createAction", { tab: tabName })}
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
              {tr("contract.page.serverAuthorityNotice")}
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
                <h2>{tr("contract.page.detailTitle", { tab: tabName })}</h2>
                <p>
                  {tr("contract.page.emptyDescription")}
                </p>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  className="mobile-back"
                  onClick={() => onSelect(null)}
                >
                  {tr("contract.page.back")}
                </button>
                <div className="detail-head">
                  <div>
                    <span className="eyebrow">{tabName}</span>
                    <h2>{recordTitle(selectedItem.record)}</h2>
                    <p>
                      {tr("contract.page.originalVersion", { version: selectedItem.record.version })}
                    </p>
                  </div>
                  <StatusBadge status={selectedItem.record.status}>
                    {states[selectedItem.record.status || ""] ||
                      selectedItem.record.status ||
                      tr("contract.value.sourcePreserved")}
                  </StatusBadge>
                </div>

                <ContractDetails item={selectedItem} />
                <div className="mt-3">
                  <ContractBoundary item={selectedItem} />
                </div>

                <div className="detail-section">
                  <SectionHeader
                    title={tr("contract.page.actionsTitle")}
                    meta={tr("contract.page.actionsMeta")}
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
                      {tr("contract.page.noActions")}
                    </div>
                  )}
                </div>

                <details className="technical">
                  <summary>{tr("contract.page.technicalSummary")}</summary>
                  <RecordDetails value={selectedItem.record} />
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
