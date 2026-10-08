import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupervisionClient } from "../../data/supervision-client";
import type { Workspace } from "../../data/ui-contract";

type LocationRow = {
  reference: { objectId: string; version: number };
  name: string;
  semanticAnchor: string;
  parentRef?: { objectId: string } | null;
  drawingAnchors?: Array<{
    drawingRef: { objectType: string; objectId: string; version: number };
    page: number;
    x: number;
    y: number;
    coordinateSystem: string;
  }>;
  depth: number;
};
type WorkspaceRole = Workspace["role"] & { authorityCodes?: string[] };
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
const idOf = (row: LocationRow) => row.reference.objectId;

export function LocationEditorPanel({ client, workspace, onChanged }: {
  client: SupervisionClient;
  workspace: Workspace;
  onChanged?: () => void;
}) {
  const role = workspace.role as WorkspaceRole;
  const canManage = client.kind === "http"
    && workspace.demo
    && role.actorGroup === "ADM"
    && role.roleCode === "project_admin"
    && role.authorityCodes?.includes("render_document") === true;
  const contextKey = [workspace.project.id, role.id, role.actorGroup, role.roleCode,
    role.authorityCodes?.includes("render_document") ? "render_document" : ""]
    .join(":");
  const loadSequence = useRef(0);
  const [rows, setRows] = useState<LocationRow[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [name, setName] = useState("");
  const [semanticAnchor, setSemanticAnchor] = useState("");
  const [parentId, setParentId] = useState("");
  const [drawingJson, setDrawingJson] = useState("[]");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const selected = useMemo(() => rows.find(row => idOf(row) === selectedId), [rows, selectedId]);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError("");
    try {
      const data = object(await client.request<unknown>(client.path("/parallel/locations")));
      if (sequence !== loadSequence.current) return;
      const items = Array.isArray(data.items) ? data.items as LocationRow[] : [];
      setRows(items);
      setSelectedId(current => items.some(row => idOf(row) === current)
        ? current
        : items[0] ? idOf(items[0]) : "");
    } catch (cause) {
      if (sequence === loadSequence.current) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    // Clear the previous role's tree and form before requesting under the new role.
    setRows([]);
    setSelectedId("");
    setName("");
    setSemanticAnchor("");
    setParentId("");
    setDrawingJson("[]");
    setMessage("");
    void load();
    return () => { loadSequence.current += 1; };
  }, [contextKey, load]);

  useEffect(() => {
    setName(selected?.name ?? "");
    setSemanticAnchor(selected?.semanticAnchor ?? "");
    setParentId(selected?.parentRef?.objectId ?? "");
    setDrawingJson(JSON.stringify(selected?.drawingAnchors ?? [], null, 2));
  }, [selected]);

  const submit = useCallback(async (create: boolean) => {
    if (!canManage) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const anchors: unknown = JSON.parse(drawingJson);
      if (!Array.isArray(anchors)) throw new Error("도면 앵커는 JSON 배열이어야 합니다.");
      const body = create
        ? { clientObjectId: crypto.randomUUID(), name, semanticAnchor, parentId: selectedId, drawingAnchors: anchors }
        : { expectedVersion: selected?.reference.version, name, semanticAnchor, parentId: parentId || null, drawingAnchors: anchors };
      const suffix = create
        ? "/parallel/locations"
        : `/parallel/locations/${encodeURIComponent(selectedId)}`;
      const response = await client.request<{ record?: { id?: string } }>(client.path(suffix), {
        method: create ? "POST" : "PUT",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(body),
      });
      if (create && response.record?.id) setSelectedId(response.record.id);
      setMessage(create ? "위치를 만들었습니다." : "위치를 수정했습니다.");
      await load();
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }, [canManage, client, drawingJson, load, name, onChanged, parentId,
    selected?.reference.version, selectedId, semanticAnchor]);

  return (
    <section aria-label="위치 편집" className="rounded-sm border border-border bg-card p-4 text-card-foreground">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
        <div>
          <h2 className="text-base font-semibold">위치 계층 편집</h2>
          <p className="mt-1 text-xs text-muted-foreground">프로젝트 {workspace.project.name} · 도면 앵커는 도면 버전과 PDF 포인트 좌표를 사용합니다.</p>
        </div>
        <button type="button" className="rounded-sm border border-border px-3 py-2 text-xs hover:bg-muted" onClick={() => void load()} disabled={loading}>
          {loading ? "조회 중…" : "새로고침"}
        </button>
      </header>
      {error && <div role="alert" className="mb-3 rounded-sm border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
      {message && <div role="status" className="mb-3 rounded-sm border border-doul-success/30 bg-doul-success/5 p-3 text-sm">{message}</div>}
      <div className="grid gap-4 lg:grid-cols-[minmax(14rem,0.8fr)_minmax(0,1.4fr)]">
        <nav aria-label="위치 목록" className="max-h-[32rem] space-y-1 overflow-auto rounded-sm border border-border bg-background p-2">
          {loading && rows.length === 0 && <p className="p-2 text-sm text-muted-foreground">위치를 불러오는 중입니다…</p>}
          {!loading && rows.length === 0 && <p className="p-2 text-sm text-muted-foreground">표시할 위치가 없습니다.</p>}
          {rows.map(row => (
            <button type="button" key={idOf(row)} aria-current={selectedId === idOf(row) ? "true" : undefined}
              onClick={() => setSelectedId(idOf(row))}
              className={`flex w-full items-center justify-between gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-muted ${selectedId === idOf(row) ? "bg-doul-primary-muted font-medium text-doul-primary-deep" : ""}`}
              style={{ paddingLeft: `${8 + row.depth * 16}px` }}>
              <span className="truncate">{row.name}</span><small className="shrink-0 text-muted-foreground">v{row.reference.version}</small>
            </button>
          ))}
        </nav>
        <form className="space-y-3" onSubmit={event => { event.preventDefault(); void submit(false); }}>
          <label className="block space-y-1 text-sm font-medium">위치 이름
            <input className="w-full rounded-sm border border-input bg-background px-3 py-2 text-sm font-normal" value={name} onChange={event => setName(event.target.value)} readOnly={!canManage} required />
          </label>
          <label className="block space-y-1 text-sm font-medium">의미 앵커
            <input className="w-full rounded-sm border border-input bg-background px-3 py-2 text-sm font-normal" value={semanticAnchor} onChange={event => setSemanticAnchor(event.target.value)} readOnly={!canManage} required />
          </label>
          <label className="block space-y-1 text-sm font-medium">상위 위치
            <select className="w-full rounded-sm border border-input bg-background px-3 py-2 text-sm font-normal" value={parentId} onChange={event => setParentId(event.target.value)} disabled={!canManage}>
              <option value="">프로젝트 최상위</option>
              {rows.filter(row => idOf(row) !== selectedId).map(row => <option key={idOf(row)} value={idOf(row)}>{"　".repeat(row.depth)}{row.name}</option>)}
            </select>
          </label>
          <label className="block space-y-1 text-sm font-medium">도면 앵커 (JSON)
            <textarea className="w-full rounded-sm border border-input bg-background px-3 py-2 font-mono text-xs font-normal" rows={8} value={drawingJson} onChange={event => setDrawingJson(event.target.value)} readOnly={!canManage} spellCheck={false} />
          </label>
          <p className="-mt-2 text-xs text-muted-foreground">정확한 도면 참조, 1 이상의 페이지, 유한한 x/y, 좌표계 pdf_points가 필요합니다.</p>
          {canManage ? (
            <div className="flex flex-wrap gap-2">
              <button type="submit" className="rounded-sm bg-doul-primary px-3 py-2 text-sm font-medium text-white hover:bg-doul-primary-deep" disabled={saving || !selected}>{saving ? "저장 중…" : "변경 저장"}</button>
              <button type="button" className="rounded-sm border border-border px-3 py-2 text-sm hover:bg-muted" disabled={saving || !selected} onClick={() => void submit(true)}>하위 위치 추가</button>
            </div>
          ) : (
            <p role="note" className="rounded-sm border border-border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
              조회 전용입니다. 데모 프로젝트의 ADM / project_admin 역할과 render_document 권한이 확인되면 편집할 수 있습니다. 저장 권한은 서버가 다시 확인합니다.
            </p>
          )}
        </form>
      </div>
    </section>
  );
}
