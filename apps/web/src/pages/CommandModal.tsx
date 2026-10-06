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
    (item.record[field] as Json | undefined);
  if (existing !== undefined && existing !== null) {
    return typeof existing === "object"
      ? JSON.stringify(existing, null, 2)
      : String(existing);
  }
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
  onSubmit: (p: Fields) => Promise<void>;
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
  const title = commands[dialog.action.command] || dialog.action.command;
  async function submit() {
    setBusy(true);
    setErr("");
    try {
      const payload: Fields = {};
      for (const f of dialog.action.fields) {
        const v = values[f];
        if (!v?.trim()) continue;
        payload[f] = booleanFields.has(f)
          ? v === "true"
          : jsonFields.has(f) ||
              /Ids$|Refs$|Ref$|^references$/.test(f)
            ? (JSON.parse(v) as Json)
            : v;
      }
      await onSubmit(payload);
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
              ) : booleanFields.has(f) ? (
                <select
                  value={values[f]}
                  onChange={(e) =>
                    setValues({ ...values, [f]: e.target.value })
                  }
                >
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
