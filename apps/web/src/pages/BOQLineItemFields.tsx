import type { Json, Workspace } from "../data/ui-contract";

type Props = {
  value: Json[];
  onChange(value: Json[]): void;
  workspace?: Workspace;
};

type LineItem = Record<string, Json>;
type LabelKey =
  | "title"
  | "addLine"
  | "removeLine"
  | "itemId"
  | "itemNo"
  | "description"
  | "unit"
  | "quantity"
  | "unitRate"
  | "contractAmount"
  | "packageId"
  | "discipline"
  | "locationScope"
  | "measurementRule"
  | "objectType"
  | "objectId"
  | "version"
  | "variationEligible"
  | "provisional";

const labels: Record<"en" | "ko" | "vi", Record<LabelKey, string>> = {
  en: {
    title: "BOQ line items",
    addLine: "Add line item",
    removeLine: "Remove line",
    itemId: "Stable item ID",
    itemNo: "Item number",
    description: "Description",
    unit: "Unit",
    quantity: "Contract quantity",
    unitRate: "Unit rate",
    contractAmount: "Contract amount",
    packageId: "Package ID (UUID)",
    discipline: "Discipline",
    locationScope: "Location scope (UUIDs, comma separated)",
    measurementRule: "Measurement rule reference",
    objectType: "Object type",
    objectId: "Object ID",
    version: "Version",
    variationEligible: "Eligible for variation",
    provisional: "Provisional item",
  },
  ko: {
    title: "내역서 항목",
    addLine: "항목 추가",
    removeLine: "항목 삭제",
    itemId: "고정 항목 ID",
    itemNo: "항목 번호",
    description: "설명",
    unit: "단위",
    quantity: "계약 수량",
    unitRate: "단가",
    contractAmount: "계약 금액",
    packageId: "패키지 ID (UUID)",
    discipline: "공종",
    locationScope: "위치 범위 (UUID, 쉼표로 구분)",
    measurementRule: "기성 측정 규칙 참조",
    objectType: "객체 유형",
    objectId: "객체 ID",
    version: "버전",
    variationEligible: "변경 대상 가능",
    provisional: "잠정 항목",
  },
  vi: {
    title: "Các hạng mục BOQ",
    addLine: "Thêm hạng mục",
    removeLine: "Xóa hạng mục",
    itemId: "Mã hạng mục cố định",
    itemNo: "Số hạng mục",
    description: "Mô tả",
    unit: "Đơn vị",
    quantity: "Khối lượng hợp đồng",
    unitRate: "Đơn giá",
    contractAmount: "Giá trị hợp đồng",
    packageId: "Mã gói (UUID)",
    discipline: "Chuyên ngành",
    locationScope: "Phạm vi vị trí (UUID, phân tách bằng dấu phẩy)",
    measurementRule: "Tham chiếu quy tắc đo lường",
    objectType: "Loại đối tượng",
    objectId: "Mã đối tượng",
    version: "Phiên bản",
    variationEligible: "Đủ điều kiện thay đổi",
    provisional: "Hạng mục tạm tính",
  },
};

function objectValue(value: Json): LineItem | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as LineItem;
}

function refValue(item: LineItem): Record<string, Json> {
  const ref = item.measurementRuleRef;
  return typeof ref === "object" && ref !== null && !Array.isArray(ref)
    ? (ref as Record<string, Json>)
    : {};
}

function textValue(value: Json | undefined): string {
  return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
}

export function BOQLineItemFields({ value, onChange, workspace }: Props) {
  const locale = typeof document !== "undefined" ? document.documentElement.lang.slice(0, 2) : "en";
  const t = labels[locale === "ko" || locale === "vi" ? locale : "en"];
  const rows = value.map((item, index) => ({ item: objectValue(item), key: objectValue(item)?.boqItemId ?? `row-${index}` }));

  function update(index: number, patch: Partial<LineItem>) {
    onChange(value.map((raw, rowIndex) => {
      if (rowIndex !== index) return raw;
      const current = objectValue(raw);
      const next: Record<string, Json> = { ...(current ?? {}) };
      for (const [field, fieldValue] of Object.entries(patch)) {
        if (fieldValue !== undefined) next[field] = fieldValue;
      }
      return next;
    }));
  }

  function updateReference(index: number, patch: Record<string, Json>) {
    const item = objectValue(value[index]);
    if (!item) return;
    update(index, { measurementRuleRef: { ...refValue(item), ...patch } });
  }

  function addLine() {
    const newItem: LineItem = {
      boqItemId: crypto.randomUUID(),
      itemNo: "",
      description: "",
      unit: "",
      contractQuantity: "",
      unitRate: "",
      contractAmount: "",
      packageId: workspace?.context.scope.packageId ?? "",
      discipline: workspace?.context.scope.discipline ?? "",
      locationScope: workspace?.context.scope.locationId ? [workspace.context.scope.locationId] : [],
      measurementRuleRef: { objectType: "", objectId: "", version: 0 },
      variationEligible: false,
      provisional: false,
    };
    onChange([...value, newItem]);
  }

  const inputClass = "w-full rounded-md border bg-background px-3 py-2 text-sm";
  const fieldClass = "grid gap-1 text-sm";

  return (
    <section className="grid gap-3" aria-label={t.title}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-medium">{t.title}</h3>
        <button type="button" className="rounded-md border px-3 py-2 text-sm" onClick={addLine}>{t.addLine}</button>
      </div>
      {rows.map(({ item, key }, index) => {
        const row = item ?? {};
        const reference = refValue(row);
        const locationScope = Array.isArray(row.locationScope) ? row.locationScope.map(textValue).join(", ") : "";
        return (
          <fieldset key={String(key)} data-boq-item-id={textValue(row.boqItemId)} className="grid gap-3 rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">{textValue(row.itemNo) || `${t.itemNo} ${index + 1}`}</legend>
            {!workspace && <label className={fieldClass}>{t.itemId}<input className={inputClass} value={textValue(row.boqItemId)} readOnly /></label>}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={fieldClass}>{t.itemNo}<input className={inputClass} value={textValue(row.itemNo)} onChange={event => update(index, { itemNo: event.target.value })} /></label>
              <label className={fieldClass}>{t.unit}<input className={inputClass} value={textValue(row.unit)} onChange={event => update(index, { unit: event.target.value })} /></label>
            </div>
            <label className={fieldClass}>{t.description}<textarea className={inputClass} rows={2} value={textValue(row.description)} onChange={event => update(index, { description: event.target.value })} /></label>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className={fieldClass}>{t.quantity}<input className={inputClass} inputMode="decimal" value={textValue(row.contractQuantity)} onChange={event => update(index, { contractQuantity: event.target.value })} /></label>
              <label className={fieldClass}>{t.unitRate}<input className={inputClass} inputMode="decimal" value={textValue(row.unitRate)} onChange={event => update(index, { unitRate: event.target.value })} /></label>
              <label className={fieldClass}>{t.contractAmount}<input className={inputClass} inputMode="decimal" value={textValue(row.contractAmount)} onChange={event => update(index, { contractAmount: event.target.value })} /></label>
            </div>
            {!workspace && <div className="grid gap-3 sm:grid-cols-2">
              <label className={fieldClass}>{t.packageId}<input className={inputClass} value={textValue(row.packageId)} onChange={event => update(index, { packageId: event.target.value })} /></label>
              <label className={fieldClass}>{t.discipline}<input className={inputClass} value={textValue(row.discipline)} onChange={event => update(index, { discipline: event.target.value })} /></label>
            </div>}
            {!workspace && <label className={fieldClass}>{t.locationScope}<input className={inputClass} value={locationScope} onChange={event => update(index, { locationScope: event.target.value.split(",").map(part => part.trim()).filter(Boolean) })} /></label>}
            <fieldset className="grid gap-3 rounded-md border p-3">
              <legend className="px-1 text-sm">{t.measurementRule}</legend>
              {workspace ? <select aria-label={t.measurementRule} className={inputClass} value={reference.objectId ? JSON.stringify(reference) : ""} onChange={(event) => update(index, { measurementRuleRef: event.target.value ? JSON.parse(event.target.value) as Json : {} })}>
                <option value="">—</option>
                {(workspace.context.referenceCatalog?.requirements ?? []).map((entry) => <option key={JSON.stringify(entry.ref)} value={JSON.stringify(entry.ref)}>{String(entry.record.title ?? entry.ref.objectId)} · v{entry.ref.version}</option>)}
              </select> : <div className="grid gap-3 sm:grid-cols-3">
                <label className={fieldClass}>{t.objectType}<input className={inputClass} value={textValue(reference.objectType)} onChange={event => updateReference(index, { objectType: event.target.value })} /></label>
                <label className={fieldClass}>{t.objectId}<input className={inputClass} value={textValue(reference.objectId)} onChange={event => updateReference(index, { objectId: event.target.value })} /></label>
                <label className={fieldClass}>{t.version}<input className={inputClass} inputMode="numeric" value={textValue(reference.version)} onChange={event => {
                  const versionText = event.target.value;
                  updateReference(index, { version: /^\d+$/.test(versionText) ? Number.parseInt(versionText, 10) : 0 });
                }} /></label>
              </div>}
            </fieldset>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={row.variationEligible === true} onChange={event => update(index, { variationEligible: event.target.checked })} />{t.variationEligible}</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={row.provisional === true} onChange={event => update(index, { provisional: event.target.checked })} />{t.provisional}</label>
              <button type="button" className="ml-auto rounded-md border px-3 py-2 text-sm" onClick={() => onChange(value.filter((_, rowIndex) => rowIndex !== index))}>{t.removeLine}</button>
            </div>
          </fieldset>
        );
      })}
    </section>
  );
}

export default BOQLineItemFields;
