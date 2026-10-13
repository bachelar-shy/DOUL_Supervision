import { recordTypeLabel } from "../labels";
import { recordVersionLabel } from "../labels";
import i18n from "../i18n/config";
import { useMemo, useRef, useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CommandDescriptor, CreationCapability, DomainRef, WorkItem, Workspace } from "../data/ui-contract";
import type { SupervisionClient } from "../data/supervision-client";
import { ApiError } from "../data/supervision-client";
import {
  completionData,
  completionFallbackLabels,
  completionIdentity,
  completionItems,
  completionProfileOptions,
  completionReferenceOptions,
  completionText,
  type CompletionLabelKey,
  type CompletionMachine,
  type CompletionReferenceOption,
} from "../data/completion-workspace";
import { describeCommandAvailability } from "../data/ui-presentation";
import { commands, creationCapabilityLabel, reasonLabel, states } from "../labels";
import { formatDateTime } from "../i18n/format";
import { ActionButton, Panel, SectionHeader, StatusBadge } from "../ui";
import { ActionGate, DetailPane } from "../ui/catalog";
import { WorkbenchTemplate } from "../ui/templates";
import { PageBoundary } from "./PageBoundary";
import { recordTitle } from "./record-utils";
import { HandoverReservationFields, type ReservationInput } from "./HandoverReservationFields";
import "./completion-handover.css";

const tabs: Array<{ id: CompletionMachine; key: CompletionLabelKey; description: CompletionLabelKey }> = [
  { id: "commissioning_package", key: "commissioning", description: "commissioningDescription" },
  { id: "handover_package", key: "handover", description: "handoverDescription" },
  { id: "warranty_claim", key: "warranty", description: "warrantyDescription" },
];

type RefMap = Map<string, DomainRef>;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function keyForRef(ref: DomainRef) { return `${ref.objectType}:${ref.objectId}:${ref.version}`; }

function dateText(value: unknown) {
  if (typeof value !== "string" || !value) return "—";
  return formatDateTime(value);
}

class LocalizedFormError extends Error {}

function values(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }

function RefSelect({
  label, options, value, onChange, multiple = false, disabled = false, emptyLabel,
}: {
  label: string; options: CompletionReferenceOption[]; value: string | string[];
  onChange: (value: string | string[]) => void; multiple?: boolean; disabled?: boolean; emptyLabel: string;
}) {
  return <label className="completion-field">{label}
    <select aria-label={label} value={multiple ? (Array.isArray(value) ? value : []) : (Array.isArray(value) ? value[0] ?? "" : value)} multiple={multiple} disabled={disabled}
      onChange={(event) => onChange(multiple
        ? Array.from(event.currentTarget.selectedOptions, (option) => option.value)
        : event.currentTarget.value)}>
      {!multiple && <option value="">{options.length ? emptyLabel : "—"}</option>}
      {options.map((option) => <option key={keyForRef(option.ref)} value={keyForRef(option.ref)}>
        {option.label}{option.status ? ` · ${states[option.status] || option.status}` : ""}
      </option>)}
    </select>
    {!options.length && <small className="completion-helper">{emptyLabel}</small>}
  </label>;
}

function FieldGrid({ items, t }: { items: Array<[string, unknown]>; t?: (key: CompletionLabelKey) => string }) {
  return <dl className="completion-meta-grid">{items.map(([label, value], index) => <div key={`${label}-${index}`}>
    <dt>{label}</dt><dd title={referenceTitle(value)}>{t ? displayValue(value, t) : completionText(value)}</dd>
  </div>)}</dl>;
}

function displayValue(value: unknown, t: (key: CompletionLabelKey) => string) {
  if (typeof value === "boolean") return t(value ? "yes" : "no");
  return completionText(value);
}

function controlledValue(value: unknown, t: (key: CompletionLabelKey) => string) {
  if (value === "ready") return t("readinessReady");
  if (value === "not_ready") return t("readinessNotReady");
  return typeof value === "string" && states[value] ? states[value] : displayValue(value, t);
}

function referenceTitle(value: unknown): string | undefined {
  const ref=object(value);
  return typeof ref.objectType === "string" && typeof ref.objectId === "string" && typeof ref.version === "number"
    ? `${recordTypeLabel(ref.objectType)} · ${ref.objectId} · ${recordVersionLabel(ref.version)}` : undefined;
}

function ReferenceList({ label, value }: { label: string; value: unknown }) {
  const refs = values(value);
  return <div className="completion-reference-list"><span>{label}</span>
    {refs.length ? <ul>{refs.map((ref, index) => <li title={referenceTitle(ref)} key={`${completionText(ref)}-${index}`}>{completionText(ref)}</li>)}</ul> : <p>—</p>}
  </div>;
}

function ReferenceRefreshHistory({
  label, value, t,
}: {
  label: string; value: unknown; t: (key: CompletionLabelKey) => string;
}) {
  const history = values(value);
  return <section className="completion-section">
    <SectionHeader title={label} meta={`${history.length}`} />
    {history.length ? <ol className="completion-history">{history.map((entryValue, index) => {
      const entry = object(entryValue);
      const priorIssues = entry.priorCurrentIssueRefs ?? entry.priorPunchIssueRefs ?? entry.priorIssueRef;
      const currentIssues = entry.currentIssueRefs ?? entry.currentPunchIssueRefs ?? entry.currentIssueRef;
      const priorActions = entry.priorCorrectionActionRefs ?? entry.priorActionRefs;
      const currentActions = entry.currentCorrectionActionRefs ?? entry.currentActionRefs;
      return <li key={`${String(entry.recordedAt ?? index)}-${index}`}>
        <FieldGrid t={t} items={[[t("recordedAt"), dateText(entry.recordedAt)], [t("reference"), entry.recordedBy]]} />
        <div className="completion-reference-grid">
          {priorIssues !== undefined && <ReferenceList label={t("referenceRefreshPrior")} value={Array.isArray(priorIssues) ? priorIssues : [priorIssues]} />}
          {priorActions !== undefined && <ReferenceList label={t("referenceRefreshPrior")} value={priorActions} />}
          {currentIssues !== undefined && <ReferenceList label={t("referenceRefreshCurrent")} value={Array.isArray(currentIssues) ? currentIssues : [currentIssues]} />}
          {currentActions !== undefined && <ReferenceList label={t("referenceRefreshCurrent")} value={currentActions} />}
        </div>
      </li>;
    })}</ol> : <p className="muted">—</p>}
  </section>;
}

function CommissioningDetail({ item, t }: { item: WorkItem; t: (key: CompletionLabelKey) => string }) {
  const data = completionData(item);
  const history = values(data.testResultHistory);
  const latest = object(history.at(-1));
  return <>
    <div className="completion-summary">
      <div><span>{t("status")}</span><strong>{states[item.record.status || ""] || item.record.status || "—"}</strong></div>
      <div><span>{t("readiness")}</span><strong>{controlledValue(data.readinessStatus, t)}</strong></div>
      <div><span>{t("testResult")}</span><strong>{controlledValue(latest.outcome ?? data.lastTestOutcome, t)}</strong></div>
      <div><span>{t("testHistory")}</span><strong>{history.length}</strong></div>
    </div>
    <section className="completion-section"><SectionHeader title={t("commissioning")} />
      <FieldGrid t={t} items={[
        [t("number"), data.commissioningNo], [t("system"), data.system], [t("profileRef"), data.commissioningProfileRef],
        [t("readiness"), controlledValue(data.readinessStatus, t)], [t("testResultRef"), latest.testResultRef],
        [t("criteriaMet"), latest.acceptanceCriteriaMet], [t("recordedAt"), dateText(latest.recordedAt ?? data.lastTestResultAt)],
      ]} />
      <div className="completion-reference-grid">
        <ReferenceList label={t("requirementRefs")} value={item.record.requirementRefs} />
        <ReferenceList label={t("inspectionRefs")} value={data.prerequisiteInspectionRefs} />
        <ReferenceList label={t("drawingRef")} value={item.record.drawingRef ? [item.record.drawingRef] : []} />
        <ReferenceList label={t("testProcedureRefs")} value={data.testProcedureRefs} />
        <ReferenceList label={t("integratedTestRefs")} value={data.integratedTestRefs} />
        <ReferenceList label={t("materialReadinessRefs")} value={data.materialReadinessRefs} />
        <ReferenceList label={t("equipmentReadinessRefs")} value={data.equipmentReadinessRefs} />
        <ReferenceList label={t("calibrationRefs")} value={data.calibrationRefs} />
        <ReferenceList label={t("utilityReadinessRefs")} value={data.utilityReadinessRefs} />
        <ReferenceList label={t("safetyPermitRefs")} value={data.safetyPermitRefs} />
        <ReferenceList label={t("testWitnessPartyIds")} value={data.testWitnessPartyIds} />
        <ReferenceList label={t("punchIssues")} value={data.punchIssueRefs} />
        <ReferenceList label={t("correctionActionRefs")} value={data.correctionActionRefs} />
        <ReferenceList label={t("currentPunchIssueRefs")} value={data.currentPunchIssueRefs ?? data.punchIssueRefs} />
        <ReferenceList label={t("currentCorrectionActionRefs")} value={data.currentCorrectionActionRefs ?? data.correctionActionRefs} />
      </div>
    </section>
    <ReferenceRefreshHistory label={t("punchReferenceRefreshHistory")} value={data.punchReferenceRefreshHistory} t={t} />
    <section className="completion-section"><SectionHeader title={t("testHistory")} meta={`${history.length}`} />
      {history.length ? <ol className="completion-history">{history.map((value, index) => {
        const result = object(value);
        return <li key={String(result.testResultRef ? completionText(result.testResultRef) : index)}>
          <div><strong>{controlledValue(result.outcome, t)}</strong><span>{dateText(result.recordedAt ?? result.submittedAt)}</span></div>
          <FieldGrid t={t} items={[[t("criteriaMet"), result.acceptanceCriteriaMet], [t("testResultRef"), result.testResultRef], [t("reworkReason"), result.failureReason]]} />
        </li>;
      })}</ol> : <p className="muted">—</p>}
      <p className="completion-boundary">{t("retestPreserved")}</p>
    </section>
  </>;
}

const handoverDocumentFields: Array<[string, string]> = [
  ["asBuiltRefs", "asBuiltRefs"], ["omManualRefs", "omManualRefs"], ["trainingRefs", "trainingRefs"],
  ["sparePartsRefs", "sparePartsRefs"], ["certificateRefs", "certificateRefs"], ["statutoryAcceptanceRefs", "statutoryAcceptanceRefs"],
];

function HandoverDetail({ item, t }: { item: WorkItem; t: (key: CompletionLabelKey) => string }) {
  const data = completionData(item);
  const scope = object(data.handoverScope);
  const acceptedScope = object(data.acceptedScope);
  const reservations = values(data.reservations);
  const documentRefs = handoverDocumentFields.flatMap(([field]) => values(data[field]));
  return <>
    <div className="completion-summary">
      <div><span>{t("status")}</span><strong>{states[item.record.status || ""] || item.record.status || "—"}</strong></div>
      <div><span>{t("handoverReady")}</span><strong>{displayValue(data.handoverReady, t)}</strong></div>
      <div><span>{t("readiness")}</span><strong>{controlledValue(data.readinessStatus, t)}</strong></div>
      <div><span>{t("reservations")}</span><strong>{reservations.length}</strong></div>
    </div>
    <section className="completion-section"><SectionHeader title={t("scope")} />
      <FieldGrid t={t} items={[
        [t("number"), data.handoverNo], [t("profileRef"), data.handoverProfileRef], [t("scopeId"), scope.scopeId],
        [t("system"), scope.system], [t("locationIds"), scope.locationIds], [t("assetRefs"), scope.assetRefs],
        [t("acceptedScope"), acceptedScope.scopeId ? acceptedScope : undefined],
        [t("ownerAcceptance"), data.ownerAcceptanceRef], [t("handoverDate"), dateText(data.handoverDate)],
        [t("warrantyTrigger"), dateText(data.warrantyStartAt)],
      ]} />
      <ReferenceList label={t("commissioningRefs")} value={data.commissioningPackageRefs} />
    </section>
    <section className="completion-section"><SectionHeader title={t("submittedDocuments")} meta={`${documentRefs.length}`} />
      <div className="completion-document-grid">{handoverDocumentFields.map(([field, key]) => <ReferenceList key={field} label={t(key as CompletionLabelKey)} value={data[field]} />)}</div>
      <ReferenceList label={t("submittedIssueRefs")} value={data.openIssueRefs} />
      <ReferenceList label={t("currentIssueRefs")} value={data.currentIssueRefs ?? data.openIssueRefs} />
      <ReferenceList label={t("currentOpenIssueRefs")} value={data.currentOpenIssueRefs ?? data.openIssueRefs} />
    </section>
    <ReferenceRefreshHistory label={t("issueReferenceRefreshHistory")} value={data.issueReferenceRefreshHistory} t={t} />
    <section className="completion-section"><SectionHeader title={t("acceptedDocuments")} meta={`${values(data.acceptedDocumentRefs).length}`} />
      <ReferenceList label={t("acceptedDocuments")} value={data.acceptedDocumentRefs} />
    </section>
    <section className="completion-section"><SectionHeader title={t("reservations")} meta={`${reservations.length}`} />
      {reservations.length ? <ol className="completion-history">{reservations.map((value, index) => {
        const reservation = object(value);
        return <li key={`${completionText(reservation.issueRef)}-${index}`}>
          <FieldGrid t={t} items={[
            [t("reference"), reservation.issueRef], [t("reservationOwner"), reservation.ownerPartyId],
            [t("dueAt"), dateText(reservation.dueAt)], [t("partialScope"), reservation.scope],
          ]} />
          <p>{completionText(reservation.closureRequirement)}</p>
        </li>;
      })}</ol> : <p className="muted">—</p>}
      <p className="completion-boundary">{t("partialHandoverBoundary")}</p>
    </section>
  </>;
}

function WarrantyDetail({ item, t }: { item: WorkItem; t: (key: CompletionLabelKey) => string }) {
  const data = completionData(item);
  return <>
    <div className="completion-summary">
      <div><span>{t("status")}</span><strong>{states[item.record.status || ""] || item.record.status || "—"}</strong></div>
      <div><span>{t("period")}</span><strong>{completionText(data.warrantyPeriodRef)}</strong></div>
      <div><span>{t("remedyEvidence")}</span><strong>{values(data.remedyEvidenceIds).length}</strong></div>
      <div><span>{t("closeout")}</span><strong>{completionText(data.closureRef)}</strong></div>
    </div>
    <section className="completion-section"><SectionHeader title={t("warranty")} />
      <FieldGrid t={t} items={[
        [t("number"), data.claimNo], [t("handoverRef"), data.handoverRef], [t("warrantyPeriodRef"), data.warrantyPeriodRef],
        [t("observedAt"), dateText(data.defectObservedAt)], [t("responseDueAt"), dateText(data.responseDueAt)],
        [t("defectScope"), data.defectScope], [t("defectDescription"), data.defectDescription],
        [t("causeDescription"), data.causeDescription], [t("operationalImpact"), data.operationalImpact],
        [t("issueRef"), data.issueRef], [t("currentIssueRef"), data.currentIssueRef ?? data.issueRef], [t("remedySummary"), data.remedySummary], [t("reworkReason"), data.reworkReason],
        [t("reinspectionRef"), data.reinspectionRef], [t("closeout"), data.closureRef],
      ]} />
      <div className="completion-reference-grid">
        <ReferenceList label={t("actionRefs")} value={data.actionRefs} />
        <ReferenceList label={t("currentActionRefs")} value={data.currentActionRefs ?? data.actionRefs} />
        <ReferenceList label={t("remedyEvidence")} value={data.remedyEvidenceIds} />
        <ReferenceList label={t("reinspectionHistory")} value={data.reinspectionHistoryRefs} />
        <ReferenceList label={t("closureEvidence")} value={data.closureEvidenceRefs} />
      </div>
      <p className="completion-boundary">{t("warrantyClosureBoundary")}</p>
    </section>
    <ReferenceRefreshHistory label={t("remedyReferenceRefreshHistory")} value={data.remedyReferenceRefreshHistory} t={t} />
  </>;
}

function CreateDraft({
  machine, workspace, client, online, referenceOptions, capability, onClose, onCreated, t,
}: {
  machine: CompletionMachine; workspace: Workspace; client: SupervisionClient; online: boolean;
  referenceOptions: CompletionReferenceOption[]; capability?: CreationCapability;
  onClose: () => void; onCreated: (id: string) => Promise<void>; t: (key: CompletionLabelKey) => string;
}) {
  const [title, setTitle] = useState("");
  const [number, setNumber] = useState("");
  const [system, setSystem] = useState("");
  const [scopeId, setScopeId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [observedAt, setObservedAt] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [defectDescription, setDefectDescription] = useState("");
  const [causeDescription, setCauseDescription] = useState("");
  const [operationalImpact, setOperationalImpact] = useState("");
  const [selected, setSelected] = useState<Record<string, string | string[]>>({});
  const [reservationProposals, setReservationProposals] = useState<ReservationInput[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const identity = useRef({ id: crypto.randomUUID(), key: crypto.randomUUID() });
  const tab = tabs.find((value) => value.id === machine)!;
  const relevantOptions = (objectTypes: string[], machines?: string[]) => referenceOptions.filter((option) =>
    objectTypes.includes(option.ref.objectType) && (!machines || machines.some((machineName) =>
      workspace.items.some((item) => item.machine === machineName && item.record.id === option.ref.objectId))),
  );
  const requirementOptions = relevantOptions(["Requirement"]);
  const profileOptions = completionProfileOptions(workspace, referenceOptions,
    machine === "commissioning_package" ? "commissioningProfile" : machine === "handover_package" ? "handoverProfile" : "warrantyPeriod");
  const requiredProfileKey = machine === "commissioning_package" ? "commissioningProfileRef" : machine === "handover_package" ? "handoverProfileRef" : "warrantyPeriodRef";
  const informationOptions = relevantOptions(["InformationItem", "DocumentSnapshot"]);
  const drawingOptions = informationOptions.filter((option) => option.ref.objectType === "InformationItem" && option.subtype === "Drawing");
  const workItemOptions = relevantOptions(["WorkItem"]);
  const evidenceOptions = referenceOptions.filter((option) => option.ref.objectType === "Evidence");
  const inspectionOptions = relevantOptions(["Inspection"]);
  const commissioningOptions = workItemOptions.filter((option) => workspace.items.some((item) => item.machine === "commissioning_package" && item.record.id === option.ref.objectId));
  const handoverOptions = workItemOptions.filter((option) => workspace.items.some((item) => item.machine === "handover_package" && item.record.id === option.ref.objectId));
  const issueOptions = relevantOptions(["Issue"]);
  const actionOptions = relevantOptions(["Action"]);
  const locationOptions = [...new Set([workspace.context.scope.locationId, ...workspace.items.map((item) => item.record.locationId)].filter((value): value is string => typeof value === "string" && value.length > 0))];
  const refMap: RefMap = new Map(referenceOptions.map((option) => [keyForRef(option.ref), option.ref]));
  const value = (key: string) => selected[key] ?? "";
  const oneRef = (key: string) => typeof value(key) === "string" && value(key) ? refMap.get(value(key) as string) : undefined;
  const manyRefs = (key: string) => (Array.isArray(value(key)) ? value(key) as string[] : []).map((refKey) => refMap.get(refKey)).filter((ref): ref is DomainRef => Boolean(ref));
  const setSingle = (key: string, next: string | string[]) => setSelected((prev) => ({ ...prev, [key]: typeof next === "string" ? next : next[0] || "" }));
  const setMany = (key: string, next: string | string[]) => setSelected((prev) => ({ ...prev, [key]: Array.isArray(next) ? next : [next] }));

  async function save() {
    setError(""); setBusy(true);
    try {
      if (!online) throw new LocalizedFormError(t("offlineSave"));
      if (client.kind === "mock") throw new LocalizedFormError(t("mockSave"));
      if (!title.trim() || !number.trim()) throw new LocalizedFormError(t("requiredFields"));
      if (!oneRef(requiredProfileKey)) throw new LocalizedFormError(t("profileRequired"));
      if (machine === "handover_package" && (!scopeId.trim() || !system.trim() || !locationId)) throw new LocalizedFormError(t("requiredHandoverScope"));
      if (machine === "warranty_claim" && (!oneRef("handoverRef") || !oneRef("issueRef") || !observedAt || !scopeId.trim() || !system.trim() || !locationId || !defectDescription.trim() || !causeDescription.trim() || !operationalImpact.trim())) throw new LocalizedFormError(t("warrantyRequiredFields"));
      const { minimumQualificationRank: _minimumQualificationRank, ...scope } = workspace.context.scope;
      const subtype = machine === "commissioning_package" ? "CommissioningPackage" : machine === "handover_package" ? "HandoverPackage" : "WarrantyClaim";
      let data: Record<string, unknown>;
      let requirementRefs: DomainRef[] = manyRefs("requirementRefs");
      if (machine === "commissioning_package") {
        const profile = oneRef("commissioningProfileRef");
        if (profile && !requirementRefs.some((ref) => keyForRef(ref) === keyForRef(profile))) requirementRefs = [...requirementRefs, profile];
        data = {
          commissioningNo: number.trim(), system: system.trim(),
          ...(profile ? { commissioningProfileRef: profile } : {}),
          prerequisiteInspectionRefs: manyRefs("prerequisiteInspectionRefs"),
          precommissioningChecklist: [],
          testProcedureRefs: manyRefs("testProcedureRefs"),
          integratedTestRefs: manyRefs("integratedTestRefs"), materialReadinessRefs: manyRefs("materialReadinessRefs"),
          equipmentReadinessRefs: manyRefs("equipmentReadinessRefs"), calibrationRefs: manyRefs("calibrationRefs"),
          utilityReadinessRefs: manyRefs("utilityReadinessRefs"), safetyPermitRefs: manyRefs("safetyPermitRefs"),
          testWitnessPartyIds: Array.isArray(value("testWitnessPartyIds")) ? value("testWitnessPartyIds") : [],
          punchIssueRefs: manyRefs("punchIssueRefs"), correctionActionRefs: manyRefs("correctionActionRefs"),
        };
      } else if (machine === "handover_package") {
        const profile = oneRef("handoverProfileRef");
        if (profile && !requirementRefs.some((ref) => keyForRef(ref) === keyForRef(profile))) requirementRefs = [...requirementRefs, profile];
        const knownLocationId = locationId;
        const commissioningPackageRefs = manyRefs("commissioningPackageRefs");
        data = {
          handoverNo: number.trim(),
          handoverScope: {
            scopeId: scopeId.trim(), system: system.trim(), locationIds: knownLocationId ? [knownLocationId] : [], assetRefs: manyRefs("assetRefs"),
          },
          ...(profile ? { handoverProfileRef: profile } : {}),
          commissioningPackageRefs,
          asBuiltRefs: manyRefs("asBuiltRefs"), omManualRefs: manyRefs("omManualRefs"), trainingRefs: manyRefs("trainingRefs"),
          sparePartsRefs: manyRefs("sparePartsRefs"), certificateRefs: manyRefs("certificateRefs"),
          statutoryAcceptanceRefs: manyRefs("statutoryAcceptanceRefs"), openIssueRefs: manyRefs("openIssueRefs"),
          reservationProposals: reservationProposals.filter((entry) => manyRefs("openIssueRefs").some((ref) => keyForRef(ref) === keyForRef(entry.issueRef))),
        };
      } else {
        const period = oneRef("warrantyPeriodRef");
        if (period && !requirementRefs.some((ref) => keyForRef(ref) === keyForRef(period))) requirementRefs = [...requirementRefs, period];
        const handover = oneRef("handoverRef");
        const locationId = (value("locationId") as string) || locationOptions[0] || "";
        data = {
          claimNo: number.trim(), ...(handover ? { handoverRef: handover } : {}), ...(period ? { warrantyPeriodRef: period } : {}),
          ...(observedAt ? { defectObservedAt: new Date(observedAt).toISOString() } : {}),
          ...(scopeId.trim() && system.trim() && locationId ? { defectScope: { scopeId: scopeId.trim(), system: system.trim(), locationIds: [locationId], assetRefs: manyRefs("assetRefs") } } : {}),
          defectDescription: defectDescription.trim(), causeDescription: causeDescription.trim(), operationalImpact: operationalImpact.trim(),
          ...(oneRef("issueRef") ? { issueRef: oneRef("issueRef") } : {}),
          actionRefs: manyRefs("actionRefs"), ...(dueAt ? { responseDueAt: new Date(dueAt).toISOString() } : {}),
        };
      }
      const payload = {
        ...scope, subtype, title: title.trim(), data,
        ...(requirementRefs.length ? { requirementRefs } : {}),
        ...(machine === "warranty_claim" ? { evidenceIds: manyRefs("evidenceIds").map((ref) => ref.objectId) } : {}),
        ...(oneRef("drawingRef") ? { drawingRef: oneRef("drawingRef") } : {}),
      };
      const result = await client.create(machine, payload, identity.current.id, identity.current.key);
      identity.current = { id: crypto.randomUUID(), key: crypto.randomUUID() };
      await onCreated(result.record.id);
    } catch (e) {
      setError(e instanceof ApiError ? reasonLabel(e.detail.code) : e instanceof LocalizedFormError ? e.message : t("error"));
    } finally { setBusy(false); }
  }

  const commonRequirementSelectors = <>
    <RefSelect label={t("requirementRefs")} options={requirementOptions} value={Array.isArray(value("requirementRefs")) ? value("requirementRefs") as string[] : []} onChange={(next) => setMany("requirementRefs", next)} multiple emptyLabel={t("noReferences")} />
  </>;
  const docFields: Array<[string, CompletionLabelKey]> = [
    ["asBuiltRefs", "asBuiltRefs"], ["omManualRefs", "omManualRefs"], ["trainingRefs", "trainingRefs"],
    ["sparePartsRefs", "sparePartsRefs"], ["certificateRefs", "certificateRefs"], ["statutoryAcceptanceRefs", "statutoryAcceptanceRefs"],
  ];
  const drawSelect = (key: string, labelKey: CompletionLabelKey, options: CompletionReferenceOption[], multiple = false) => (
    <RefSelect key={key} label={t(labelKey)} options={options}
      value={multiple ? (Array.isArray(value(key)) ? value(key) as string[] : []) : (value(key) as string)}
      onChange={(next) => multiple ? setMany(key, next) : setSingle(key, next)} multiple={multiple} emptyLabel={t("noReferences")} />
  );

  return <div className="modal-backdrop"><section className="modal completion-modal" role="dialog" aria-modal="true" aria-label={`${t(tab.key)} · ${t("create")}`}>
    <div className="section-heading"><h2>{t(tab.key)} · {t("create")}</h2><button type="button" aria-label={t("closeDialog")} disabled={busy} onClick={onClose}>×</button></div>
    <div className="completion-form-grid">
      <label className="completion-field">{t("titleField")} *<input value={title} onChange={(event) => setTitle(event.target.value)} disabled={busy} /></label>
      <label className="completion-field">{t("number")} *<input value={number} onChange={(event) => setNumber(event.target.value)} disabled={busy} /></label>
      {(machine === "commissioning_package" || machine === "handover_package" || machine === "warranty_claim") && <label className="completion-field">{t("system")}<input value={system} onChange={(event) => setSystem(event.target.value)} disabled={busy} /></label>}
      {machine === "commissioning_package" && <>
        {drawSelect("commissioningProfileRef", "profileRef", profileOptions)}
        {commonRequirementSelectors}
        {drawSelect("prerequisiteInspectionRefs", "inspectionRefs", inspectionOptions, true)}
        {drawSelect("testProcedureRefs", "testProcedureRefs", requirementOptions.concat(informationOptions), true)}
        {drawSelect("integratedTestRefs", "integratedTestRefs", informationOptions, true)}
        {drawSelect("materialReadinessRefs", "materialReadinessRefs", informationOptions.concat(workItemOptions), true)}
        {drawSelect("equipmentReadinessRefs", "equipmentReadinessRefs", informationOptions.concat(workItemOptions), true)}
        {drawSelect("calibrationRefs", "calibrationRefs", requirementOptions.concat(informationOptions), true)}
        {drawSelect("utilityReadinessRefs", "utilityReadinessRefs", informationOptions, true)}
        {drawSelect("safetyPermitRefs", "safetyPermitRefs", workItemOptions, true)}
        <label className="completion-field">{t("testWitnessPartyIds")}<select multiple value={Array.isArray(value("testWitnessPartyIds")) ? value("testWitnessPartyIds") as string[] : []}
          onChange={(event) => setMany("testWitnessPartyIds", Array.from(event.target.selectedOptions, (option) => option.value))} disabled={busy}>
          {workspace.participants.map((participant) => <option key={participant.partyId} value={participant.partyId}>{participant.name}</option>)}
        </select></label>
        {drawSelect("punchIssueRefs", "punchIssues", issueOptions, true)}
        {drawSelect("correctionActionRefs", "correctionActionRefs", actionOptions, true)}
        {drawSelect("drawingRef", "drawingRef", drawingOptions)}
      </>}
      {machine === "handover_package" && <>
        <label className="completion-field">{t("scopeId")} *<input value={scopeId} onChange={(event) => setScopeId(event.target.value)} disabled={busy} /></label>
        <label className="completion-field">{t("locationIds")} *<select aria-label={t("locationIds")} value={locationId} onChange={(event) => setLocationId(event.target.value)} disabled={busy}>
          <option value="">{locationOptions.length ? t("selectReference") : t("noReferences")}</option>
          {locationOptions.map((id) => <option key={id} value={id}>{workspace.items.find((item) => item.record.locationId === id)?.record.title || id}</option>)}
        </select></label>
        {drawSelect("handoverProfileRef", "profileRef", profileOptions)}
        {commonRequirementSelectors}
        {drawSelect("drawingRef", "drawingRef", drawingOptions)}
        {drawSelect("commissioningPackageRefs", "commissioningRefs", commissioningOptions, true)}
        {docFields.map(([field, key]) => drawSelect(field, key, informationOptions, true))}
        {drawSelect("assetRefs", "assetRefs", referenceOptions.filter((option) => option.ref.objectType === "Asset"), true)}
        {drawSelect("openIssueRefs", "openIssueRefs", issueOptions, true)}
        <HandoverReservationFields issues={manyRefs("openIssueRefs").map((ref) => ({ ref, label: issueOptions.find((option) => keyForRef(option.ref) === keyForRef(ref))?.label ?? ref.objectId }))} participants={workspace.participants} value={reservationProposals} onChange={setReservationProposals} />
      </>}
      {machine === "warranty_claim" && <>
        <RefSelect label={`${t("handoverRef")} *`} options={handoverOptions} value={(value("handoverRef") as string) || ""} onChange={(next) => setSingle("handoverRef", next)} emptyLabel={t("noReferences")} />
        {drawSelect("warrantyPeriodRef", "warrantyPeriodRef", profileOptions)}
        {commonRequirementSelectors}
        <RefSelect label={`${t("issueRef")} *`} options={issueOptions} value={(value("issueRef") as string) || ""} onChange={(next) => setSingle("issueRef", next)} emptyLabel={t("noReferences")} />
        {drawSelect("actionRefs", "actionRefs", actionOptions, true)}
        {drawSelect("evidenceIds", "evidenceRefs", evidenceOptions, true)}
        <label className="completion-field">{t("observedAt")} *<input type="datetime-local" value={observedAt} onChange={(event) => setObservedAt(event.target.value)} disabled={busy} /></label>
        <label className="completion-field">{t("responseDueAt")}<input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} disabled={busy} /></label>
        <label className="completion-field completion-field-wide">{t("defectDescription")} *<textarea value={defectDescription} onChange={(event) => setDefectDescription(event.target.value)} disabled={busy} /></label>
        <label className="completion-field">{t("causeDescription")} *<textarea value={causeDescription} onChange={(event) => setCauseDescription(event.target.value)} disabled={busy} /></label>
        <label className="completion-field">{t("operationalImpact")} *<textarea value={operationalImpact} onChange={(event) => setOperationalImpact(event.target.value)} disabled={busy} /></label>
        <label className="completion-field">{t("scopeId")} *<input value={scopeId} onChange={(event) => setScopeId(event.target.value)} disabled={busy} /></label>
        <label className="completion-field">{t("system")} *<input value={system} onChange={(event) => setSystem(event.target.value)} disabled={busy} /></label>
        <label className="completion-field">{t("locationIds")} *<select aria-label={`${t("locationIds")} *`} value={locationId} onChange={(event) => setLocationId(event.target.value)} disabled={busy}>
          <option value="">{locationOptions.length ? t("selectReference") : t("noReferences")}</option>
          {locationOptions.map((id) => <option key={id} value={id}>{workspace.items.find((item) => item.record.locationId === id)?.record.title || id}</option>)}
        </select></label>
        {drawSelect("assetRefs", "assetRefs", referenceOptions.filter((option) => option.ref.objectType === "Asset"), true)}
      </>}
    </div>
    <p className="completion-profile-note">{profileOptions.length ? t("profileScopeNote") : t("profileUnavailable")}</p>
    {!capability?.canCreate && <p className="completion-capability-note">{capability ? creationCapabilityLabel(capability) : t("createUnavailable")}</p>}
    <p className="completion-boundary">{t("serverBoundary")}</p>
    {error && <div role="alert" className="error-box">{error}</div>}
    <div className="modal-actions"><button className="secondary" onClick={onClose} disabled={busy}>{t("cancel")}</button>
      <button className="primary" onClick={() => void save()} disabled={busy || !online || client.kind === "mock" || !capability?.canCreate || !profileOptions.length}>{busy ? t("saving") : t("saveDraft")}</button>
    </div>
  </section></div>;
}

export function CompletionHandoverPage({
  client, workspace, selected, current, online, onSelect, onOpenCommand, refresh, labels,
}: {
  client: SupervisionClient; workspace: Workspace; selected: string | null; current: WorkItem | null;
  online: boolean; onSelect: (id: string | null) => void;
  onOpenCommand: (item: WorkItem, action: CommandDescriptor) => void; refresh: () => Promise<void>;
  labels?: Partial<Record<CompletionLabelKey, string>>;
}) {
  const t = (key: CompletionLabelKey) => labels?.[key] || completionFallbackLabels[key] || key;
  const [machine, setMachine] = useState<CompletionMachine>(current?.machine === "commissioning_package" || current?.machine === "handover_package" || current?.machine === "warranty_claim" ? current.machine : "commissioning_package");
  const [creating, setCreating] = useState<CompletionMachine | null>(null);
  const items = useMemo(() => completionItems(workspace.items, machine), [workspace.items, machine]);
  const options = useMemo(() => completionReferenceOptions(workspace), [workspace]);
  const selectedItem = current?.machine === machine ? current : null;
  const capability = workspace.context.creationCapabilities?.[machine];
  const tab = tabs.find((value) => value.id === machine)!;

  async function createAndRefresh(id: string) {
    setCreating(null); await refresh(); onSelect(id);
  }

  return <PageBoundary name="completion-handover">
    <section data-ui-component="completion-handover-workspace">
      
      <WorkbenchTemplate hasDetail={Boolean(selectedItem)} className="operational-tabs-workspace"
          topToolbar={<Tabs value={machine} onValueChange={(value) => { setMachine(value as CompletionMachine); onSelect(null); }} className="operational-toolbar-tabs">
        <TabsList variant="line" className="completion-tabs-list">{tabs.map((value) => <TabsTrigger key={value.id} value={value.id}>{t(value.key)}</TabsTrigger>)}</TabsList>
        <p className="completion-intro">{t("description")}</p>
      </Tabs>
          }>
        <Panel className="list-pane" aria-label={t(tab.key)}>
          <div className="fieldwire-operational-list-head" data-ui-component="operational-list-head">
          <p className="mb-2 text-xs text-muted-foreground" data-ui-component="list-record-count">{i18n.t("common.count", { count: items.length })}</p>
          <div data-ui-component="completion-create-action" className="completion-create-action"><ActionButton disabled={!online || client.kind === "mock" || !capability?.canCreate} onClick={() => setCreating(machine)}>{t("create")}</ActionButton></div>
          </div>
          {!capability?.canCreate && <p className="completion-capability-note">{capability ? creationCapabilityLabel(capability) : t("createUnavailable")}</p>}
          <p className="muted">{t(tab.description)}</p>
          <div className="completion-record-list">
            {items.length ? items.map((item) => {
              const data = completionData(item);
              const secondary = item.machine === "commissioning_package" ? data.system : item.machine === "handover_package" ? object(data.handoverScope).scopeId : data.handoverRef;
              return <button type="button" className={`completion-record-row${selected === item.record.id ? " selected" : ""}`} key={item.record.id} aria-pressed={selected === item.record.id} onClick={() => onSelect(item.record.id)}>
                <span><strong>{recordTitle(item.record)}</strong><small>{completionIdentity(item)} · {t("sourceVersion")} {recordVersionLabel(item.record.version)}</small></span>
                <span className="completion-record-context">{completionText(secondary)}</span>
                <StatusBadge status={item.record.status}>{states[item.record.status || ""] || item.record.status || "—"}</StatusBadge>
              </button>;
            }) : <div className="empty compact">{t("empty")}</div>}
          </div>
        </Panel>
        <DetailPane>
          {!selectedItem ? <div className="empty compact"><h2>{t(tab.key)}</h2><p>{t(tab.description)}</p></div> : <>
            <button type="button" className="mobile-back" onClick={() => onSelect(null)}>← {t("backToList")}</button>
            <div className="detail-head"><div><span className="eyebrow">{t(tab.key)}</span><h2>{recordTitle(selectedItem.record)}</h2><p>{t("sourceVersion")} {recordVersionLabel(selectedItem.record.version)}</p></div>
              <StatusBadge status={selectedItem.record.status}>{states[selectedItem.record.status || ""] || selectedItem.record.status || "—"}</StatusBadge>
            </div>
            {machine === "commissioning_package" && <CommissioningDetail item={selectedItem} t={t} />}
            {machine === "handover_package" && <HandoverDetail item={selectedItem} t={t} />}
            {machine === "warranty_claim" && <WarrantyDetail item={selectedItem} t={t} />}
            <section className="completion-section"><SectionHeader title={t("commands")} />
              {selectedItem.actions.length ? <div className="completion-commands">{selectedItem.actions.map((action) => {
                const availability = describeCommandAvailability(action, online);
                const label = commands[action.command] || action.command.replace(/_/g, " ");
                return <ActionGate key={action.command} actions={[{
                  id: action.command, label, availability: availability.availability,
                  availabilityLabel: t(action.ready ? "commandAvailable" : "commandBlocked"),
                  reason: !online ? t("offlineSave") : action.blockedReason ? reasonLabel(action.blockedReason.code) : availability.disabled ? reasonLabel() : undefined,
                  disabled: availability.disabled || client.kind === "mock",
                  onAction: () => onOpenCommand(selectedItem, action),
                }]} />;
              })}</div> : <p className="muted">{t("noCommands")}</p>}
            </section>
          </>}
        </DetailPane>
      </WorkbenchTemplate>
      {creating && <CreateDraft machine={creating} workspace={workspace} client={client} online={online} referenceOptions={options}
        capability={workspace.context.creationCapabilities?.[creating]} onClose={() => setCreating(null)} onCreated={createAndRefresh} t={t} />}
    </section>
  </PageBoundary>;
}
