import { scheduleInputs } from "../data/schedule-fields.generated";
import { completionDecisionReferenceOptions, completionReferenceOptions } from "../data/completion-workspace";
import { commandInputs } from "../data/command-fields.generated";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  CommandDescriptor,
  DomainRef,
  Fields,
  Json,
  WorkItem,
  Workspace,
} from "../data/ui-contract";
import { ApiError } from "../data/supervision-client";
import { commands, fields, reasonLabel, roles } from "../labels";
import { recordRef } from "./record-utils";
import { Icon } from "./shared";
import { HandoverReservationFields, type ReservationInput } from "./HandoverReservationFields";
import { BOQLineItemFields } from "./BOQLineItemFields";

class CommandInputError extends Error {}

const booleanFields = new Set([
  "changeRequired",
  "dueCalculationConfirmed",
  "safetyReviewComplete",
  "prestartVerified",
  "completionConfirmed",
  "preUseCheckComplete",
  "acceptanceCriteriaMet",
  "warrantyTrigger",
]);

const jsonFields = new Set([
  "checkResults",
  "verificationGrounding",
  "conditions",
  "readiness",
  "blockedReasons",
  "restrictionConditions",
  "disputedItems",
  "substantiationRequirements",
  "ownerReservationInputs",
  "acceptedScope",
  "precommissioningChecklist",
  "missingItems",
  "options",
  "recommendation",
  "impact",
  "lineItems",
  "deductionComponents",
  "variationComponents",
  "provisionalSumRules",
]);

const numericFields = new Set([
  "amountClaimed",
  "amountAssessed",
  "amountApproved",
  "daysClaimed",
  "daysAssessed",
  "daysApproved",
]);

const multipleReferenceFields = new Set([
  "noticeRefs",
  "eventRefs",
  "clauseRefs",
  "evidenceRefs",
  "delayEventRefs",
  "impactAnalysisRefs",
]);

const selectableReferenceFields = new Set([
  ...multipleReferenceFields,
  "decisionRef",
  "ownerDecisionRef",
  "reinspectionRef",
  "testResultRef",
  "baselineScheduleRef",
  "baselineRevisionRef",
]);

function refForItem(item: WorkItem): DomainRef | null {
  if (item.machine === "evidence") {
    return {
      objectType: "Evidence",
      objectId: item.record.id,
      version: item.record.version,
    };
  }
  const ref = recordRef(item);
  return ref.objectType === "InformationItem" && item.machine !== "schedule_baseline"
    ? null
    : ref;
}

function referenceOptions(
  field: string,
  workspace: Workspace,
  current: WorkItem,
  currentRequirementLabel: string,
  referenceKind?: "single" | "multiple",
): Array<{ label: string; ref: DomainRef }> {
  if (["decisionRef", "ownerDecisionRef", "decisionRefs"].includes(field)) return completionDecisionReferenceOptions(workspace, current);
  if (["testResultRef", "evidenceRefs", "impactAnalysisRefs", "sourceFileRefs"].includes(field)) return completionReferenceOptions(workspace).filter(option => option.ref.objectType === "Evidence");
  if (["reinspectionRef", "inspectionRefs"].includes(field)) return completionReferenceOptions(workspace).filter(option => option.ref.objectType === "Inspection");
  if (["issueRef", "punchIssueRefs", "openIssueRefs"].includes(field)) return completionReferenceOptions(workspace).filter(option => option.ref.objectType === "Issue");
  if (["actionRef", "remedyActionRefs", "correctiveActionRefs", "correctionActionRefs", "retestBasisRefs"].includes(field)) return completionReferenceOptions(workspace).filter(option => option.ref.objectType === "Action");
  if (["equipmentRef", "equipmentRefs"].includes(field)) return completionReferenceOptions(workspace).filter(option => option.ref.objectType === "Asset" && option.subtype === "Equipment");
  if (!selectableReferenceFields.has(field)) return referenceKind ? completionReferenceOptions(workspace) : [];
  if (field === "clauseRefs") {
    return [{ label: currentRequirementLabel, ref: workspace.context.requirementRef }];
  }

  let candidates = workspace.items;
  if (field === "noticeRefs")
    candidates = candidates.filter((item) => item.machine === "contract_notice");
  else if (field === "eventRefs")
    candidates = candidates.filter(
      (item) =>
        recordRef(item).objectType === "WorkItem" &&
        !["contract_notice", "claim", "eot_request"].includes(item.machine),
    );
  else if (field === "delayEventRefs")
    candidates = candidates.filter((item) => item.machine === "delay_event");
  else if (field === "evidenceRefs" || field === "impactAnalysisRefs")
    candidates = candidates.filter((item) => item.machine === "evidence");
  else if (field === "baselineScheduleRef" || field === "baselineRevisionRef")
    candidates = candidates.filter(
      (item) =>
        item.machine === "schedule_baseline" &&
        item.record.status === "effective" &&
        (field !== "baselineRevisionRef" ||
          item.record.id !==
            (current.record.data?.baselineScheduleRef as DomainRef | undefined)
              ?.objectId),
    );
  else if (field === "reinspectionRef")
    candidates = candidates.filter((item) => item.machine === "inspection");
  else if (field === "testResultRef")
    candidates = candidates.filter((item) => item.machine === "evidence");
  else if (field === "decisionRef" || field === "ownerDecisionRef")
    candidates = candidates.filter((item) => {
      if (item.machine !== "decision") return false;
      const target = item.record.targetRef as DomainRef | undefined;
      return (
        target?.objectId === current.record.id &&
        target?.version === current.record.version
      );
    });

  return candidates.flatMap((item) => {
    const ref = refForItem(item);
    return ref
      ? [
          {
            label: `${item.record.title || item.record.workName || item.machine} · v${item.record.version}`,
            ref,
          },
        ]
      : [];
  });
}

function selectedReferenceValues(value: string): string[] {
  if (!value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as DomainRef[];
    return Array.isArray(parsed) ? parsed.map((ref) => JSON.stringify(ref)) : [];
  } catch {
    return [];
  }
}

function fieldDefault(field: string, w: Workspace, item: WorkItem): string {
  if (field === "ownerReservationInputs") return JSON.stringify(item.record.data?.ownerReservationInputs ?? item.record.data?.reservationProposals ?? [], null, 2);
  const existing =
    item.record.data?.[field] ??
    (item.record.schedule as Record<string, Json> | undefined)?.[field] ??
    (item.record[field] as Json | undefined);
  if (existing !== undefined && existing !== null) {
    return typeof existing === "object"
      ? JSON.stringify(existing, null, 2)
      : String(existing);
  }
  if (scheduleInputs[item.machine]) return "";
  if (field.endsWith("At"))
    return new Date(
      Date.now() + (field === "dueAt" ? 86400000 : 0),
    ).toISOString();
  if (field === "checkResults")
    return JSON.stringify(
      [
        {
          itemId: "dimension",
          requirementRef: w.context.requirementRef,
          result: "pass",
          evidenceIds: item.record.evidenceIds || [],
          measuredValue: 120,
          unit: "mm",
        },
      ],
      null,
      2,
    );
  if (field === "responseInformationRefs" || field === "references")
    return JSON.stringify([w.context.drawingRef], null, 2);
  if (booleanFields.has(field)) return "false";
  if (field === "decision") return "approved";
  if (field === "selectedOption") return "A";
  if (field === "responsibleOrganizationId")
    return w.context.scope.responsibleOrganizationId;
  if (field.endsWith("Ids"))
    return JSON.stringify(item.record[field] || [], null, 2);
  if (field === "verificationGrounding") return "[]";
  return "";
}
export function CommandModal({
  dialog,
  workspace,
  onClose,
  onSubmit,
}: {
  dialog: { item: WorkItem; action: CommandDescriptor };
  workspace: Workspace;
  onClose: () => void;
  onSubmit: (p: Fields, evidenceIds: string[]) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      dialog.action.fields.map((f) => [
        f,
        fieldDefault(f, workspace, dialog.item),
      ]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [evidenceText, setEvidenceText] = useState("");
  const title = commands[dialog.action.command] || dialog.action.command;
  async function submit() {
    setBusy(true);
    setErr("");
    try {
      const payload: Fields = {};
      for (const f of dialog.action.fields) {
        const v = values[f];
        if (!v?.trim()) continue;
        const inputType = commandInputs[dialog.item.machine]?.[dialog.action.command]?.[f]?.type ?? scheduleInputs[dialog.item.machine]?.commandFields[f]?.type;
        if (
          inputType === "integer" ||
          inputType === "number" ||
          (!inputType && numericFields.has(f))
        ) {
          const number = Number(v);
          if (
            !Number.isFinite(number) ||
            (inputType === "integer" && !Number.isInteger(number))
          )
            throw new CommandInputError(
              t("commandModal.numberRequired", {
                field: fields[f] || f,
              }),
            );
          payload[f] = number;
          continue;
        }
        payload[f] = inputType === "boolean" || (!inputType && booleanFields.has(f))
          ? v === "true"
          : inputType === "object" || inputType === "array" || (!inputType && jsonFields.has(f)) ||
              (!inputType && /Ids$|Refs$|Ref$|^references$/.test(f))
            ? (JSON.parse(v) as Json)
            : v;
      }
      const evidenceIds = evidenceText
        .split(/[\s,]+/)
        .map((value) => value.trim())
        .filter(Boolean);
      const uniqueEvidenceIds = [...new Set(evidenceIds)];
      if (dialog.action.requiresEvidence && !uniqueEvidenceIds.length) {
        throw new CommandInputError(t("commandModal.evidenceRequired"));
      }
      await onSubmit(payload, uniqueEvidenceIds);
    } catch (e) {
      setErr(
        e instanceof ApiError
          ? reasonLabel(e.detail.code)
          : e instanceof CommandInputError ? e.message : reasonLabel(),
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
        aria-label={title}
      >
        <div className="section-heading">
          <h2>{title}</h2>
          <button
            className="icon-button"
            aria-label={t("commandModal.closeAria")}
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </div>
        <p className="muted">
          {t("commandModal.basis", {
            version: dialog.item.record.version,
          })}
        </p>
        <div className="modal-fields">
          {dialog.action.fields.map((f) => f === "lineItems" && dialog.item.machine === "contract_boq" ? (
            <BOQLineItemFields key={f} workspace={workspace} value={JSON.parse(values[f] || "[]") as Json[]} onChange={(next) => setValues({ ...values, [f]: JSON.stringify(next) })} />
          ) : f === "ownerReservationInputs" ? (
            <div key={f}>
              <span>{t("completion.reservations")}</span>
              <HandoverReservationFields issues={((dialog.item.record.data?.openIssueRefs ?? []) as DomainRef[]).map((ref) => ({ ref, label: workspace.items.find((item) => item.record.id === ref.objectId)?.record.title ?? ref.objectId }))} participants={workspace.participants} value={JSON.parse(values[f] || "[]") as ReservationInput[]} onChange={(next) => setValues({ ...values, [f]: JSON.stringify(next) })} />
            </div>
          ) : (
            <label key={f}>
              {fields[f] || f}
              {f === "decision" ? (
                <select
                  value={values[f]}
                  onChange={(e) =>
                    setValues({ ...values, [f]: e.target.value })
                  }
                >
                  <option value="approved">
                    {t("commandModal.decision.approved")}
                  </option>
                  <option value="rejected">
                    {t("commandModal.decision.rejected")}
                  </option>
                  <option value="returned">
                    {t("commandModal.decision.returned")}
                  </option>
                </select>
              ) : f === "changeRequired" ? (
                <select
                  value={values[f]}
                  onChange={(e) =>
                    setValues({ ...values, [f]: e.target.value })
                  }
                >
                  <option value="false">
                    {t("commandModal.changeRequired.false")}
                  </option>
                  <option value="true">
                    {t("commandModal.changeRequired.true")}
                  </option>
                </select>
              ) : (commandInputs[dialog.item.machine]?.[dialog.action.command]?.[f]?.type === "boolean" || booleanFields.has(f) || scheduleInputs[dialog.item.machine]?.commandFields[f]?.type === "boolean") ? (
                <select
                  value={values[f]}
                  onChange={(e) =>
                    setValues({ ...values, [f]: e.target.value })
                  }
                >
                  {scheduleInputs[dialog.item.machine] && (
                    <option value="">{t("commandModal.select")}</option>
                  )}
                  <option value="false">{t("common.no")}</option>
                  <option value="true">{t("common.yes")}</option>
                </select>
              ) : f === "responsiblePartyId" ? (
                <select
                  value={values[f]}
                  onChange={(e) =>
                    setValues({ ...values, [f]: e.target.value })
                  }
                >
                  <option value="">{t("commandModal.partySelect")}</option>
                  {workspace.participants.map((p) => (
                    <option value={p.partyId} key={p.partyId}>
                      {roles[p.actorGroup]} · {p.name}
                    </option>
                  ))}
                </select>
              ) : referenceOptions(
                  f,
                  workspace,
                  dialog.item,
                  t("commandModal.currentRequirement"),
                  commandInputs[dialog.item.machine]?.[dialog.action.command]?.[f]?.reference,
                ).length ? (
                <select
                  aria-label={fields[f] || f}
                  multiple={(commandInputs[dialog.item.machine]?.[dialog.action.command]?.[f]?.reference === "multiple" || multipleReferenceFields.has(f))}
                  value={
                    (commandInputs[dialog.item.machine]?.[dialog.action.command]?.[f]?.reference === "multiple" || multipleReferenceFields.has(f))
                      ? selectedReferenceValues(values[f])
                      : values[f]
                  }
                  onChange={(e) => {
                    if ((commandInputs[dialog.item.machine]?.[dialog.action.command]?.[f]?.reference === "multiple" || multipleReferenceFields.has(f))) {
                      const refs = Array.from(e.currentTarget.selectedOptions).map(
                        (option) => JSON.parse(option.value) as DomainRef,
                      );
                      setValues({
                        ...values,
                        [f]: JSON.stringify(refs, null, 2),
                      });
                    } else {
                      setValues({ ...values, [f]: e.target.value });
                    }
                  }}
                >
                  {!(commandInputs[dialog.item.machine]?.[dialog.action.command]?.[f]?.reference === "multiple" || multipleReferenceFields.has(f)) && (
                    <option value="">{t("commandModal.referenceSelect")}</option>
                  )}
                  {referenceOptions(
                    f,
                    workspace,
                    dialog.item,
                    t("commandModal.currentRequirement"),
                  commandInputs[dialog.item.machine]?.[dialog.action.command]?.[f]?.reference,
                  ).map(
                    ({ label, ref }) => {
                      const value = JSON.stringify(ref);
                      return (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      );
                    },
                  )}
                </select>
              ) : (
                <textarea
                  rows={f === "checkResults" ? 8 : f.endsWith("At") ? 1 : 3}
                  value={values[f]}
                  onChange={(e) =>
                    setValues({ ...values, [f]: e.target.value })
                  }
                  placeholder={
                    f.endsWith("At")
                      ? t("commandModal.timeHint")
                      : fields[f] || f
                  }
                />
              )}
            </label>
          ))}
        </div>
        {dialog.action.requiresEvidence ? (
          <div className="modal-fields">
            <label>
              {t("commandModal.evidenceIds")}
              <textarea
                rows={2}
                value={evidenceText}
                onChange={(e) => setEvidenceText(e.target.value)}
                placeholder={t("commandModal.evidencePlaceholder")}
                aria-label={t("commandModal.evidenceIds")}
              />
              <span className="muted">
                {t("commandModal.evidenceHelp")}
              </span>
            </label>
          </div>
        ) : null}
        {!dialog.action.fields.length && (
          <div className="notice">{t("commandModal.warning")}</div>
        )}
        {err && (
          <div role="alert" className="error-box">
            {err}
          </div>
        )}
        <div className="modal-actions">
          <button className="secondary" onClick={onClose} disabled={busy}>
            {t("commandModal.cancel")}
          </button>
          <button
            className="primary"
            onClick={() => void submit()}
            disabled={busy}
          >
            {busy
              ? t("commandModal.validating")
              : t("commandModal.execute")}
          </button>
        </div>
      </section>
    </div>
  );
}
