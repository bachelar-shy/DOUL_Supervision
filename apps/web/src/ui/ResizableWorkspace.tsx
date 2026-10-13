import {
  Children,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { Columns2, PanelLeft, PanelRight, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

type Kind = "workbench" | "owner" | "document" | "dashboard" | "diagnostic";
type View = "split" | "first" | "second";
type Language = "ko" | "vi" | "en";
type Labels = Record<Language, string>;

const translations = {
  group: { ko: "화면 배치", vi: "Bố cục màn hình", en: "Workspace layout" },
  split: { ko: "분할 보기", vi: "Chia đôi", en: "Split view" },
  both: { ko: "모두 보기", vi: "Xem tất cả", en: "Show both" },
  automatic: { ko: "자동 보기", vi: "Xem tự động", en: "Automatic view" },
  reset: { ko: "패널 폭 초기화", vi: "Đặt lại chiều rộng", en: "Reset pane width" },
  separator: { ko: "패널 폭 조절", vi: "Điều chỉnh độ rộng", en: "Resize panes" },
  list: { ko: "목록만 보기", vi: "Chỉ xem danh sách", en: "List only" },
  detail: { ko: "상세만 보기", vi: "Chỉ xem chi tiết", en: "Detail only" },
  editor: { ko: "작성만 보기", vi: "Chỉ xem biểu mẫu", en: "Editor only" },
  preview: { ko: "미리보기만 보기", vi: "Chỉ xem bản xem trước", en: "Preview only" },
  priority: { ko: "우선 업무만 보기", vi: "Chỉ xem ưu tiên", en: "Priority only" },
  summary: { ko: "현황만 보기", vi: "Chỉ xem tổng quan", en: "Summary only" },
} satisfies Record<string, Labels>;

const storePrefix = "doul.ui.split.v1.";
const gutter = 14;
const compactAt = 760;
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

function getSavedRatio(id: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(storePrefix + id);
    if (!raw) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 15 && value <= 85 ? value : fallback;
  } catch {
    return fallback;
  }
}

export interface ResizableWorkspaceProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  kind: Kind;
  layoutId?: string;
  hasDetail?: boolean;
  firstPercent?: number;
  topToolbar?: ReactNode;
}

export function ResizableWorkspace({
  children, kind, layoutId, hasDetail = false, topToolbar,
  firstPercent = kind === "dashboard" ? 65 : kind === "document" ? 36
    : kind === "workbench" || kind === "owner" ? 68 : 34,
  className, style, ...props
}: ResizableWorkspaceProps) {
  const { i18n } = useTranslation();
  const code = (i18n.resolvedLanguage || i18n.language || "ko").split("-")[0];
  const language: Language = code === "vi" || code === "en" ? code : "ko";
  const label = (key: keyof typeof translations) => translations[key][language];
  const route = typeof window === "undefined" ? kind : window.location.hash.replace(/^#\/?/, "") || kind;
  const scope = layoutId || kind + ":" + route;
  const id = useId();
  const bodyRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef<number | null>(null);
  const previousDetailRef = useRef<{ scope: string; value: boolean } | null>(null);
  const [width, setWidth] = useState(0);
  const [override, setOverride] = useState<{ scope: string; ratio: number } | null>(null);
  const [focus, setFocus] = useState<{ scope: string; view: View } | null>(null);

  const stored = useMemo(() => getSavedRatio(scope, firstPercent), [scope, firstPercent]);
  const preferred = override?.scope === scope ? override.ratio : stored;
  const compact = width > 0 && width < compactAt;
  const minFirst = kind === "document" ? 280 : 240;
  const minSecond = kind === "document" ? 350 : 320;
  const bounds = useMemo(() => {
    if (width < compactAt) return { min: 20, max: 80 };
    const usable = width - gutter;
    const min = Math.max(20, Math.ceil(minFirst / usable * 100));
    const max = Math.min(80, Math.floor((usable - minSecond) / usable * 100));
    return min <= max ? { min, max } : { min: 20, max: 80 };
  }, [width, minFirst, minSecond]);
  const ratio = clamp(preferred, bounds.min, bounds.max);
  // Fieldwire-style tasks fill the workspace until a record is selected.
  // The detail opens contextually without changing the current route or list scroll.
  const listFirst = kind === "workbench" || kind === "owner";
  const view = focus?.scope === scope ? focus.view
    : listFirst && !hasDetail ? "first" : "split";
  const effectiveView: View =
    compact && view === "split" && (kind === "workbench" || kind === "owner")
      ? (hasDetail ? "second" : "first")
      : view;

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const measure = () => setWidth(body.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (override?.scope !== scope) return;
    try { window.localStorage.setItem(storePrefix + scope, String(override.ratio)); }
    catch { /* Layout preferences are optional. */ }
  }, [scope, override]);

  useEffect(() => {
    const prev = previousDetailRef.current;
    if (listFirst && prev?.scope === scope && prev.value !== hasDetail) {
      setFocus({ scope, view: hasDetail ? "split" : "first" });
    }
    previousDetailRef.current = { scope, value: hasDetail };
  }, [hasDetail, scope, listFirst]);

  const setRatio = (next: number) =>
    setOverride({ scope, ratio: clamp(next, bounds.min, bounds.max) });

  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (compact || view !== "split" || event.button !== 0) return;
    event.preventDefault();
    pointerRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus();
  };
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (pointerRef.current !== event.pointerId || !bodyRef.current) return;
    const box = bodyRef.current.getBoundingClientRect();
    if (box.width > 0) setRatio((event.clientX - box.left) / box.width * 100);
  };
  const pointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (pointerRef.current !== event.pointerId) return;
    pointerRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (compact || view !== "split") return;
    const steps: Record<string, number> = {
      ArrowLeft: ratio - 5, ArrowRight: ratio + 5,
      Home: bounds.min, End: bounds.max,
    };
    if (!(event.key in steps)) return;
    event.preventDefault();
    setRatio(steps[event.key]);
  };

  const splitLabel = compact
    ? (kind === "workbench" || kind === "owner" ? label("automatic") : label("both"))
    : label("split");
  const firstLabel = kind === "document" ? label("editor") :
    kind === "dashboard" ? label("priority") : label("list");
  const secondLabel = kind === "document" ? label("preview") :
    kind === "dashboard" ? label("summary") : label("detail");
  const panes = Children.toArray(children);
  if (panes.length !== 2) return <div className={className} style={style} {...props}>{children}</div>;

  return (
    <div
      className={cn("doul-resizable-workspace", className, hasDetail && "has-detail")}
      style={style}
      data-ui-component="resizable-workspace"
      data-layout-id={scope}
      data-kind={kind}
      data-compact={String(compact)}
      data-view={effectiveView}
      {...props}
    >
      <div className="doul-layout-controls" role="group" aria-label={label("group")}
        data-has-toolbar={topToolbar ? "true" : "false"}>
        {topToolbar}
        <div className="doul-layout-choices">
          <button type="button" data-layout-action="first" aria-pressed={view === "first"}
            aria-label={firstLabel} title={firstLabel}
            onClick={() => setFocus({ scope, view: "first" })}>
            <PanelLeft aria-hidden="true" size={15} /><span>{firstLabel}</span>
          </button>
          <button type="button" data-layout-action="split" aria-pressed={view === "split"}
            aria-label={splitLabel} title={splitLabel}
            onClick={() => setFocus({ scope, view: "split" })}>
            <Columns2 aria-hidden="true" size={15} />
            <span>{splitLabel}</span>
          </button>
          <button type="button" data-layout-action="second" aria-pressed={view === "second"}
            aria-label={secondLabel} title={secondLabel}
            onClick={() => setFocus({ scope, view: "second" })}>
            <PanelRight aria-hidden="true" size={15} /><span>{secondLabel}</span>
          </button>
        </div>
        <button type="button" className="doul-layout-reset"
          data-layout-action="reset" title={label("reset")} aria-label={label("reset")}
          onClick={() => { setRatio(firstPercent); setFocus({ scope, view: "split" }); }}>
          <RotateCcw aria-hidden="true" size={15} />
        </button>
      </div>
      <div ref={bodyRef} className="doul-resizable-body"
        style={{ "--doul-split-first": String(ratio) + "%" } as CSSProperties}>
        <div id={id + "-first"} className="doul-resizable-pane doul-resizable-first"
          data-layout-pane="first">{panes[0]}</div>
        <div className="doul-resizable-divider" role="separator"
          tabIndex={compact || view !== "split" ? -1 : 0}
          aria-label={label("separator")} aria-orientation="vertical"
          aria-controls={id + "-first " + id + "-second"}
          aria-valuemin={bounds.min} aria-valuemax={bounds.max}
          aria-valuenow={Math.round(ratio)}
          aria-valuetext={String(Math.round(ratio)) + "%"}
          onPointerDown={pointerDown} onPointerMove={pointerMove}
          onPointerUp={pointerEnd} onPointerCancel={pointerEnd}
          onDoubleClick={() => setRatio(firstPercent)} onKeyDown={keyDown}
        />
        <div id={id + "-second"} className="doul-resizable-pane doul-resizable-second"
          data-layout-pane="second">{panes[1]}</div>
      </div>
    </div>
  );
}
