import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupervisionClient } from "../../data/supervision-client";
import type { Workspace } from "../../data/ui-contract";

type LocationRow = { reference: { objectId: string; version: number }; name: string; semanticAnchor: string; parentRef?: { objectId: string } | null; drawingAnchors?: Array<{ drawingRef: { objectType: string; objectId: string; version: number }; page: number; x: number; y: number; coordinateSystem: string }>; depth: number; [key: string]: unknown };
const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const idOf = (row: LocationRow) => row.reference.objectId;

export function LocationEditorPanel({ client, workspace, onChanged }: { client: SupervisionClient; workspace: Workspace; onChanged?: () => void }) {
  const canManage = client.kind === "http" && client.session?.actor.actorGroup === "ADM";
  const [rows, setRows] = useState<LocationRow[]>([]); const [selectedId, setSelectedId] = useState("");
  const [name, setName] = useState(""); const [semanticAnchor, setSemanticAnchor] = useState(""); const [parentId, setParentId] = useState("");
  const [drawingJson, setDrawingJson] = useState("[]"); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false);
  const [error, setError] = useState(""); const [message, setMessage] = useState("");
  const selected = useMemo(() => rows.find(row => idOf(row) === selectedId), [rows, selectedId]);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { const data = object(await client.request<unknown>(client.path("/parallel/locations"))); const items = Array.isArray(data.items) ? data.items as LocationRow[] : []; setRows(items); setSelectedId(current => items.some(row => idOf(row) === current) ? current : items[0] ? idOf(items[0]) : ""); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
  }, [client]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!selected) return; setName(selected.name ?? ""); setSemanticAnchor(selected.semanticAnchor ?? ""); setParentId(selected.parentRef?.objectId ?? ""); setDrawingJson(JSON.stringify(selected.drawingAnchors ?? [], null, 2)); }, [selected]);
  const submit = useCallback(async (create: boolean) => {
    setSaving(true); setError(""); setMessage("");
    try {
      const anchors = JSON.parse(drawingJson); if (!Array.isArray(anchors)) throw new Error("Drawing anchors must be a JSON array.");
      const body = create ? { clientObjectId: crypto.randomUUID(), name, semanticAnchor, parentId: selectedId || parentId || null, drawingAnchors: anchors } : { expectedVersion: selected?.reference.version, name, semanticAnchor, parentId: parentId || null, drawingAnchors: anchors };
      const suffix = create ? "/parallel/locations" : `/parallel/locations/${encodeURIComponent(selectedId)}`;
      const response = await client.request<{ record?: LocationRow & { id?: string } }>(client.path(suffix), { method: create ? "POST" : "PUT", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify(body) });
      if (create && response.record) setSelectedId(response.record.id ?? "");
      setMessage(create ? "Location created." : "Location updated."); await load(); onChanged?.();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setSaving(false); }
  }, [client, drawingJson, load, name, onChanged, parentId, selected?.reference.version, selectedId, semanticAnchor]);
  return <section className="location-editor" aria-label="Location editor">
    <header><div><h2>Location hierarchy</h2><p>Project {workspace.project.id} · exact drawing references with PDF point coordinates</p></div><button type="button" onClick={() => void load()} disabled={loading}>Refresh</button></header>
    {error && <div role="alert">{error}</div>}{message && <div role="status">{message}</div>}
    <div className="location-editor-grid"><nav aria-label="Locations">{loading ? <p>Loading locations…</p> : rows.map(row => <button type="button" key={idOf(row)} aria-current={selectedId === idOf(row) ? "true" : undefined} onClick={() => setSelectedId(idOf(row))} style={{ paddingLeft: 12 + row.depth * 14 }}>{row.name}<small> · v{row.reference.version}</small></button>)}</nav>
      <form onSubmit={event => { event.preventDefault(); void submit(false); }}>
        <label>Name<input value={name} onChange={event => setName(event.target.value)} readOnly={!canManage} required /></label>
        <label>Semantic anchor<input value={semanticAnchor} onChange={event => setSemanticAnchor(event.target.value)} readOnly={!canManage} required /></label>
        <label>Parent<select value={parentId} onChange={event => setParentId(event.target.value)} disabled={!canManage}><option value="">Project root</option>{rows.filter(row => idOf(row) !== selectedId).map(row => <option key={idOf(row)} value={idOf(row)}>{"　".repeat(row.depth)}{row.name}</option>)}</select></label>
        <label>Drawing anchors (JSON)<textarea rows={8} value={drawingJson} onChange={event => setDrawingJson(event.target.value)} readOnly={!canManage} spellCheck={false} /><small>Exact drawingRef, positive page, finite x/y, coordinateSystem: pdf_points.</small></label>
        {canManage ? <div className="location-editor-actions"><button type="submit" disabled={saving || !selected}>{saving ? "Saving…" : "Save changes"}</button><button type="button" disabled={saving || !selected} onClick={() => void submit(true)}>Create child</button></div> : <p role="note">Read-only. Location editing requires the demo project administrator role.</p>}
      </form>
    </div>
  </section>;
}
