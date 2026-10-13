import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupervisionClient } from "../data/supervision-client";
import { cacheOfflineMedia, clearOfflineMedia, getOfflineMedia,
  listOfflineMedia, type OfflineScope, type OfflineMediaKind } from "../data/field-media-cache";
import type { DrawingSheet } from "../data/drawing-sheet-client";

type CacheRow = { key: string; kind: OfflineMediaKind; title: string; objectId: string;
  version: number; bytes: number; storedAt: number };
type PhotoRow = { id: string; name: string; version: number; mediaType: string };
function OfflineImage({ client, scope, row }: {
  client: SupervisionClient; scope: OfflineScope; row: CacheRow;
}) {
  const [image, setImage] = useState("");
  useEffect(() => {
    let live = true, url = "";
    void getOfflineMedia(scope, row.kind, row.objectId, row.version).then(blob => {
      if (!live || !blob) return;
      url = URL.createObjectURL(blob);
      setImage(url);
    });
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [scope.projectId, scope.partyId, scope.roleId, row.key, row.kind, row.objectId, row.version, client]);
  return image ? <img alt={row.title} src={image} loading="lazy" style={{
      width: 104, height: 80, objectFit: "cover", borderRadius: 4, background: "#e5e7eb",
    }} /> : <span aria-label="저장된 사진 미리보기">이미지 없음</span>;
}

export function OfflineMediaPanel({ client, scope, online }: {
  client: SupervisionClient; scope: OfflineScope; online: boolean;
}) {
  const [rows, setRows] = useState<CacheRow[]>([]);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const signedIn = client.kind === "http" && client.session?.projectId === scope.projectId
    && client.session?.actor.partyId === scope.partyId
    && client.session?.actor.roleAssignmentId === scope.roleId;
  const sizeMb = useMemo(() => (rows.reduce((s, r) => s + r.bytes, 0) / 1048576).toFixed(1), [rows]);
  const reload = useCallback(async () => {
    if (!signedIn) { setRows([]); return; }
    const result = await listOfflineMedia(scope);
    setRows(result);
  }, [signedIn, scope.projectId, scope.partyId, scope.roleId]);
  useEffect(() => { void reload().catch(() => setError("기기 저장소를 읽을 수 없습니다.")); }, [reload]);

  async function prepare() {
    if (!signedIn || !online || busy) return;
    setBusy(true); setError("");
    const failures: string[] = [];
    let finished = 0;
    try {
      const [photos, sheets] = await Promise.all([
        client.request<{ items: PhotoRow[] }>(client.path("/field/photos?limit=20&media=photo")),
        client.request<{ items: DrawingSheet[] }>(client.path("/drawing-sheets")),
      ]);
      const ready = sheets.items.filter(sheet => sheet.status === "ready").slice(0, 25);
      const candidates = [
        ...photos.items.slice(0, 20).map(item => ({
          kind: "photo" as const, id: item.id, version: item.version, title: item.name,
          load: () => client.evidenceContent(item.id),
        })),
        ...ready.map(sheet => ({
          kind: "drawing-preview" as const, id: sheet.id, version: sheet.version,
          title: sheet.number + " " + sheet.title,
          load: () => client.drawingSheetImage(sheet.id, "preview"),
        })),
      ];
      for (const row of candidates) {
        setProgress(`${finished + 1} / ${candidates.length} 저장 중`);
        try {
          const blob = await row.load();
          await cacheOfflineMedia(scope, row.kind, row.id, row.version, row.title, blob);
        } catch {
          failures.push(row.title);
        }
        finished++;
      }
      setProgress(`${finished - failures.length}건 기기에 저장됨`);
      if (failures.length) setError(`${failures.length}건 저장 실패: 용량·권한·네트워크 확인이 필요합니다.`);
      await reload();
    } catch {
      setError("오프라인 자료 목록을 가져오지 못했습니다.");
    } finally { setBusy(false); }
  }
  async function clear() {
    if (!signedIn || busy || !window.confirm("현재 계정의 오프라인 사진·도면을 이 기기에서 삭제하시겠습니까?")) return;
    setBusy(true);
    try { await clearOfflineMedia(scope); await reload(); setError(""); setProgress(""); }
    catch { setError("기기 자료 삭제에 실패했습니다."); }
    finally { setBusy(false); }
  }
  return <section aria-label="오프라인 사진·도면" style={{ borderTop: "1px solid #ddd", paddingTop: 12, marginTop: 12 }}>
    <h4 style={{ fontWeight: 650, marginBottom: 5 }}>오프라인 사진·도면</h4>
    <p style={{ fontSize: 12 }}>현재 로그인한 담당자에게 허용된 현장사진과 도면 미리보기를 기기에 저장합니다.
      원본 승인도면 및 서버 기록은 변경되지 않습니다.</p>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 8 }}>
      <button type="button" disabled={busy || !online || !signedIn} onClick={() => void prepare()}>
        {busy ? "저장 중…" : "오프라인 자료 준비"}
      </button>
      <button type="button" disabled={busy || !signedIn || rows.length === 0} onClick={() => void clear()}>
        기기 저장자료 삭제
      </button>
      <span aria-live="polite">{rows.length}건 · {sizeMb}MB</span>
      <span role="status">{progress}</span>
    </div>
    {error && <p role="alert">{error}</p>}
    {!online && <p role="status">인터넷 연결이 없어도 아래의 저장된 이미지를 열어 볼 수 있습니다.</p>}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(120px,1fr))",
        gap: 9, marginTop: 10 }}>
      {rows.map(row => <figure key={row.key} style={{ margin: 0, minWidth: 0 }}>
        <OfflineImage client={client} scope={scope} row={row} />
        <figcaption style={{ fontSize: 11, overflowWrap: "anywhere" }}>
          {row.title}<small style={{ display: "block" }}>{row.kind === "photo" ? "현장사진" : "도면 미리보기"}</small>
        </figcaption>
      </figure>)}
    </div>
  </section>;
}
