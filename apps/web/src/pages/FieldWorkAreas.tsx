import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupervisionClient } from "../data/supervision-client";
import type { Workspace } from "../data/ui-contract";
import "./field-work-areas.css";

type DomainRef = { objectType: "Location"; objectId: string; version: number };
type Area = { reference: DomainRef; name: string; depth: number; semanticAnchor: string;
  treeParentRef: DomainRef | null; childRefs: DomainRef[]; hierarchyIssues: string[] };
type AreaList = { items: Area[]; count: number; hierarchyIssues: unknown[] };
type AreaKind = "site" | "building" | "floor" | "zone" | "room";
const kindNames: Record<AreaKind, string> = { site: "현장", building: "동", floor: "층", zone: "구역", room: "실" };

export function FieldWorkAreas({ client, workspace, online, onChoose }: {
  client: SupervisionClient; workspace: Workspace; online: boolean; onChoose?: (id: string) => void;
}) {
  const [areas, setAreas] = useState<Area[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [parentId, setParentId] = useState("");
  const [kind, setKind] = useState<AreaKind>("zone");
  const [name, setName] = useState("");
  const [editingName, setEditingName] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const pid = workspace.project.id;
  const isAdmin = workspace.role.actorGroup === "ADM";
  const selected = useMemo(() => areas.find(a => a.reference.objectId === selectedId), [areas, selectedId]);

  const fetchAreas = useCallback(async () => {
    const result = await client.request<AreaList>(client.path("/field/work-areas"));
    setAreas(result.items);
  }, [client]);
  useEffect(() => {
    if (!online) return;
    let stale = false;
    void client.request<AreaList>(client.path("/field/work-areas")).then(data => {
      if (!stale) { setAreas(data.items); setError(""); }
    }).catch(() => { if (!stale) setError("공사구역 목록을 읽을 수 없습니다."); });
    return () => { stale = true; };
  }, [client, pid, refresh, online]);

  useEffect(() => { setEditingName(selected?.name || ""); }, [selected?.name]);
  async function submit(path: string, body: object) {
    if (!online || !isAdmin) return;
    setError(""); setWorking(true);
    try {
      await client.request(client.path(path), { method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify(body) });
      setName(""); setRefresh(n => n + 1);
      await fetchAreas();
    } catch { setError("공사구역을 저장할 수 없습니다. 다른 관리자의 수정 내역이나 계층 깊이를 확인하십시오."); }
    finally { setWorking(false); }
  }

  return <section className="fw-areas" aria-label="공사구역 관리">
    <header className="fw-areas-heading"><div><h2>공사구역 관리</h2>
      <p>현장·동·층·구역·실 기준으로 사진·검측·업무의 실제 위치를 연결합니다.</p></div>
      <span>{areas.length}개 위치</span>
    </header>
    {error && <p role="alert">{error}</p>}
    <div className="fw-areas-layout">
      <div className="fw-areas-tree" role="tree" aria-label="공사구역 목록">
        {areas.map(area => <button type="button" key={area.reference.objectId} role="treeitem"
          aria-level={area.depth + 1} aria-selected={selectedId === area.reference.objectId}
          className={"fw-area-node " + (selectedId === area.reference.objectId ? "active" : "")}
          style={{ paddingLeft: 12 + area.depth * 18 }}
          onClick={() => { setSelectedId(area.reference.objectId); onChoose?.(area.reference.objectId); }}>
          <span aria-hidden>{area.depth < 2 ? "▣" : "◇"}</span>
          <span>{area.name}</span>
          <small>{area.childRefs.length ? "(" + area.childRefs.length + ")" : ""}</small>
          {!!area.hierarchyIssues.length && <b title={area.hierarchyIssues.join(", ")}>!</b>}
        </button>)}
        {!areas.length && <p>등록된 공사구역이 없습니다.</p>}
      </div>
      <div className="fw-areas-detail">
        {selected ? <><h3>{selected.name}</h3>
          <p>경로: {areas.filter(a => a.reference.objectId === selectedId ||
            a.reference.objectId === selected.treeParentRef?.objectId).map(a => a.name).join(" / ")}</p>
          <p>하위구역: {selected.childRefs.length}개 · 깊이 {selected.depth + 1}/{5}</p>
          <p>도면·검측·현장사진 연결에 공통 위치 ID를 사용합니다.</p>
          {isAdmin && <form onSubmit={e => { e.preventDefault(); void submit("/field/work-areas/" +
            selected.reference.objectId + "/edit", { name: editingName,
              parentId: selected.treeParentRef?.objectId || null,
              expectedVersion: selected.reference.version }); }}>
            <label>구역 이름<input value={editingName} onChange={e => setEditingName(e.target.value)} /></label>
            <button disabled={!online || working || !editingName.trim()}>이름 변경</button>
          </form>}</>
          : <p>왼쪽에서 공사구역을 선택하면 정보가 표시됩니다.</p>}
        {isAdmin && <form className="fw-areas-create" onSubmit={e => {
          e.preventDefault(); void submit("/field/work-areas", { name, kind, parentId: parentId || null });
        }}>
          <h3>공사구역 추가</h3>
          <label>상위 구역<select value={parentId} onChange={e => setParentId(e.target.value)}>
            <option value="">현장 최상위</option>
            {areas.filter(a => a.depth < 4).map(a =>
              <option key={a.reference.objectId} value={a.reference.objectId}>{"—".repeat(a.depth)} {a.name}</option>)}
          </select></label>
          <label>위치 구분<select value={kind} onChange={e => setKind(e.target.value as AreaKind)}>
            {Object.entries(kindNames).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select></label>
          <label>이름<input value={name} onChange={e => setName(e.target.value)} placeholder="예: A동, 2층, 전기실" /></label>
          <button disabled={!name.trim() || !online || working}>새 구역 등록</button>
        </form>}
      </div>
    </div>
  </section>;
}
