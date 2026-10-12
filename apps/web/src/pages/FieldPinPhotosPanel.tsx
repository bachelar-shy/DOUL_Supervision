import { useEffect, useState } from "react";
import type { SupervisionClient } from "../data/supervision-client";
import type { DrawingSheetPin } from "../data/drawing-sheet-client";

export type PhotoPinLink = {
  id: string; version: number; sheetId: string; pinId: string; pinVersion: number;
  evidenceRef: { objectType: "Evidence"; objectId: string; version: number };
  sheetNumber: string; sheetTitle: string; pinKind: string; pinComment: string;
  recordRef: { objectType: string; objectId: string; version: number } | null;
};
type PhotoOption = { id: string; name: string; version: number; mediaType: string };

export function PhotoLinkPreview({ client, id, label }: {
  client: SupervisionClient; id: string; label: string;
}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let alive = true, objectUrl = "";
    void client.evidenceContent(id).then(blob => {
      if (!alive) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => { if (alive) setUrl(""); });
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [client, id]);
  return url ? <img src={url} loading="lazy" alt={label}
    style={{ objectFit: "cover", width: 80, height: 68, borderRadius: 4 }} />
    : <span style={{ fontSize: 11 }}>사진</span>;
}
export function FieldPinPhotosPanel({ client, sheetId, pin }: {
  client: SupervisionClient; sheetId: string; pin: DrawingSheetPin;
}) {
  const [links, setLinks] = useState<PhotoPinLink[]>([]);
  const [options, setOptions] = useState<PhotoOption[]>([]);
  const [selectedPhoto, setSelectedPhoto] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const canLink = pin.status === "linked" && typeof pin.version === "number" && client.session?.actor &&
    ["ADM", "SUP", "CON"].includes(client.session.actor.actorGroup);
  useEffect(() => {
    let alive = true;
    const params = new URLSearchParams({ sheetId, pinId: pin.id });
    void Promise.all([
      client.request<{items:PhotoPinLink[]}>(client.path("/field/photo-links?" + params)),
      client.request<{items:PhotoOption[]}>(client.path("/field/photos?media=photo&limit=80")),
    ]).then(([found,photos]) => {
      if (!alive) return;
      setLinks(found.items); setOptions(photos.items); setError("");
    }).catch(() => { if (alive) setError("연결된 사진을 불러올 수 없습니다."); });
    return () => { alive = false; };
  }, [client, sheetId, pin.id, revision]);

  async function attach() {
    const photo = options.find(item => item.id === selectedPhoto);
    if (!photo || busy || !canLink) return;
    setBusy(true); setError("");
    try {
      await client.request(client.path("/field/photo-links"), { method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ sheetId, pinId: pin.id, expectedPinVersion: pin.version ?? 0,
          evidenceRef: { objectType: "Evidence", objectId: photo.id, version: photo.version } }) });
      setSelectedPhoto(""); setRevision(v => v + 1);
    } catch { setError("사진을 연결할 수 없습니다. 프로젝트 권한·핀 버전 또는 중복 여부를 확인하십시오."); }
    finally { setBusy(false); }
  }
  async function unlink(link: PhotoPinLink) {
    setBusy(true); setError("");
    try {
      await client.request(client.path("/field/photo-links/" + link.id + "/unlink"), {
        method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ expectedVersion: link.version }),
      });
      setRevision(v => v + 1);
    } catch { setError("사진 연결을 해제하지 못했습니다."); }
    finally { setBusy(false); }
  }
  return <section aria-label="핀 현장사진" style={{ borderTop: "1px solid #d5d9dd", paddingTop: 10 }}>
    <h4 style={{ fontSize: 13, fontWeight: 650 }}>현장사진 · {links.length}건</h4>
    {error && <p role="alert">{error}</p>}
    {links.map(link => <div key={link.id} style={{ display: "flex", alignItems: "center", gap: 8,
        borderBottom: "1px solid #e4e7e9", padding: "7px 0" }}>
      <PhotoLinkPreview client={client} id={link.evidenceRef.objectId} label={link.pinComment} />
      <small style={{ flex: 1, overflowWrap: "anywhere" }}>{link.sheetNumber} · {link.pinComment}</small>
      {canLink && <button type="button" disabled={busy}
        onClick={() => void unlink(link)}>연결 해제</button>}
    </div>)}
    {canLink && <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
      <select aria-label="핀에 연결할 현장사진" style={{ minWidth: 0, flex: 1 }}
        value={selectedPhoto} onChange={event => setSelectedPhoto(event.target.value)}>
        <option value="">사진 선택</option>
        {options.filter(item => !links.some(link => link.evidenceRef.objectId === item.id))
          .map(photo => <option key={photo.id} value={photo.id}>{photo.name}</option>)}
      </select>
      <button type="button" disabled={!selectedPhoto || busy} onClick={() => void attach()}>
        연결
      </button>
    </div>}
  </section>;
}
export function PhotoLinksForEvidence({ client, evidenceId, onOpenSheet }: {
  client: SupervisionClient; evidenceId: string;
  onOpenSheet?: (sheetId: string) => void;
}) {
  const [rows, setRows] = useState<PhotoPinLink[]>([]);
  useEffect(() => {
    let alive = true;
    void client.request<{items:PhotoPinLink[]}>(client.path("/field/photo-links?evidenceId=" +
      encodeURIComponent(evidenceId))).then(data => { if (alive) setRows(data.items); })
      .catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [client, evidenceId]);
  return <section aria-label="연결된 도면·이슈" style={{ marginTop: 10 }}>
    <h4 style={{ fontSize: 13, fontWeight: 650 }}>연결된 도면·이슈 ({rows.length})</h4>
    {rows.map(row => <div key={row.id} style={{ fontSize: 12, borderBottom: "1px solid #ddd",
      padding: "7px 0" }}>
      <strong>{row.sheetNumber}</strong> · {row.sheetTitle}
      <p>{row.pinComment}</p>
      {row.recordRef && <small>연결된 업무: {row.recordRef.objectType} · {row.recordRef.objectId.slice(0, 8)}</small>}
      {onOpenSheet && <button type="button" onClick={() => onOpenSheet(row.sheetId)}>해당 도면 열기</button>}
    </div>)}
    {!rows.length && <small>연결된 도면 핀이 없습니다.</small>}
  </section>;
}
