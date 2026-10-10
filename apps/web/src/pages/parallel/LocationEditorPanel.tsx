import { recordVersionLabel } from "../../labels";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupervisionClient } from "../../data/supervision-client";
import { ApiError } from "../../data/supervision-client";
import type { Workspace } from "../../data/ui-contract";
import { formatNumber } from "../../i18n/format";
import { reasonLabel } from "../../labels";
import { DrawingLocationFields } from "./DrawingLocationFields";

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
type LabelKey =
  | "region" | "title" | "project" | "drawingHint" | "refresh" | "loading" | "errorGeneric"
  | "empty" | "list" | "name" | "anchor" | "parent" | "root" | "drawingAnchors" | "anchorHint"
  | "saving" | "save" | "addChild" | "readOnly" | "anchorsArrayError" | "created" | "updated";
const copy: Record<"ko" | "vi" | "en", Record<LabelKey, string>> = {
  ko: {
    region: "위치 편집", title: "위치 계층 편집", project: "현장", drawingHint: "도면 표시 위치는 도면 작성 차수와 PDF 도면 좌표를 사용합니다.",
    refresh: "새로고침", loading: "위치를 불러오는 중입니다…", errorGeneric: "위치 요청을 완료할 수 없습니다. 연결을 확인한 뒤 다시 시도하세요.",
    empty: "표시할 위치가 없습니다.", list: "위치 목록", name: "위치 이름",
    anchor: "위치 구분명", parent: "상위 위치", root: "현장 최상위", drawingAnchors: "도면 표시 위치",
    anchorHint: "도면과 작성 차수, 도면 쪽, 가로·세로 표시 위치를 지정하십시오.",
    saving: "저장 중…", save: "변경 저장", addChild: "하위 위치 추가",
    readOnly: "조회 전용입니다. 위치 관리 권한이 있는 시험 현장 관리자만 편집할 수 있습니다. 저장 시 담당 권한을 다시 확인합니다.",
    anchorsArrayError: "도면 표시 위치를 확인하십시오.", created: "위치를 만들었습니다.", updated: "위치를 수정했습니다.",
  },
  vi: {
    region: "Chỉnh sửa vị trí", title: "Chỉnh sửa hệ thống phân cấp vị trí", project: "Dự án", drawingHint: "Neo bản vẽ sử dụng phiên bản bản vẽ và tọa độ điểm PDF.",
    refresh: "Làm mới", loading: "Đang tải vị trí…", errorGeneric: "Không thể hoàn tất yêu cầu vị trí. Hãy kiểm tra kết nối rồi thử lại.",
    empty: "Không có vị trí để hiển thị.", list: "Danh sách vị trí", name: "Tên vị trí",
    anchor: "Neo ngữ nghĩa", parent: "Vị trí cha", root: "Cấp cao nhất của dự án", drawingAnchors: "Neo bản vẽ (JSON)",
    anchorHint: "Cần tham chiếu bản vẽ chính xác, trang từ 1 trở lên, x/y hữu hạn và hệ tọa độ pdf_points.",
    saving: "Đang lưu…", save: "Lưu thay đổi", addChild: "Thêm vị trí con",
    readOnly: "Chỉ xem. Có thể chỉnh sửa khi xác nhận vai trò ADM / project_admin và quyền render_document trong dự án demo. Máy chủ sẽ kiểm tra lại quyền lưu.",
    anchorsArrayError: "Neo bản vẽ phải là một mảng JSON.", created: "Đã tạo vị trí.", updated: "Đã cập nhật vị trí.",
  },
  en: {
    region: "Edit locations", title: "Edit location hierarchy", project: "Project", drawingHint: "Drawing anchors use the drawing version and PDF point coordinates.",
    refresh: "Refresh", loading: "Loading locations…", errorGeneric: "The location request could not be completed. Check the connection and try again.",
    empty: "There are no locations to display.", list: "Location list", name: "Location name",
    anchor: "Semantic anchor", parent: "Parent location", root: "Project root", drawingAnchors: "Drawing anchors (JSON)",
    anchorHint: "Use an exact drawing reference, a page of 1 or greater, finite x/y values, and the pdf_points coordinate system.",
    saving: "Saving…", save: "Save changes", addChild: "Add child location",
    readOnly: "Read only. Editing is available when the demo project confirms the ADM / project_admin role and render_document authority. The server checks save authority again.",
    anchorsArrayError: "Drawing anchors must be a JSON array.", created: "Location created.", updated: "Location updated.",
  },
};
type LocationError = { kind: "api"; code: string } | { kind: "local"; key: "anchorsArrayError" } | { kind: "generic" };
class LocationEditorValidationError extends Error {
  readonly key: "anchorsArrayError";
  constructor(key: "anchorsArrayError") {
    super(key);
    this.key = key;
  }
}
function activeCopy(): Record<LabelKey, string> {
  const language = typeof document === "undefined" ? "en" : document.documentElement.lang.slice(0, 2);
  return copy[language === "ko" || language === "vi" ? language : "en"];
}
function errorCopy(error: LocationError | null, labels: Record<LabelKey, string>): string {
  if (!error) return "";
  if (error.kind === "api") return reasonLabel(error.code);
  if (error.kind === "local") return labels[error.key];
  return labels.errorGeneric;
}

export function LocationEditorPanel({ client, workspace, onChanged }: {
  client: SupervisionClient;
  workspace: Workspace;
  onChanged?: () => void;
}) {
  const t = activeCopy();
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
  const [error, setError] = useState<LocationError | null>(null);
  const [message, setMessage] = useState("");
  const selected = useMemo(() => rows.find(row => idOf(row) === selectedId), [rows, selectedId]);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError(null);
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
        setError(cause instanceof ApiError ? { kind: "api", code: cause.detail.code } : { kind: "generic" });
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
    setError(null);
    setMessage("");
    try {
      const anchors: unknown = JSON.parse(drawingJson);
      if (!Array.isArray(anchors)) throw new LocationEditorValidationError("anchorsArrayError");
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
      setMessage(create ? t.created : t.updated);
      await load();
      onChanged?.();
    } catch (cause) {
      if (cause instanceof ApiError) setError({ kind: "api", code: cause.detail.code });
      else if (cause instanceof LocationEditorValidationError) setError({ kind: "local", key: cause.key });
      else setError({ kind: "generic" });
    } finally {
      setSaving(false);
    }
  }, [canManage, client, drawingJson, load, name, onChanged, parentId, t,
    selected?.reference.version, selectedId, semanticAnchor]);

  return (
    <section aria-label={t.region} className="rounded-sm border border-border bg-card p-4 text-card-foreground">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
        <div>
          <h2 className="text-base font-semibold">{t.title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t.project} {workspace.project.name} · {t.drawingHint}</p>
        </div>
        <button type="button" aria-label={t.refresh} className="rounded-sm border border-border px-3 py-2 text-xs hover:bg-muted" onClick={() => void load()} disabled={loading}>
          {loading ? t.loading : t.refresh}
        </button>
      </header>
      {error && <div role="alert" className="mb-3 rounded-sm border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{errorCopy(error, t)}</div>}
      {message && <div role="status" className="mb-3 rounded-sm border border-doul-success/30 bg-doul-success/5 p-3 text-sm">{message}</div>}
      <div className="grid gap-4 lg:grid-cols-[minmax(14rem,0.8fr)_minmax(0,1.4fr)]">
        <nav aria-label={t.list} className="max-h-[32rem] space-y-1 overflow-auto rounded-sm border border-border bg-background p-2">
          {loading && rows.length === 0 && <p className="p-2 text-sm text-muted-foreground">{t.loading}</p>}
          {!loading && rows.length === 0 && <p className="p-2 text-sm text-muted-foreground">{t.empty}</p>}
          {rows.map(row => (
            <button type="button" key={idOf(row)} aria-current={selectedId === idOf(row) ? "true" : undefined}
              onClick={() => setSelectedId(idOf(row))}
              className={`flex w-full items-center justify-between gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-muted ${selectedId === idOf(row) ? "bg-doul-primary-muted font-medium text-doul-primary-deep" : ""}`}
              style={{ paddingLeft: `${8 + row.depth * 16}px` }}>
              <span className="truncate">{row.name}</span><small className="shrink-0 text-muted-foreground">{recordVersionLabel(formatNumber(row.reference.version))}</small>
            </button>
          ))}
        </nav>
        <form className="space-y-3" onSubmit={event => { event.preventDefault(); void submit(false); }}>
          <label className="block space-y-1 text-sm font-medium">{t.name}
            <input className="w-full rounded-sm border border-input bg-background px-3 py-2 text-sm font-normal" value={name} onChange={event => setName(event.target.value)} readOnly={!canManage} required />
          </label>
          <label className="block space-y-1 text-sm font-medium">{t.anchor}
            <input className="w-full rounded-sm border border-input bg-background px-3 py-2 text-sm font-normal" value={semanticAnchor} onChange={event => setSemanticAnchor(event.target.value)} readOnly={!canManage} required />
          </label>
          <label className="block space-y-1 text-sm font-medium">{t.parent}
            <select className="w-full rounded-sm border border-input bg-background px-3 py-2 text-sm font-normal" value={parentId} onChange={event => setParentId(event.target.value)} disabled={!canManage}>
              <option value="">{t.root}</option>
              {rows.filter(row => idOf(row) !== selectedId).map(row => <option key={idOf(row)} value={idOf(row)}>{"　".repeat(row.depth)}{row.name}</option>)}
            </select>
          </label>
          <fieldset className="block space-y-1 text-sm font-medium"><legend>{t.drawingAnchors}</legend>
            <DrawingLocationFields client={client} projectId={workspace.project.id} value={drawingJson} onChange={setDrawingJson} disabled={!canManage || saving} />
          </fieldset>
          <p className="-mt-2 text-xs text-muted-foreground">{t.anchorHint}</p>
          {canManage ? (
            <div className="flex flex-wrap gap-2">
              <button type="submit" className="rounded-sm bg-doul-primary px-3 py-2 text-sm font-medium text-white hover:bg-doul-primary-deep" disabled={saving || !selected}>{saving ? t.saving : t.save}</button>
              <button type="button" className="rounded-sm border border-border px-3 py-2 text-sm hover:bg-muted" disabled={saving || !selected} onClick={() => void submit(true)}>{t.addChild}</button>
            </div>
          ) : (
            <p role="note" className="rounded-sm border border-border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
              {t.readOnly}
            </p>
          )}
        </form>
      </div>
    </section>
  );
}
