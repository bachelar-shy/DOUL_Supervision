import { useEffect, useMemo, useState } from "react";
import type { SupervisionClient } from "../data/supervision-client";
import type { Workspace } from "../data/ui-contract";
import "./field-photo-library.css";

type Photo = {
  id: string; name: string; mediaType: "photo" | "video"; locationId?: string;
  capturedAt?: string; uploadedAt?: string; submittedBy?: string;
  tags: string[]; tagVersion: number; discipline?: string;
};
type Page = { count: number; items: Photo[]; offset: number; limit: number };
const take = (value: unknown) => typeof value === "string" ? value.slice(0, 10) : "";

function Preview({ client, id, mediaType, large = false }: { client: SupervisionClient; id: string; mediaType: "photo" | "video"; large?: boolean }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";
    void client.evidenceContent(id).then(blob => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => { if (!cancelled) setUrl(""); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [client, id]);
  return url ? mediaType === "video" ? <video src={url} controls={large} muted={!large} preload="metadata" className={large ? "fw-photo-large" : "fw-photo-thumb"} /> : <img src={url} loading="lazy" alt="현장사진" className={large ? "fw-photo-large" : "fw-photo-thumb"} />
    : <div className="fw-photo-placeholder" aria-label="사진 준비 중">사진</div>;
}

export function FieldPhotoLibrary({ client, workspace, online }: {
  client: SupervisionClient; workspace: Workspace; online: boolean;
}) {
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("");
  const [location, setLocation] = useState("");
  const [onlyMine, setOnlyMine] = useState(false);
  const [media, setMedia] = useState("all");
  const [captureFrom, setCaptureFrom] = useState("");
  const [uploadFrom, setUploadFrom] = useState("");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<Page>({ count: 0, items: [], offset: 0, limit: 48 });
  const [selected, setSelected] = useState<Photo | null>(null);
  const [editingTags, setEditingTags] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const me = client.session?.actor.partyId || "";
  const canTag = ["SUP", "ADM", "CON"].includes(workspace.role.actorGroup);
  const locationNames = useMemo(() => new Map((workspace.locations || []).map(row => [row.id, row.name])), [workspace.locations]);
  const projectId = workspace.project.id;

  useEffect(() => {
    let closed = false;
    if (!online) return;
    const params = new URLSearchParams({ q, tag, locationId: location, media,
      uploader: onlyMine ? me : "", captureFrom, uploadFrom, limit: "48", offset: String(offset) });
    void client.request<Page>(client.path("/field/photos?" + params.toString()))
      .then(res => { if (!closed) { setPage(res); setError(""); } })
      .catch(() => { if (!closed) setError("현장사진을 불러오지 못했습니다. 권한과 연결상태를 확인하십시오."); });
    return () => { closed = true; };
  }, [client, projectId, q, tag, location, media, onlyMine, me, captureFrom, uploadFrom, offset, refreshKey, online]);

  useEffect(() => { setOffset(0); }, [q, tag, location, media, onlyMine, captureFrom, uploadFrom, projectId]);
  async function saveTags() {
    if (!selected || !online || !canTag) return;
    const tags = [...new Set(editingTags.split(",").map(s => s.trim()).filter(Boolean))];
    setBusy(true); setError("");
    try {
      await client.request(client.path("/field/photos/tags"), {
        method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ evidenceIds: [selected.id], tags,
          expectedVersions: { [selected.id]: selected.tagVersion } }),
      });
      setSelected(null); setRefreshKey(v => v + 1);
    } catch {
      setError("태그를 저장하지 못했습니다. 사진 권한 또는 수정 버전을 확인하십시오.");
    } finally { setBusy(false); }
  }
  return <section className="fw-photo-library" aria-label="현장사진 라이브러리">
    <header className="fw-photo-heading">
      <div><h2>현장사진 라이브러리</h2><p>프로젝트 사진을 촬영일·업로드일·공사구역·태그로 검색합니다.</p></div>
      <strong>{page.count}건</strong>
    </header>
    <div className="fw-photo-filters">
      <label>검색<input type="search" aria-label="사진 검색" placeholder="사진 이름·공종·태그" value={q} onChange={e => setQ(e.target.value)} /></label>
      <label>구역<select aria-label="사진 공사구역" value={location} onChange={e => setLocation(e.target.value)}>
        <option value="">전체 공사구역</option>{(workspace.locations || []).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select></label>
      <label>태그<input type="search" aria-label="사진 태그" placeholder="태그" value={tag} onChange={e => setTag(e.target.value)} /></label>
      <label>파일<select aria-label="사진 파일 구분" value={media} onChange={e => setMedia(e.target.value)}>
        <option value="all">사진·영상</option><option value="photo">사진</option><option value="video">영상</option>
      </select></label>
      <label>촬영일 이후<input type="date" value={captureFrom} onChange={e => setCaptureFrom(e.target.value)} /></label>
      <label>등록일 이후<input type="date" value={uploadFrom} onChange={e => setUploadFrom(e.target.value)} /></label>
      <label className="fw-photo-mine"><input type="checkbox" checked={onlyMine} onChange={e => setOnlyMine(e.target.checked)} /> 내 사진</label>
    </div>
    {!online && <p role="status">오프라인 상태에서는 마지막으로 열었던 현장사진만 사용할 수 있습니다.</p>}
    {error && <p role="alert">{error}</p>}
    <div className="fw-photo-grid" role="list">
      {page.items.map(item => <button type="button" className="fw-photo-card" role="listitem" key={item.id}
          onClick={() => { setSelected(item); setEditingTags(item.tags.join(", ")); }} aria-label={item.name}>
        <Preview client={client} id={item.id} mediaType={item.mediaType} />
        <span className="fw-photo-name">{item.name}</span>
        <small>{take(item.capturedAt) || take(item.uploadedAt) || "날짜 없음"} · {locationNames.get(item.locationId || "") || "미지정"}</small>
        <span className="fw-photo-tagline">{item.tags.join(" · ") || "태그 없음"}</span>
      </button>)}
    </div>
    {!page.items.length && <p className="fw-photo-empty">조건에 맞는 사진이 없습니다.</p>}
    <footer className="fw-photo-paging">
      <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 48))}>이전</button>
      <span>{page.count ? offset + 1 : 0}–{Math.min(page.count, offset + page.items.length)} / {page.count}</span>
      <button type="button" disabled={offset + page.items.length >= page.count} onClick={() => setOffset(offset + 48)}>다음</button>
    </footer>
    {selected && <div className="fw-photo-overlay" role="presentation" onClick={() => setSelected(null)}>
      <section role="dialog" aria-modal="true" aria-label="현장사진 상세" className="fw-photo-dialog" onClick={e => e.stopPropagation()}>
        <header><h3>{selected.name}</h3><button type="button" onClick={() => setSelected(null)} aria-label="닫기">×</button></header>
        <Preview client={client} id={selected.id} mediaType={selected.mediaType} large />
        <dl><dt>촬영일</dt><dd>{take(selected.capturedAt) || "정보 없음"}</dd><dt>업로드일</dt><dd>{take(selected.uploadedAt) || "정보 없음"}</dd>
          <dt>공사구역</dt><dd>{locationNames.get(selected.locationId || "") || "미지정"}</dd><dt>업로드 담당자</dt><dd>{selected.submittedBy || "정보 없음"}</dd></dl>
        {canTag && <div className="fw-photo-tags"><label>사진 태그<input value={editingTags} aria-label="사진 태그 수정" onChange={e => setEditingTags(e.target.value)} placeholder="콘크리트, 2층, 검측" /></label>
          <button type="button" disabled={busy || !online || (workspace.role.actorGroup === "CON" && selected.submittedBy !== me)}
            onClick={() => void saveTags()}>태그 저장</button></div>}
      </section>
    </div>}
  </section>;
}
