import { scheduleInputs } from "../data/schedule-fields.generated";
import { useState } from "react";
import type {
  CommandDescriptor,
  Fields,
  Json,
  WorkItem,
  Workspace,
} from "../data/ui-contract";
import { ApiError } from "../data/supervision-client";
import { commands, fields, reasonLabel, roles } from "../labels";
import { Icon } from "./shared";

const booleanFields = new Set([
  "changeRequired",
  "safetyReviewComplete",
  "prestartVerified",
  "completionConfirmed",
  "preUseCheckComplete",
]);

const jsonFields = new Set([
  "checkResults",
  "verificationGrounding",
  "conditions",
  "readiness",
  "blockedReasons",
  "restrictionConditions",
]);

function fieldDefault(field: string, w: Workspace, item: WorkItem): string {
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
        const inputType = scheduleInputs[dialog.item.machine]?.commandFields[f]?.type;
        if (inputType === "integer" || inputType === "number") {
          const number = Number(v);
          if (!Number.isFinite(number) || (inputType === "integer" && !Number.isInteger(number)))
            throw new Error(`${fields[f] || f}: 숫자를 입력하십시오.`);
          payload[f] = number;
          continue;
        }
        payload[f] = inputType === "boolean" || booleanFields.has(f)
          ? v === "true"
          : inputType === "object" || inputType === "array" || jsonFields.has(f) ||
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
        throw new Error("이 명령에는 현재 단계의 증빙 ID가 필요합니다.");
      }
      await onSubmit(payload, uniqueEvidenceIds);
    } catch (e) {
      setErr(
        e instanceof ApiError
          ? reasonLabel(e.detail.code) + " " + e.message
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
        aria-label={title}
      >
        <div className="section-heading">
          <h2>{title}</h2>
          <button
            className="icon-button"
            aria-label="대화상자 닫기"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </div>
        <p className="muted">
          원본 v{dialog.item.record.version} 기준 · 제출할 때 권한과 선행조건을
          다시 검증합니다.
        </p>
        <div className="modal-fields">
          {dialog.action.fields.map((f) => (
            <label key={f}>
              {fields[f] || f}
              {f === "decision" ? (
                <select
                  value={values[f]}
                  onChange={(e) =>
                    setValues({ ...values, [f]: e.target.value })
                  }
                >
                  <option value="approved">승인</option>
                  <option value="rejected">거절</option>
                  <option value="returned">보완 요청</option>
                </select>
              ) : f === "changeRequired" ? (
                <select
                  value={values[f]}
                  onChange={(e) =>
                    setValues({ ...values, [f]: e.target.value })
                  }
                >
                  <option value="false">필요 없음</option>
                  <option value="true">설계변경 필요</option>
                </select>
              ) : (booleanFields.has(f) || scheduleInputs[dialog.item.machine]?.commandFields[f]?.type === "boolean") ? (
                <select
                  value={values[f]}
                  onChange={(e) =>
                    setValues({ ...values, [f]: e.target.value })
                  }
                >
                  {scheduleInputs[dialog.item.machine] && <option value="">선택</option>}
                  <option value="false">아니오</option>
                  <option value="true">예</option>
                </select>
              ) : f === "responsiblePartyId" ? (
                <select
                  value={values[f]}
                  onChange={(e) =>
                    setValues({ ...values, [f]: e.target.value })
                  }
                >
                  <option value="">담당자 선택</option>
                  {workspace.participants.map((p) => (
                    <option value={p.partyId} key={p.partyId}>
                      {roles[p.actorGroup]} · {p.name}
                    </option>
                  ))}
                </select>
              ) : (
                <textarea
                  rows={f === "checkResults" ? 8 : f.endsWith("At") ? 1 : 3}
                  value={values[f]}
                  onChange={(e) =>
                    setValues({ ...values, [f]: e.target.value })
                  }
                  placeholder={
                    f.endsWith("At") ? "RFC3339 · 시간대 포함" : fields[f] || f
                  }
                />
              )}
            </label>
          ))}
        </div>
        {dialog.action.requiresEvidence ? (
          <div className="modal-fields">
            <label>
              명령 증빙 ID
              <textarea
                rows={2}
                value={evidenceText}
                onChange={(e) => setEvidenceText(e.target.value)}
                placeholder="예: EVD-001, EVD-002"
                aria-label="명령 증빙 ID"
              />
              <span className="muted">
                이 명령 단계의 근거를 명시하십시오. 기존 기록의 증빙은 자동 재사용하지 않습니다.
              </span>
            </label>
          </div>
        ) : null}
        {!dialog.action.fields.length && (
          <div className="notice">
            이 동작은 서버에 기록됩니다. 근거와 현재 상태를 확인한 뒤
            실행하십시오.
          </div>
        )}
        {err && (
          <div role="alert" className="error-box">
            {err}
          </div>
        )}
        <div className="modal-actions">
          <button className="secondary" onClick={onClose} disabled={busy}>
            취소
          </button>
          <button
            className="primary"
            onClick={() => void submit()}
            disabled={busy}
          >
            {busy ? "검증 중…" : "확인 후 실행"}
          </button>
        </div>
      </section>
    </div>
  );
}
