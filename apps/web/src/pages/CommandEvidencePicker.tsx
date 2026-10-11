import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Workspace } from "../data/ui-contract";
import { recordTitle } from "./record-utils";
import "./command-evidence-picker.css";

interface EvidenceOption {
  id: string;
  name: string;
  scope: string;
  version: number;
}

export function CommandEvidencePicker({ workspace, selectedIds, onChange, manualIds, onManualChange }: {
  workspace: Workspace;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  manualIds: string;
  onManualChange: (ids: string) => void;
}) {
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language;
  const ko = language.startsWith("ko");
  const vi = language.startsWith("vi");
  const [query, setQuery] = useState("");
  const catalog = useMemo(() => {
    const entries = new Map<string, EvidenceOption>();
    for (const item of workspace.items) {
      if (item.machine !== "evidence" || item.record.projectId !== workspace.project.id) continue;
      const location = workspace.locations?.find((location) => location.id === item.record.locationId);
      entries.set(item.record.id, {
        id: item.record.id, name: recordTitle(item.record),
        scope: location?.name ?? item.record.locationId ?? "", version: item.record.version,
      });
    }
    for (const item of workspace.context.referenceCatalog?.evidence ?? []) {
      if (item.record.projectId !== workspace.project.id || entries.has(item.ref.objectId)) continue;
      const location = workspace.locations?.find((location) => location.id === item.record.locationId);
      entries.set(item.ref.objectId, {
        id: item.ref.objectId, name: recordTitle(item.record),
        scope: location?.name ?? item.record.locationId ?? "", version: item.ref.version,
      });
    }
    return Array.from(entries.values()).sort((a,b) => a.name.localeCompare(b.name, language));
  }, [workspace, language]);
  const filtered = catalog.filter((entry) =>
    (entry.name + " " + entry.scope + " " + entry.id).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  );
  const toggle = (id: string, enabled: boolean) => {
    onChange(enabled ? Array.from(new Set([...selectedIds, id])) : selectedIds.filter((item) => item !== id));
  };
  return <fieldset className="command-evidence-picker" aria-label={ko ? "증빙 선택" : vi ? "Chọn minh chứng" : "Select evidence"}>
    <legend>{ko ? "처리 근거 증빙" : vi ? "Minh chứng kèm theo" : "Supporting evidence"}</legend>
    <label className="command-evidence-search">
      {ko ? "사진·파일 검색" : vi ? "Tìm ảnh hoặc tệp" : "Find photos and files"}
      <input type="search" value={query} onChange={(event) => setQuery(event.target.value)}
        placeholder={ko ? "파일명, 위치, 증빙번호" : vi ? "Tên tệp, vị trí, mã minh chứng" : "File, location or evidence ID"} />
    </label>
    <div className="command-evidence-options">
      {filtered.map((entry) => (
        <label key={entry.id} className="command-evidence-option">
          <input type="checkbox" checked={selectedIds.includes(entry.id)} onChange={(event) => toggle(entry.id, event.target.checked)} />
          <span>
            <strong>{entry.name}</strong>
            <small>{entry.scope ? entry.scope + " · " : ""}{ko ? "작성 차수" : vi ? "Phiên bản" : "Version"} {entry.version} · {entry.id.slice(0, 12)}</small>
          </span>
        </label>
      ))}
      {!filtered.length && <p className="muted" role="status">
        {ko ? "표시할 증빙이 없습니다. 현장기록에 먼저 사진·파일을 등록하거나 검색어를 확인하십시오." :
          vi ? "Chưa có minh chứng phù hợp. Hãy tải ảnh, tệp lên hồ sơ hiện trường hoặc đổi từ khóa." :
            "No matching evidence. Upload files under site records or change your search."}
      </p>}
    </div>
    <small className="muted">{ko ? "선택한 증빙" : vi ? "Đã chọn" : "Selected"}: {selectedIds.length}</small>
    <details>
      <summary>{ko ? "목록에 없는 증빙번호 직접 입력 (고급)" : vi ? "Nhập mã minh chứng không có trong danh sách (nâng cao)" : "Enter evidence IDs not listed (advanced)"}</summary>
      <label>{ko ? "증빙번호" : vi ? "Mã minh chứng" : "Evidence IDs"}
        <textarea rows={2} value={manualIds} onChange={(event) => onManualChange(event.target.value)}
          placeholder={ko ? "쉼표 또는 줄바꿈으로 구분" : "Separate with commas or line breaks"} />
      </label>
    </details>
  </fieldset>;
}
