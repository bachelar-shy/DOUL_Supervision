import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { normalizeLanguage } from "@doul/localization";
import type { SupervisionClient } from "../data/supervision-client";
import type { Workspace } from "../data/ui-contract";
import { fetchDrawingPdfBindings, type DrawingPdfBinding } from "../data/pdf-pin-client";
import { listPdfEvidenceSources } from "../data/pdf-viewer-client";
import "./drawing-review.css";

// Reuse the permission-checked PDF and canonical markup/Issue paths. The
// lightweight Review Core contributes the viewer-first navigation model.
const PdfViewerPanel = lazy(() => import("./parallel/PdfViewerPanel").then((module) => ({ default: module.PdfViewerPanel })));
const DrawingMarkupIssuePanel = lazy(() => import("./parallel/DrawingMarkupIssuePanel").then((module) => ({ default: module.DrawingMarkupIssuePanel })));

type Locale = "ko" | "vi" | "en";
interface DrawingChoice {
  key: string;
  evidenceId: string;
  bindingId?: string;
  title: string;
  description: string;
  version: string;
}

const labels: Record<Locale, Record<string, string>> = {
  ko: {
    list: "도면 목록", filter: "도면 검색", filterPlaceholder: "도면명·번호 검색", review: "도면 검토",
    connected: "연결된 도면", original: "PDF 증빙", loading: "도면 목록을 불러오는 중…",
    empty: "조회 가능한 PDF 도면이 없습니다.", emptyHelp: "해당 프로젝트에 PDF 원본과 도면 연결이 등록되어 있는지 확인하십시오.",
    noMatch: "검색 결과가 없습니다.", retry: "다시 조회", listError: "도면 연결 목록을 조회하지 못했습니다.",
    noSelection: "왼쪽 목록에서 도면을 선택하세요.", details: "마크업·지적사항", close: "상세 닫기",
    noMarkup: "도면에서 저장된 마크업을 선택하면 연결된 지적사항과 시정조치를 확인할 수 있습니다.",
    unverified: "도면의 승인 상태·개정·현장 배포 여부는 별도로 확인하십시오.",
    demoNote: "데모 관리자만 마크업을 저장할 수 있습니다. 그 외 역할은 원본 조회와 연결 기록 확인만 가능합니다.",
    version: "작성 차수",
  },
  vi: {
    list: "Danh sách bản vẽ", filter: "Tìm bản vẽ", filterPlaceholder: "Tên hoặc số bản vẽ", review: "Kiểm tra bản vẽ",
    connected: "Bản vẽ liên kết", original: "Tài liệu PDF", loading: "Đang tải danh sách bản vẽ…",
    empty: "Không có bản vẽ PDF được phép xem.", emptyHelp: "Hãy kiểm tra bản PDF và liên kết bản vẽ trong dự án.",
    noMatch: "Không tìm thấy bản vẽ.", retry: "Tải lại", listError: "Không thể tải danh sách liên kết bản vẽ.",
    noSelection: "Chọn một bản vẽ trong danh sách.", details: "Chú thích và vấn đề", close: "Đóng chi tiết",
    noMarkup: "Chọn chú thích đã lưu trên bản vẽ để xem vấn đề và biện pháp khắc phục được liên kết.",
    unverified: "Xác minh riêng trạng thái phê duyệt, phiên bản và phân phối bản vẽ tại công trường.",
    demoNote: "Chỉ quản trị viên demo có thể lưu chú thích; các vai trò khác chỉ xem bản vẽ và hồ sơ liên kết.",
    version: "Phiên bản",
  },
  en: {
    list: "Drawing list", filter: "Find drawings", filterPlaceholder: "Drawing title or number", review: "Drawing review",
    connected: "Linked drawing", original: "PDF evidence", loading: "Loading drawing list…",
    empty: "No accessible PDF drawings.", emptyHelp: "Check that the PDF source and drawing binding are registered in this project.",
    noMatch: "No matching drawings.", retry: "Refresh", listError: "Could not load drawing links.",
    noSelection: "Select a drawing from the list.", details: "Markups and issues", close: "Close details",
    noMarkup: "Select a saved drawing markup to inspect its linked issue and corrective action.",
    unverified: "Confirm approval, revision, and field-distribution status separately.",
    demoNote: "Only a demo administrator can save markups; other roles can view originals and linked records.",
    version: "Version",
  },
};

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function titleOf(record: { title?: unknown } | undefined, fallback: string): string {
  return typeof record?.title === "string" && record.title.trim() ? record.title : fallback;
}

export function DrawingReviewPage({ client, workspace, onNavigate, onChanged }: {
  client: SupervisionClient;
  workspace: Workspace;
  onNavigate: (route: string) => void;
  onChanged?: () => void;
}) {
  const { i18n } = useTranslation();
  const locale = normalizeLanguage(i18n.resolvedLanguage ?? i18n.language);
  const t = (key: string) => labels[locale][key] ?? labels.en[key] ?? key;
  const [bindings, setBindings] = useState<DrawingPdfBinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState("");
  const [selectedKey, setSelectedKey] = useState("");
  const [selectedMarkupId, setSelectedMarkupId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setListError("");
    setBindings([]);
    setSelectedKey("");
    setSelectedMarkupId(null);
    setDetailsOpen(false);
    void fetchDrawingPdfBindings(client).then((items) => {
      if (live) setBindings(items.filter((item) => item.projectId === workspace.project.id));
    }).catch(() => {
      if (live) setListError(t("listError"));
    }).finally(() => {
      if (live) setLoading(false);
    });
    return () => { live = false; };
  }, [client, workspace.project.id, workspace.role.id, retry]);

  const evidence = useMemo(() => listPdfEvidenceSources(workspace), [workspace]);
  const choices = useMemo<DrawingChoice[]>(() => {
    const boundEvidence = new Set(bindings.map((item) => item.evidenceRef.objectId));
    const registered = [...bindings].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((item) => {
      const work = workspace.items.find((entry) =>
        entry.record.id === item.drawingRef.objectId && entry.record.version === item.drawingRef.version);
      const revision = work?.record.revision;
      const displayRevision = typeof revision === "string" && revision.trim()
        ? revision : t("version") + " " + item.drawingRef.version;
      return {
        key: "binding:" + item.id,
        bindingId: item.id,
        evidenceId: item.evidenceRef.objectId,
        title: titleOf(work?.record, t("connected") + " " + shortId(item.drawingRef.objectId)),
        description: shortId(item.drawingRef.objectId) + " · " + displayRevision,
        version: displayRevision,
      };
    });
    const unbound = evidence.filter((item) => !boundEvidence.has(item.id)).map((item) => ({
      key: "evidence:" + item.id,
      evidenceId: item.id,
      title: item.name,
      description: t("original") + " · " + shortId(item.id),
      version: t("original"),
    }));
    return [...registered, ...unbound];
  }, [bindings, evidence, workspace, locale]);

  useEffect(() => {
    setSelectedKey((current) => choices.some((item) => item.key === current) ? current : choices[0]?.key ?? "");
  }, [choices]);

  const active = choices.find((item) => item.key === selectedKey);
  const filtered = choices.filter((item) => (item.title + " " + item.description)
    .toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const demoMarkupWriter = workspace.demo && workspace.role.actorGroup === "ADM"
    && client.session?.actor.actorGroup === "ADM"
    && client.session?.projectId === workspace.project.id
    && client.session?.actor.roleAssignmentId === workspace.role.id;

  return (
    <section className={"drawing-review" + (detailsOpen ? " has-details" : "")} data-ui-page="field-drawings" aria-label={t("review")}>
      <aside className="drawing-review-list" aria-label={t("list")}>
        <div className="drawing-review-list-heading">
          <strong>{t("list")}</strong>
          <button type="button" onClick={() => setRetry((value) => value + 1)} aria-label={t("retry")}>{t("retry")}</button>
        </div>
        <label className="drawing-review-search">{t("filter")}
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("filterPlaceholder")} />
        </label>
        <div className="drawing-review-choices" role="list">
          {loading && <p role="status">{t("loading")}</p>}
          {listError && <p role="alert">{listError}</p>}
          {!loading && filtered.map((item) => (
            <button role="listitem" type="button" key={item.key} className="drawing-review-choice"
              aria-current={active?.key === item.key ? "true" : undefined}
              onClick={() => { setSelectedKey(item.key); setSelectedMarkupId(null); setDetailsOpen(false); }}>
              <span className="drawing-review-choice-title">{item.title}</span>
              <span className="drawing-review-choice-detail">{item.description}</span>
            </button>
          ))}
          {!loading && choices.length === 0 && <p>{t("empty")} {t("emptyHelp")}</p>}
          {!loading && choices.length > 0 && filtered.length === 0 && <p>{t("noMatch")}</p>}
        </div>
      </aside>

      <div className="drawing-review-center">
        <div className="drawing-review-context">
          <div>
            <strong>{active?.title ?? t("review")}</strong>
            <small>{active?.description ?? t("noSelection")}</small>
          </div>
          <button type="button" aria-expanded={detailsOpen} aria-controls="drawing-review-details"
            onClick={() => setDetailsOpen((value) => !value)}>
            {detailsOpen ? t("close") : t("details")}
          </button>
        </div>
        <p className="drawing-review-source-note">{t("unverified")}</p>
        {active ? (
          <div className="drawing-review-viewer">
            <Suspense fallback={<div role="status">{t("loading")}</div>}>
              <PdfViewerPanel key={workspace.project.id + ":" + workspace.role.id + ":" + active.key}
                client={client} workspace={workspace} readOnly={!demoMarkupWriter}
                selectedReviewSource={{ evidenceId: active.evidenceId, bindingId: active.bindingId }}
                onSelectMarkup={(id) => { setSelectedMarkupId(id); if (id) setDetailsOpen(true); }}
                onChanged={onChanged} />
            </Suspense>
          </div>
        ) : <div className="drawing-review-empty">{t("noSelection")}</div>}
        {active && <p className="drawing-review-scope-note">{t("demoNote")}</p>}
      </div>

      {detailsOpen && (
        <aside className="drawing-review-details" id="drawing-review-details" aria-label={t("details")}>
          <div className="drawing-review-list-heading">
            <strong>{t("details")}</strong>
            <button type="button" aria-label={t("close")} onClick={() => setDetailsOpen(false)}>×</button>
          </div>
          {!selectedMarkupId ? <p>{t("noMarkup")}</p> : (
            <Suspense fallback={<div role="status">{t("loading")}</div>}>
              <DrawingMarkupIssuePanel client={client} workspace={workspace} selectedMarkupId={selectedMarkupId}
                onSelect={setSelectedMarkupId} onNavigate={onNavigate} onChanged={onChanged} />
            </Suspense>
          )}
        </aside>
      )}
    </section>
  );
}
