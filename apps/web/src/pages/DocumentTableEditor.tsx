import { useTranslation } from "react-i18next";
import { formFieldLabel } from "@doul/localization";
import type { FormSchema } from "../data/ui-contract";

export type DocumentTableValues = Record<string, Record<string, string> | Array<Record<string, string>>>;

export function serializeDocumentTables(schema: FormSchema, values: DocumentTableValues): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const table of schema.tables) {
    const current = values[table.path];
    if (table.type === "review_table" || table.type === "check_table") {
      const source = current && !Array.isArray(current) ? current : {};
      output[table.path] = Object.fromEntries(table.columns.map((column) => [column, source[column] ?? ""]));
    } else {
      const source = Array.isArray(current) ? current : [];
      output[table.path] = source.map((row) =>
        Object.fromEntries(table.columns.map((column) => [column, row[column] ?? ""]))
      );
    }
  }
  return output;
}

export function DocumentTableEditor({ schema, values, onChange }: {
  schema: FormSchema;
  values: DocumentTableValues;
  onChange: (values: DocumentTableValues) => void;
}) {
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language;
  const vi = language.startsWith("vi");
  const ko = language.startsWith("ko");
  const label = (path: string) => formFieldLabel(path, language);
  const setColumn = (path: string, column: string, value: string) => {
    const current = values[path];
    const original = current && !Array.isArray(current) ? current : {};
    onChange({ ...values, [path]: { ...original, [column]: value } });
  };
  const setRow = (path: string, index: number, column: string, value: string) => {
    const current = values[path];
    const rows = Array.isArray(current) ? current : [];
    onChange({ ...values, [path]: rows.map((row, n) => n === index ? { ...row, [column]: value } : row) });
  };
  const addRow = (table: FormSchema["tables"][number]) => {
    const current = values[table.path];
    const rows = Array.isArray(current) ? current : [];
    onChange({ ...values, [table.path]: [...rows, Object.fromEntries(table.columns.map((column) => [column, ""]))] });
  };
  const removeRow = (path: string, index: number) => {
    const current = values[path];
    const rows = Array.isArray(current) ? current : [];
    onChange({ ...values, [path]: rows.filter((_, n) => n !== index) });
  };
  return <div className="document-editable-tables">
    {schema.tables.map((table) => {
      const review = table.type === "review_table" || table.type === "check_table";
      const current = values[table.path];
      const rows = Array.isArray(current) ? current : [];
      const cols: Record<string, string> = review && current && !Array.isArray(current) ? current : {};
      return <fieldset key={table.path} className="document-editable-table">
        <legend>{ko ? "표 입력" : vi ? "Nhập bảng" : "Table"} · {label(table.path)}</legend>
        {review ? table.columns.map((column) => (
          <label key={column}>
            {label(table.path + "." + column)}
            <input aria-label={label(table.path + "." + column)} value={cols[column] ?? ""}
              onChange={(event) => setColumn(table.path, column, event.target.value)} />
          </label>
        )) : <>
          {rows.map((row, index) => <div key={index} className="document-editable-row">
            <strong>{ko ? "행" : vi ? "Dòng" : "Row"} {index + 1}</strong>
            {table.columns.map((column) => <label key={column}>
              {label(table.path + "." + column)}
              <input aria-label={label(table.path + "." + column) + " " + (index + 1)} value={row[column] ?? ""}
                onChange={(event) => setRow(table.path, index, column, event.target.value)} />
            </label>)}
            <button type="button" className="secondary" onClick={() => removeRow(table.path, index)}>
              {ko ? "행 삭제" : vi ? "Xóa dòng" : "Remove row"}
            </button>
          </div>)}
          <button type="button" className="secondary" onClick={() => addRow(table)}>
            {ko ? "행 추가" : vi ? "Thêm dòng" : "Add row"}
          </button>
        </>}
      </fieldset>;
    })}
  </div>;
}
