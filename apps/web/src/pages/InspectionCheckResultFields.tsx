import { useTranslation } from "react-i18next";
import type { DomainRef, Json, RecordDTO, WorkItem, Workspace } from "../data/ui-contract";

type Locale = "ko" | "vi" | "en";
type JsonObject = { [key: string]: Json };
type CheckResultRow = JsonObject & {
  itemId?: string;
  requirementRef?: Json;
  measuredValue?: number | string;
  unit?: string;
  result?: string;
  evidenceIds?: string[];
  note?: string;
};
type RequirementChoice = { ref: DomainRef; title: string; requiredFields: string[] };
type EvidenceChoice = { id: string; version?: number; title: string };

const copy: Record<Locale, Record<string, string>> = {
  ko: {
    title: "검측 항목 결과",
    description: "서버가 선언한 요구 항목과 원본 기준 참조를 표시합니다. 판정과 증빙은 사용자가 직접 입력해야 합니다.",
    itemId: "검측 항목 ID",
    requirement: "요구사항 기준",
    measuredValue: "측정값",
    unit: "단위",
    result: "판정",
    chooseResult: "판정 선택",
    pass: "합격",
    fail: "불합격",
    notApplicable: "해당 없음",
    evidence: "열람 가능한 증빙",
    evidenceHint: "증빙을 여러 개 선택할 수 있습니다.",
    note: "비고 (선택)",
    addRow: "추가 검측 결과",
    removeRow: "결과 행 삭제",
    noRequirement: "이 검측에 연결된 요구사항 기준이 없습니다. 기존 결과가 있으면 해당 원본 값을 유지합니다.",
    noEvidence: "현재 작업공간에서 선택할 수 있는 증빙이 없습니다.",
    savedUnavailableEvidence: "현재 열람할 수 없는 기존 증빙 ID",
    savedRequirementUnavailable: "현재 목록에서 확인할 수 없는 저장된 요구사항 참조",
    emptyItem: "항목 ID를 입력하십시오.",
    blankResult: "판정 미입력",
  },
  vi: {
    title: "Kết quả từng hạng mục nghiệm thu",
    description: "Hiển thị hạng mục do máy chủ khai báo và tham chiếu tiêu chuẩn nguồn. Người dùng phải tự nhập kết quả và bằng chứng.",
    itemId: "ID hạng mục nghiệm thu",
    requirement: "Tiêu chuẩn yêu cầu",
    measuredValue: "Giá trị đo",
    unit: "Đơn vị",
    result: "Kết quả",
    chooseResult: "Chọn kết quả",
    pass: "Đạt",
    fail: "Không đạt",
    notApplicable: "Không áp dụng",
    evidence: "Bằng chứng có thể xem",
    evidenceHint: "Có thể chọn nhiều bằng chứng.",
    note: "Ghi chú (tùy chọn)",
    addRow: "Thêm kết quả nghiệm thu",
    removeRow: "Xóa dòng kết quả",
    noRequirement: "Không có tiêu chuẩn yêu cầu nào được liên kết với lần nghiệm thu này. Nếu đã có kết quả, giá trị nguồn hiện tại sẽ được giữ nguyên.",
    noEvidence: "Không có bằng chứng nào trong không gian làm việc hiện tại để chọn.",
    savedUnavailableEvidence: "ID bằng chứng đã lưu nhưng hiện không thể xem",
    savedRequirementUnavailable: "Tham chiếu yêu cầu đã lưu nhưng không có trong danh sách hiện tại",
    emptyItem: "Nhập ID hạng mục.",
    blankResult: "Chưa nhập kết quả",
  },
  en: {
    title: "Inspection item results",
    description: "Shows server-declared items and their source requirement references. The user must enter each result and evidence explicitly.",
    itemId: "Inspection item ID",
    requirement: "Requirement basis",
    measuredValue: "Measured value",
    unit: "Unit",
    result: "Result",
    chooseResult: "Select a result",
    pass: "Pass",
    fail: "Fail",
    notApplicable: "Not applicable",
    evidence: "Readable evidence",
    evidenceHint: "You can select more than one evidence item.",
    note: "Note (optional)",
    addRow: "Add inspection result",
    removeRow: "Remove result row",
    noRequirement: "No requirement basis is linked to this inspection. Existing results, if any, retain their source values.",
    noEvidence: "No evidence is available to select in the current workspace.",
    savedUnavailableEvidence: "Saved evidence ID is not currently readable",
    savedRequirementUnavailable: "Saved requirement reference is not in the current list",
    emptyItem: "Enter an item ID.",
    blankResult: "No result entered",
  },
};

function isObject(value: Json): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactRef(left: unknown, right: DomainRef) {
  if (!left || typeof left !== "object" || Array.isArray(left)) return false;
  const candidate = left as Partial<DomainRef>;
  return candidate.objectType === right.objectType
    && candidate.objectId === right.objectId
    && candidate.version === right.version;
}

function refKey(ref: DomainRef) {
  return `${ref.objectType}:${ref.objectId}:${ref.version}`;
}

function formatRef(ref: DomainRef) {
  return `${ref.objectType} · ${ref.objectId} · v${ref.version}`;
}

function recordTitle(record: RecordDTO) {
  const metadataName = record.metadata?.name;
  return [record.title, record.workName, record.name, metadataName].find((candidate): candidate is string => typeof candidate === "string" && !!candidate) || record.id;
}

function requirementChoices(workspace: Workspace, item: WorkItem): RequirementChoice[] {
  const baselineRefs = item.record.requirementRefs || [];
  const catalog = workspace.context.referenceCatalog?.requirements || [];
  const choices: RequirementChoice[] = [];
  for (const ref of baselineRefs) {
    const entry = catalog.find((candidate) => exactRef(candidate.ref, ref));
    if (!entry) continue;
    const rawFields = entry.record.requiredFields;
    const requiredFields = Array.isArray(rawFields)
      ? rawFields.filter((field): field is string => typeof field === "string" && !!field.trim())
      : [];
    choices.push({ ref, title: recordTitle(entry.record), requiredFields });
  }
  return choices;
}

function evidenceChoices(workspace: Workspace): EvidenceChoice[] {
  const catalog = workspace.context.referenceCatalog?.evidence;
  if (catalog) {
    return catalog.map(({ ref, record }) => ({ id: ref.objectId, version: ref.version, title: recordTitle(record) }));
  }
  return workspace.items.filter((candidate) => candidate.machine === "evidence").map((candidate) => ({
    id: candidate.record.id,
    version: candidate.record.version,
    title: recordTitle(candidate.record),
  }));
}

function selectedEvidence(row: CheckResultRow): string[] {
  return Array.isArray(row.evidenceIds)
    ? row.evidenceIds.filter((id): id is string => typeof id === "string")
    : [];
}

export function InspectionCheckResultFields({ workspace, item, value, onChange }: {
  workspace: Workspace;
  item: WorkItem;
  value: Json[];
  onChange: (next: Json[]) => void;
}) {
  const { i18n } = useTranslation();
  const language = (i18n.resolvedLanguage ?? i18n.language).slice(0, 2);
  const locale: Locale = language === "ko" || language === "vi" ? language : "en";
  const tx = (key: string) => copy[locale][key] || copy.en[key] || key;
  const requirements = requirementChoices(workspace, item);
  const evidence = evidenceChoices(workspace);
  const savedRows = value.map((row) => isObject(row) ? row as CheckResultRow : null);
  const requiredByItemId = new Map<string, { itemId: string; requirementRefs: DomainRef[] }>();
  for (const requirement of requirements) {
    for (const itemId of requirement.requiredFields) {
      const existing = requiredByItemId.get(itemId);
      if (existing) {
        if (!existing.requirementRefs.some((ref) => exactRef(ref, requirement.ref))) existing.requirementRefs.push(requirement.ref);
      } else {
        requiredByItemId.set(itemId, { itemId, requirementRefs: [requirement.ref] });
      }
    }
  }
  const requiredRows = [...requiredByItemId.values()];
  const matchedSavedIndices = new Set<number>();
  const declaredRows = requiredRows.map((required) => {
    const storedIndex = savedRows.findIndex((row, index) => !matchedSavedIndices.has(index) && row?.itemId === required.itemId);
    if (storedIndex >= 0) {
      matchedSavedIndices.add(storedIndex);
      return { row: savedRows[storedIndex] as CheckResultRow, storedIndex, required: true };
    }
    return {
      row: { itemId: required.itemId, requirementRef: { ...required.requirementRefs[0] } } as CheckResultRow,
      storedIndex: null,
      required: true,
    };
  });
  const extraRows = savedRows.flatMap((row, storedIndex) => matchedSavedIndices.has(storedIndex)
    ? []
    : [{ row: row || {}, storedIndex, required: false }]);
  const rows: Array<{ row: CheckResultRow; storedIndex: number | null; required: boolean }> = [...declaredRows, ...extraRows];

  function updateRow(index: number, patch: Partial<CheckResultRow>) {
    const target = rows[index];
    if (!target) return;
    if (target.storedIndex === null) {
      const nextRow = { ...target.row, ...patch } as CheckResultRow;
      onChange([...value, nextRow as Json]);
      return;
    }
    onChange(value.map((saved, savedIndex) => {
      if (savedIndex !== target.storedIndex || !isObject(saved)) return saved;
      return { ...saved, ...patch } as Json;
    }));
  }

  function clearOptionalField(index: number, field: "measuredValue" | "result" | "requirementRef") {
    const target = rows[index];
    if (!target) return;
    const remaining = { ...target.row };
    delete remaining[field];
    if (target.storedIndex === null) {
      onChange([...value, remaining as Json]);
      return;
    }
    onChange(value.map((saved, savedIndex) => {
      if (savedIndex !== target.storedIndex || !isObject(saved)) return saved;
      const savedRemaining = { ...saved };
      delete savedRemaining[field];
      return savedRemaining;
    }));
  }

  function addRow() {
    onChange([...value, { itemId: "" }]);
  }

  function removeRow(index: number) {
    const target = rows[index];
    if (target?.storedIndex === null || target?.storedIndex === undefined) return;
    onChange(value.filter((_saved, savedIndex) => savedIndex !== target.storedIndex));
  }

  return <section className="grid gap-3" data-ui-component="inspection-check-result-fields">
    <header>
      <h3 className="font-semibold">{tx("title")}</h3>
      <p className="muted">{tx("description")}</p>
    </header>
    {!requirements.length && <p className="muted">{tx("noRequirement")}</p>}
    {!evidence.length && <p className="muted">{tx("noEvidence")}</p>}
    <div className="grid gap-3">
      {rows.map(({ row, storedIndex, required }, index) => {
        const result = typeof row.result === "string" ? row.result : "";
        const measured = typeof row.measuredValue === "string" || typeof row.measuredValue === "number" ? String(row.measuredValue) : "";
        const selectedIds = selectedEvidence(row);
        const requirementRef = row.requirementRef && typeof row.requirementRef === "object" && !Array.isArray(row.requirementRef)
          ? row.requirementRef as unknown as DomainRef : null;
        const knownRef = requirementRef && requirements.some((candidate) => exactRef(candidate.ref, requirementRef));
        const currentRequirementKey = requirementRef ? refKey(requirementRef) : "";
        const rowKey = required ? `required:${row.itemId || index}` : `stored:${storedIndex}`;
        return <fieldset className="grid gap-3 rounded border p-3" key={rowKey}>
          <legend className="px-1">{tx("itemId")} · {index + 1}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {required ? <label className="grid gap-1">{tx("itemId")}<input readOnly value={row.itemId || ""} placeholder={tx("emptyItem")} /></label>
              : <label className="grid gap-1">{tx("itemId")}<input value={row.itemId || ""} placeholder={tx("emptyItem")} onChange={(event) => updateRow(index, { itemId: event.target.value })} /></label>}
            <label className="grid gap-1">{tx("requirement")}
              <select value={currentRequirementKey} onChange={(event) => {
                const selected = requirements.find((candidate) => refKey(candidate.ref) === event.target.value);
                if (selected) updateRow(index, { requirementRef: { ...selected.ref } });
                else if (!event.target.value) clearOptionalField(index, "requirementRef");
              }}>
                <option value="">{tx("requirement")}</option>
                {requirementRef && !knownRef && <option value={currentRequirementKey} disabled>{tx("savedRequirementUnavailable")}: {formatRef(requirementRef)}</option>}
                {requirements.map((requirement) => <option key={refKey(requirement.ref)} value={refKey(requirement.ref)}>{requirement.title} · {formatRef(requirement.ref)}</option>)}
              </select>
              {requirementRef && <small>{formatRef(requirementRef)}</small>}
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1">{tx("measuredValue")}
              <input inputMode="decimal" value={measured} onChange={(event) => event.target.value === "" ? clearOptionalField(index, "measuredValue") : updateRow(index, { measuredValue: event.target.value })} />
            </label>
            <label className="grid gap-1">{tx("unit")}<input value={typeof row.unit === "string" ? row.unit : ""} onChange={(event) => updateRow(index, { unit: event.target.value })} /></label>
          </div>
          <label className="grid gap-1">{tx("result")}
            <select value={result} onChange={(event) => event.target.value === "" ? clearOptionalField(index, "result") : updateRow(index, { result: event.target.value })}>
              <option value="">{tx("chooseResult")}</option>
              {result && !["pass", "fail", "not_applicable"].includes(result) && <option value={result} disabled>{result}</option>}
              <option value="pass">{tx("pass")}</option>
              <option value="fail">{tx("fail")}</option>
              <option value="not_applicable">{tx("notApplicable")}</option>
            </select>
          </label>
          <label className="grid gap-1">{tx("evidence")}
            <select multiple size={Math.min(Math.max(evidence.length, 2), 5)} value={selectedIds} onChange={(event) => updateRow(index, { evidenceIds: Array.from(event.currentTarget.selectedOptions, (option) => option.value) })}>
              {selectedIds.filter((id) => !evidence.some((candidate) => candidate.id === id)).map((id) => <option key={id} value={id} disabled>{tx("savedUnavailableEvidence")}: {id}</option>)}
              {evidence.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title} · {candidate.id}{candidate.version == null ? "" : ` · v${candidate.version}`}</option>)}
            </select>
            <small>{tx("evidenceHint")}</small>
          </label>
          <label className="grid gap-1">{tx("note")}<textarea rows={2} value={typeof row.note === "string" ? row.note : ""} onChange={(event) => updateRow(index, { note: event.target.value })} /></label>
          {storedIndex !== null && <button type="button" className="justify-self-start text-sm underline" onClick={() => removeRow(index)}>{tx("removeRow")}</button>}
        </fieldset>;
      })}
    </div>
    {!!requirements.length && <button type="button" className="justify-self-start text-sm underline" onClick={addRow}>{tx("addRow")}</button>}
  </section>;
}
