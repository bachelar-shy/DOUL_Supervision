import { useEffect, useRef, useState, type FormEvent } from "react";
import type { SupervisionClient } from "../data/supervision-client";
import type { Workspace } from "../data/ui-contract";
import { useSessionFormDraft } from "../data/session-form-draft";

type RecordType = "daily" | "inspection_support" | "site_issue" | "other";
type FieldRecord = {
  id: string; projectId: string; version: number; status: "draft";
  recordType: RecordType; title: string; description: string; recordDate: string;
  locationId: string | null; evidenceIds: string[];
  createdByName: string; createdByRole: string; createdAt: string;
};
const types: Record<RecordType, string> = {
  daily: "현장일지", inspection_support: "검측 관련 기록",
  site_issue: "현장 특이사항", other: "기타 현장기록",
};
const initial = {
  recordType: "daily" as RecordType, title: "", recordDate: new Date().toLocaleDateString("en-CA"),
  locationId: "", description: "", evidenceIds: [] as string[],
};

export function FieldRecordPanel({
  client, workspace, online, expanded, onToggle,
}: {
  client: SupervisionClient;
  workspace: Workspace;
  online: boolean;
  expanded: boolean;
  onToggle: (next: boolean) => void;
}) {
  const author = (["CON", "SUP", "ADM"] as string[]).includes(workspace.role.actorGroup);
  const identity = {
    projectId: workspace.project.id,
    partyId: client.session?.actor.partyId ?? "preview",
    roleId: workspace.role.id,
  };
  const { value: draft, change: changeDraft, discard, persistenceFailed } =
    useSessionFormDraft("field-record", identity, initial);
  const [items, setItems] = useState<FieldRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const attempt = useRef<{ body: string; key: string } | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true); setLoadError("");
    if (client.kind !== "http") {
      setItems([]); setLoading(false);
      return () => { active = false; };
    }
    void client.request<{ items: FieldRecord[] }>(client.path("/field-records"))
      .then(result => { if (active) setItems(result.items); })
      .catch(() => { if (active) setLoadError("현장기록 목록을 불러오지 못했습니다."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, workspace.project.id, workspace.role.id, revision]);

  const evidence = workspace.items.filter(item => item.machine === "evidence")
    .filter(item => item.record.projectId === workspace.project.id);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!author || !online || busy || client.kind !== "http") return;
    const payload = {
      ...draft,
      title: draft.title.trim(), description: draft.description.trim(),
    };
    if (!payload.title || !payload.description || !payload.recordDate) {
      setError("제목, 날짜와 내용을 입력하십시오.");
      return;
    }
    const body = JSON.stringify(payload);
    if (attempt.current?.body !== body) {
      attempt.current = { body, key: crypto.randomUUID() };
    }
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await client.request<{ record: FieldRecord }>(client.path("/field-records"), {
        method: "POST", headers: { "Idempotency-Key": attempt.current.key }, body,
      });
      attempt.current = null;
      discard();
      onToggle(false);
      setNotice("현장기록 초안이 저장되었습니다. 별도의 승인 또는 공식 제출은 이루어지지 않았습니다. (" + result.record.id.slice(0, 8) + ")");
      setRevision(n => n + 1);
    } catch {
      setError("저장하지 못했습니다. 항목과 접근 권한을 확인한 뒤 다시 시도하십시오.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel grid gap-3 p-4" data-ui-component="field-record-panel" aria-label="현장기록 관리">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h2 className="text-lg font-semibold">현장기록</h2>
        <p className="text-sm text-muted-foreground">현장일지·작업 확인·특이사항을 작성하고 초안으로 보관합니다.</p>
      </div>
      {author && <button type="button" className="primary" style={{ minHeight: 44 }}
        aria-expanded={expanded} onClick={() => onToggle(!expanded)}>
        {expanded ? "작성 닫기" : "＋ 신규 현장기록"}
      </button>}
    </div>
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {expanded && author && <form aria-label="신규 현장기록 작성" className="grid gap-3 rounded-md border p-3"
      onSubmit={event => void save(event)}>
      <p className="text-sm">작성된 내용은 서버에 <strong>초안</strong>으로 저장됩니다. 승인·발행된 감리보고서가 아닙니다.</p>
      {persistenceFailed && <p role="alert">이 브라우저에서는 작성 중 임시저장을 하지 못했습니다.</p>}
      <label className="grid gap-1">기록 종류
        <select className="min-h-11 w-full rounded border px-3" aria-label="기록 종류" value={draft.recordType}
          onChange={event => changeDraft({ recordType: event.target.value as RecordType })}>
          {(Object.keys(types) as RecordType[]).map(key => <option key={key} value={key}>{types[key]}</option>)}
        </select>
      </label>
      <label className="grid gap-1">기록 제목
        <input className="min-h-11 w-full rounded border px-3" maxLength={200} required
          value={draft.title} onChange={event => changeDraft({ title: event.target.value })} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1">기록 날짜
          <input className="min-h-11 w-full rounded border px-3" type="date" required
            value={draft.recordDate} onChange={event => changeDraft({ recordDate: event.target.value })} />
        </label>
        <label className="grid gap-1">위치 (선택)
          <select className="min-h-11 w-full rounded border px-3" value={draft.locationId}
            onChange={event => changeDraft({ locationId: event.target.value })}>
            <option value="">전체 현장 / 위치 미지정</option>
            {(workspace.locations ?? []).map(location => <option key={location.id} value={location.id}>{location.name}</option>)}
          </select>
        </label>
      </div>
      <label className="grid gap-1">현장기록 내용
        <textarea className="w-full rounded border p-3" rows={5} maxLength={4000} required
          value={draft.description} onChange={event => changeDraft({ description: event.target.value })} />
      </label>
      {evidence.length > 0 && <fieldset className="grid gap-2 rounded border p-3">
        <legend>이미 등록된 사진·파일 연결 (선택, 최대 20건)</legend>
        <div className="grid gap-2">
          {evidence.slice(0, 60).map(item => <label key={item.record.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.evidenceIds.includes(item.record.id)}
              disabled={!draft.evidenceIds.includes(item.record.id) && draft.evidenceIds.length >= 20}
              onChange={event => changeDraft({ evidenceIds: event.target.checked
                ? [...draft.evidenceIds, item.record.id]
                : draft.evidenceIds.filter(id => id !== item.record.id) })} />
            {item.record.title || String(item.record.metadata?.name ?? item.record.id.slice(0, 8))}
          </label>)}
        </div>
      </fieldset>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="primary" style={{ minHeight: 44 }}
          disabled={busy || !online || client.kind !== "http" || !draft.title.trim() || !draft.description.trim() || !draft.recordDate}>
          {busy ? "저장 중…" : "현장기록 초안 저장"}
        </button>
        <button className="secondary" type="button" style={{ minHeight: 44 }} onClick={() => onToggle(false)}>취소</button>
      </div>
    </form>}
    <div className="flex flex-wrap justify-between gap-2 items-center">
      <h3 className="font-semibold">저장된 현장기록 · {items.length}건</h3>
      <button type="button" className="secondary" disabled={loading}
        onClick={() => setRevision(n => n + 1)}>새로고침</button>
    </div>
    {loading && <p role="status">현장기록을 불러오는 중…</p>}
    {loadError && <p role="alert">{loadError}</p>}
    {!loading && !items.length && <p className="text-sm text-muted-foreground">저장된 현장기록 초안이 없습니다.</p>}
    {items.map(item => <article className="grid gap-1 rounded border p-3" key={item.id}
      data-field-record-id={item.id}>
      <div className="flex flex-wrap justify-between gap-2">
        <strong>{item.title}</strong>
        <span className="text-sm">초안 · {types[item.recordType]}</span>
      </div>
      <p className="text-sm">{item.recordDate} · 작성자 {item.createdByName}</p>
      <p className="whitespace-pre-wrap text-sm">{item.description}</p>
      <small>연결된 증빙 {item.evidenceIds.length}건 · {item.id.slice(0, 8)}</small>
    </article>)}
  </section>;
}
