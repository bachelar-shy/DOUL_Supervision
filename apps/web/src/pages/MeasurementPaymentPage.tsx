import { useMemo, useRef, useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CommandDescriptor, WorkItem, Workspace } from "../data/ui-contract";
import type { SupervisionClient } from "../data/supervision-client";
import { ApiError } from "../data/supervision-client";
import {
  paymentFallbackLabels,
  paymentIdentity,
  paymentItems,
  paymentRecordData,
  paymentText,
  type PaymentCreateCapability,
  type PaymentLabelKey,
  type PaymentMachine,
} from "../data/payment-workspace";
import { describeCommandAvailability } from "../data/ui-presentation";
import { commands, reasonLabel, states } from "../labels";
import { ActionButton, Panel, SectionHeader, StatusBadge } from "../ui";
import { ActionGate, DetailPane } from "../ui/catalog";
import { WorkbenchTemplate } from "../ui/templates";
import { PageBoundary } from "./PageBoundary";
import { recordTitle } from "./record-utils";
import "./measurement-payment.css";

const tabs: Array<{ id: PaymentMachine; key: PaymentLabelKey }> = [
  { id: "contract_boq", key: "boq" },
  { id: "quantity_measurement", key: "measurements" },
  { id: "payment_claim", key: "claims" },
];

type CreateKind = PaymentMachine;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function dateText(value: unknown) {
  if (typeof value !== "string" || !value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleDateString();
}

function amount(value: unknown, currency: unknown) {
  const raw = paymentText(value, "—");
  return raw === "—" ? raw : `${raw}${currency ? ` ${paymentText(currency)}` : ""}`;
}

function PaymentSummary({ item, t }: { item: WorkItem; t: (key: PaymentLabelKey) => string }) {
  const data = paymentRecordData(item);
  const currency = data.currency;
  const entries: Array<[PaymentLabelKey, unknown]> = item.machine === "payment_claim"
    ? [
        ["amountClaimed", data.claimedGrossAmount], ["amountVerified", data.verifiedGrossAmount],
        ["amountRecommended", data.recommendedNetAmount], ["amountApproved", data.ownerApprovedAmount],
        ["amountPaid", data.paidAmount], ["disputed", data.disputedAmount],
      ]
    : item.machine === "quantity_measurement"
      ? [["claimed", data.claimedQuantity], ["verified", data.verifiedQuantity], ["blocked", data.blockedQuantity], ["disputed", data.disputedQuantity]]
      : [["lineItems", Array.isArray(data.lineItems) ? data.lineItems.length : undefined], ["currency", currency], ["revision", data.revision]];

  return <div className="payment-summary" aria-label={t("title")}>
    {entries.map(([key, value]) => <div key={key}>
      <span>{t(key)}</span>
      <strong>{key === "currency" || key === "lineItems" || key === "revision"
        ? paymentText(value)
        : amount(value, item.machine === "quantity_measurement" ? data.unit : currency)}</strong>
    </div>)}
  </div>;
}

function PaymentDetail({ item, t }: { item: WorkItem; t: (key: PaymentLabelKey) => string }) {
  const data = paymentRecordData(item);
  const currency = data.currency;
  const isClaim = item.machine === "payment_claim";
  const isMeasurement = item.machine === "quantity_measurement";
  const amountFields: Array<[PaymentLabelKey, unknown]> = isClaim
    ? [["amountClaimed", data.claimedGrossAmount], ["amountVerified", data.verifiedGrossAmount],
      ["amountRecommended", data.recommendedNetAmount], ["amountApproved", data.ownerApprovedAmount],
      ["amountPaid", data.paidAmount], ["cumulativePaid", data.cumulativePaidAmount],
      ["eligibleVariation", data.eligibleVariationAmount], ["retention", data.retentionAmount],
      ["advanceRecovery", data.advanceRecoveryAmount], ["otherDeduction", data.otherDeductionAmount],
      ["disputed", data.disputedAmount]]
    : isMeasurement
      ? [["claimed", data.claimedQuantity], ["verified", data.verifiedQuantity], ["blocked", data.blockedQuantity], ["disputed", data.disputedQuantity]]
      : [];
  const blockedReasons = Array.isArray(data.blockedReasons) ? data.blockedReasons : [];
  const lineItems = Array.isArray(data.lineItems) ? data.lineItems : [];
  const records = Array.isArray(data.paymentRecords) ? data.paymentRecords : [];
  const recommendation = object(data.recommendationSnapshot);
  const calculationTrace = object(recommendation.calculationTrace ?? data.calculationTrace);
  const decisionValues = [data.ownerDecisionRef, data.decisionRefs, data.approvalRef, data.adjustmentReason, data.ownerDecidedAt];

  return <>
    <PaymentSummary item={item} t={t} />
    <section className="payment-detail-section" aria-label={t("period")}>
      <SectionHeader title={t("period")} />
      <dl className="payment-meta-grid">
        <div><dt>{t("number")}</dt><dd>{paymentIdentity(item)}</dd></div>
        <div><dt>{t("period")}</dt><dd>{dateText(data.periodStart)} – {dateText(data.periodEnd)}</dd></div>
        <div><dt>{t("boqVersion")}</dt><dd>{paymentText(data.boqRef ?? data.contractRef)}</dd></div>
        {isMeasurement && <>
          <div><dt>{t("quantity")}</dt><dd>{paymentText(data.claimedQuantity)} {paymentText(data.unit)}</dd></div>
          <div><dt>{t("verified")}</dt><dd>{paymentText(data.verifiedQuantity)} {paymentText(data.unit)}</dd></div>
          <div><dt>{t("blockedReasons")}</dt><dd>{blockedReasons.length ? blockedReasons.map((value) => paymentText(value)).join(" · ") : "—"}</dd></div>
        </>}
        {item.machine === "contract_boq" && <>
          <div><dt>{t("currency")}</dt><dd>{paymentText(data.currency)}</dd></div>
          <div><dt>{t("revision")}</dt><dd>{paymentText(data.revision)}</dd></div>
          <div><dt>{t("effectiveFrom")}</dt><dd>{dateText(data.effectiveFrom)}</dd></div>
        </>}
        {amountFields.map(([key, value]) => <div key={key}><dt>{t(key)}</dt><dd>{amount(value, isMeasurement ? data.unit : currency)}</dd></div>)}
      </dl>
    </section>

    {isClaim && <section className="payment-detail-section" aria-label={t("lineItems")}>
      <SectionHeader title={t("lineItems")} meta={`${lineItems.length}`} />
      {lineItems.length ? <div className="payment-table-wrap"><table className="payment-table">
        <thead><tr><th>{t("boq")}</th><th>{t("quantity")}</th><th>{t("verified")}</th><th>{t("blockedReasons")}</th><th>{t("amountClaimed")}</th><th>{t("amountVerified")}</th></tr></thead>
        <tbody>{lineItems.map((value, index) => {
          const line = object(value);
          return <tr key={paymentText(line.lineItemId ?? line.boqItemRef, String(index))}>
            <td>{paymentText(line.itemNo ?? line.boqItemRef)}<small>{paymentText(line.description)}</small></td>
            <td>{paymentText(line.claimedQuantity)} {paymentText(line.unit)}</td>
            <td>{paymentText(line.verifiedQuantity)} {paymentText(line.unit)}</td>
            <td>{Array.isArray(line.blockedReasons) ? line.blockedReasons.map((x) => paymentText(x)).join(" · ") : "—"}</td>
            <td>{amount(line.claimedAmount, currency)}</td><td>{amount(line.verifiedAmount, currency)}</td>
          </tr>;
        })}</tbody>
      </table></div> : <p className="muted">—</p>}
    </section>}

    {item.machine === "contract_boq" && <section className="payment-detail-section" aria-label={t("lineItems")}>
      <SectionHeader title={t("lineItems")} meta={`${lineItems.length}`} />
      {lineItems.length ? <div className="payment-table-wrap"><table className="payment-table">
        <thead><tr><th>{t("boq")}</th><th>{t("tableDescription")}</th><th>{t("quantity")}</th><th>{t("unit")}</th><th>{t("rate")}</th><th>{t("contractAmount")}</th></tr></thead>
        <tbody>{lineItems.map((value, index) => { const line = object(value); return <tr key={paymentText(line.boqItemId, String(index))}>
          <td>{paymentText(line.itemNo)}</td><td>{paymentText(line.description)}</td>
          <td>{paymentText(line.contractQuantity)}</td><td>{paymentText(line.unit)}</td>
          <td>{paymentText(line.unitRate)}</td><td>{amount(line.contractAmount, currency)}</td>
        </tr>; })}</tbody>
      </table></div> : <p className="muted">—</p>}
    </section>}

    {isClaim && <section className="payment-detail-section" aria-label={t("paymentRecords")}>
      <SectionHeader title={t("paymentRecords")} meta={`${records.length}`} />
      <p className="muted">{t("partialPaymentNote")} {t("correctionNote")}</p>
      {records.length ? <ol className="payment-history">
        {records.map((value, index) => { const record = object(value); const kind = record.kind === "payment" ? t("recordPayment") : record.kind === "correction" ? t("recordCorrection") : record.kind === "cancellation" ? t("recordCancellation") : paymentText(record.kind); return <li key={paymentText(record.recordId, String(index))}>
          <div className="payment-history-head"><strong>{kind}</strong><span>{amount(record.amount, record.currency ?? currency)}</span></div>
          <dl><div><dt>{t("recordedAt")}</dt><dd>{dateText(record.paidAt ?? record.recordedAt)}</dd></div>
            <div><dt>{t("paymentReference")}</dt><dd>{paymentText(record.paymentReference ?? record.externalSystemRef)}</dd></div>
            <div><dt>{t("reference")}</dt><dd>{paymentText(record.recordId)}</dd></div>
            <div><dt>{t("paymentEvidence")}</dt><dd>{paymentText(record.evidenceIds)}</dd></div>
            {Boolean(record.supersedesPaymentRecordId) && <div><dt>{t("correctionNote")}</dt><dd>{paymentText(record.supersedesPaymentRecordId)} · {paymentText(record.reason)}</dd></div>}
          </dl>
        </li>; })}
      </ol> : <p className="empty compact">—</p>}
    </section>}
    {isClaim && Object.keys(recommendation).length > 0 && <section className="payment-detail-section" aria-label={t("recommendedSnapshot")}>
      <SectionHeader title={t("recommendedSnapshot")} />
      <dl className="payment-meta-grid">
        <div><dt>{t("amountRecommended")}</dt><dd>{amount(recommendation.recommendedNetAmount ?? data.recommendedNetAmount, currency)}</dd></div>
        <div><dt>{t("boqVersion")}</dt><dd>{paymentText(recommendation.boqRef ?? data.boqRef)}</dd></div>
        <div><dt>{t("quantity")}</dt><dd>{paymentText(recommendation.measurementRefs ?? data.quantityMeasurementRefs)}</dd></div>
        <div><dt>{t("reference")}</dt><dd>{paymentText(recommendation.claimBasisRef ?? recommendation.paymentClaimRef)}</dd></div>
        <div><dt>{t("formula")}</dt><dd>{paymentText(calculationTrace.formulaId)}</dd></div>
        <div><dt>{t("rounding")}</dt><dd>{paymentText(calculationTrace.roundingRule ?? calculationTrace.rounding)}</dd></div>
        <div><dt>{t("reservation")}</dt><dd>{paymentText(recommendation.reservationComment ?? data.reservationComment)}</dd></div>
      </dl>
    </section>}
    {isClaim && decisionValues.some((value) => value !== undefined && value !== null && value !== "") && <section className="payment-detail-section" aria-label={t("ownerDecision")}>
      <SectionHeader title={t("ownerDecision")} />
      <dl className="payment-meta-grid">
        <div><dt>{t("amountApproved")}</dt><dd>{amount(data.ownerApprovedAmount, currency)}</dd></div>
        <div><dt>{t("decisionReference")}</dt><dd>{paymentText(data.ownerDecisionRef ?? data.decisionRefs ?? data.approvalRef)}</dd></div>
        <div><dt>{t("decisionReason")}</dt><dd>{paymentText(data.adjustmentReason ?? data.decisionReason)}</dd></div>
        <div><dt>{t("recordedAt")}</dt><dd>{dateText(data.ownerDecidedAt ?? data.decidedAt)}</dd></div>
      </dl>
    </section>}
    {blockedReasons.length > 0 && <section className="payment-detail-section" aria-label={t("blockedReasons")}>
      <SectionHeader title={t("blockedReasons")} />
      <ul className="payment-reasons">{blockedReasons.map((reason, index) => <li key={`${paymentText(reason)}-${index}`}>{paymentText(reason)}</li>)}</ul>
    </section>}
  </>;
}

function CreateDraft({
  kind, client, workspace, online, onCreated, onClose, t,
}: {
  kind: CreateKind; client: SupervisionClient; workspace: Workspace; online: boolean;
  onCreated: (id: string) => Promise<void>; onClose: () => void; t: (key: PaymentLabelKey) => string;
}) {
  const [title, setTitle] = useState("");
  const [number, setNumber] = useState("");
  const [revision, setRevision] = useState("1");
  const [currency, setCurrency] = useState("VND");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const identity = useRef({ id: crypto.randomUUID(), key: crypto.randomUUID() });
  const kindLabel = t(kind === "contract_boq" ? "boq" : kind === "quantity_measurement" ? "measurements" : "claims");

  async function save() {
    setError("");
    setBusy(true);
    try {
      if (!online) throw new Error(t("offlineSave"));
      if (client.kind === "mock") throw new Error(t("mockSave"));
      if (!title.trim() || !number.trim()) throw new Error(t("requiredFields"));
      const scope = { ...workspace.context.scope };
      const common = { ...scope, subtype: kind === "contract_boq" ? "ContractBOQ" : kind === "quantity_measurement" ? "QuantityMeasurement" : "PaymentClaim", title: title.trim() };
      const payload = kind === "contract_boq"
        ? { ...common, boq: { boqNo: number.trim(), revision, currency, lineItems: [] } }
        : kind === "quantity_measurement"
          ? { ...common, data: { measurementNo: number.trim(), ...(periodStart ? { periodStart } : {}), ...(periodEnd ? { periodEnd } : {}) } }
          : { ...common, data: { paymentClaimNo: number.trim(), currency, ...(periodStart ? { periodStart } : {}), ...(periodEnd ? { periodEnd } : {}), paymentRecords: [] } };
      const result = await client.create(kind, payload, identity.current.id, identity.current.key);
      identity.current = { id: crypto.randomUUID(), key: crypto.randomUUID() };
      await onCreated(result.record.id);
    } catch (e) {
      setError(e instanceof ApiError ? `${reasonLabel(e.detail.code)} ${e.message}` : e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  return <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label={`${kindLabel} ${t("create")}`}>
    <div className="section-heading"><h2>{kindLabel} {t("create")}</h2><button aria-label={t("closeDialog")} onClick={onClose} disabled={busy}>×</button></div>
    <div className="modal-fields">
      <label>{t("titleField")} *<input value={title} onChange={(event) => setTitle(event.target.value)} disabled={busy} /></label>
      <label>{t("number")} *<input value={number} onChange={(event) => setNumber(event.target.value)} disabled={busy} /></label>
      {kind === "contract_boq" && <><label>{t("revision")}<input value={revision} onChange={(event) => setRevision(event.target.value)} disabled={busy} /></label><label>{t("currency")}<input value={currency} onChange={(event) => setCurrency(event.target.value)} disabled={busy} /></label></>}
      {kind !== "contract_boq" && <><label>{t("period")} · {t("periodStart")}<input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} disabled={busy} /></label><label>{t("period")} · {t("periodEnd")}<input type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} disabled={busy} /></label></>}
      {kind === "payment_claim" && <label>{t("currency")}<input value={currency} onChange={(event) => setCurrency(event.target.value)} disabled={busy} /></label>}
    </div>
    {error && <div role="alert" className="error-box">{error}</div>}
    <p className="muted">{t("draftBoundary")}</p>
    <div className="modal-actions"><button className="secondary" onClick={onClose} disabled={busy}>{t("cancel")}</button>
      <button className="primary" onClick={() => void save()} disabled={busy || !online || client.kind === "mock"}>{busy ? t("saving") : t("saveDraft")}</button>
    </div>
  </section></div>;
}

export function MeasurementPaymentPage({
  client, workspace, selected, current, online, onSelect, onOpenCommand, refresh,
  createCapabilities, labels,
}: {
  client: SupervisionClient; workspace: Workspace; selected: string | null; current: WorkItem | null;
  online: boolean; onSelect: (id: string | null) => void;
  onOpenCommand: (item: WorkItem, action: CommandDescriptor) => void; refresh: () => Promise<void>;
  createCapabilities?: Partial<Record<PaymentMachine, PaymentCreateCapability>>;
  labels?: Partial<Record<PaymentLabelKey, string>>;
}) {
  const t = (key: PaymentLabelKey) => labels?.[key] || paymentFallbackLabels[key] || key;
  const [machine, setMachine] = useState<PaymentMachine>(current?.machine === "contract_boq" || current?.machine === "quantity_measurement" || current?.machine === "payment_claim" ? current.machine : "contract_boq");
  const [creating, setCreating] = useState<CreateKind | null>(null);
  const [loadError, setLoadError] = useState("");
  const items = useMemo(() => paymentItems(workspace.items, machine), [workspace.items, machine]);
  const selectedItem = current?.machine === machine ? current : null;
  const createCapability = createCapabilities?.[machine];
  const canCreate = createCapability?.canCreate === true;

  async function createAndRefresh(id: string) {
    setCreating(null);
    await refresh();
    onSelect(id);
  }

  return <PageBoundary name="measurement-payment">
    <section data-ui-component="measurement-payment-workspace">
      <Tabs value={machine} onValueChange={(value) => { setMachine(value as PaymentMachine); onSelect(null); }} className="payment-tabs">
        <TabsList variant="line" className="payment-tabs-list">
          {tabs.map((tab) => <TabsTrigger key={tab.id} value={tab.id}>{t(tab.key)}</TabsTrigger>)}
        </TabsList>
        <div className="payment-intro">{t("description")}</div>
      </Tabs>
      <WorkbenchTemplate hasDetail={Boolean(selectedItem)}>
        <Panel className="list-pane">
          <SectionHeader title={t(tabs.find((tab) => tab.id === machine)!.key)} meta={`${items.length}`} />
          <div className="payment-create-actions">
            <ActionButton disabled={!online || client.kind === "mock" || !canCreate} onClick={() => setCreating(machine)}>{t("create")}</ActionButton>
          </div>
          {!canCreate && <p className="payment-capability-note" role="note">
            {createCapability?.reasons?.length ? createCapability.reasons.join(" · ") : t("createUnavailable")}
          </p>}
          <p className="muted">화면은 원본 값과 서버가 제공한 명령을 표시합니다. 단계 사이의 수량·금액은 서로 합치거나 다시 계산하지 않습니다.</p>
          {loadError && <div role="alert" className="error-box">{loadError}<button onClick={() => void refresh().catch((e) => setLoadError(String(e)))}>{t("retry")}</button></div>}
          <div className="payment-record-list">
            {items.length ? items.map((item) => {
              const data = paymentRecordData(item);
              return <button type="button" className={`payment-record-row${selected === item.record.id ? " selected" : ""}`} key={item.record.id} onClick={() => onSelect(item.record.id)}>
                <span className="payment-record-main"><strong>{recordTitle(item.record)}</strong><small>{paymentIdentity(item)} · v{item.record.version}</small></span>
                <span className="payment-record-amount">{amount(machine === "payment_claim" ? data.claimedGrossAmount : machine === "quantity_measurement" ? data.claimedQuantity : data.contractAmount, machine === "quantity_measurement" ? data.unit : data.currency)}</span>
                <StatusBadge status={item.record.status}>{states[item.record.status || ""] || item.record.status || "—"}</StatusBadge>
              </button>;
            }) : <div className="empty compact">{t("empty")}</div>}
          </div>
        </Panel>
        <DetailPane>
          {!selectedItem ? <div className="empty compact"><h2>{t(tabs.find((tab) => tab.id === machine)!.key)}</h2><p>{t("selectToInspect")}</p></div>
            : <>
              <button type="button" className="mobile-back" onClick={() => onSelect(null)}>← {t("backToList")}</button>
              <div className="detail-head"><div><span className="eyebrow">{t(tabs.find((tab) => tab.id === machine)!.key)}</span><h2>{recordTitle(selectedItem.record)}</h2><p>{t("sourceVersion")} v{selectedItem.record.version}</p></div>
                <StatusBadge status={selectedItem.record.status}>{states[selectedItem.record.status || ""] || selectedItem.record.status || "—"}</StatusBadge>
              </div>
              <PaymentDetail item={selectedItem} t={t} />
              <section className="payment-detail-section"><SectionHeader title={t("commands")} />
                {selectedItem.actions.length ? <div className="payment-commands">{selectedItem.actions.map((action) => {
                  const availability = describeCommandAvailability(action, online);
                  const label = commands[action.command] || action.command.replace(/_/g, " ");
                  return <ActionGate key={action.command} actions={[{
                    id: action.command, label, availability: availability.availability,
                    availabilityLabel: availability.label,
                    reason: availability.reason || (action.blockedReason ? reasonLabel(action.blockedReason.code) : undefined),
                    disabled: availability.disabled || client.kind === "mock",
                    onAction: () => onOpenCommand(selectedItem, action),
                  }]} />;
                })}</div> : <p className="muted">{t("noCommands")}</p>}
              </section>
            </>}
        </DetailPane>
      </WorkbenchTemplate>
      {creating && <CreateDraft kind={creating} client={client} workspace={workspace} online={online} onCreated={createAndRefresh} onClose={() => setCreating(null)} t={t} />}
    </section>
  </PageBoundary>;
}
