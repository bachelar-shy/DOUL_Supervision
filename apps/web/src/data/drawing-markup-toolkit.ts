/** Drawing overlay primitives: independent of the immutable source PDF. */
export type MarkupTool = "pointer" | "pin" | "link" | "pen" | "line" | "arrow" |
  "rectangle" | "ellipse" | "cloud" | "text" | "measure" | "eraser";

export interface NormalizedPoint { x: number; y: number }
export interface DrawingMarkup {
  id: string;
  sheetId: string;
  sheetVersion: number;
  tool: Exclude<MarkupTool, "pointer" | "eraser">;
  points: NormalizedPoint[];
  color: string;
  lineWidth: number;
  text?: string;
  relatedRecordId?: string;
}

export const DRAWING_MARKUP_TOOLS: ReadonlyArray<{ tool: MarkupTool; label: string }> = [
  { tool: "pointer", label: "선택" },
  { tool: "pin", label: "현장 마크" },
  { tool: "link", label: "도면 연결" },
  { tool: "pen", label: "자유선" },
  { tool: "line", label: "직선" },
  { tool: "arrow", label: "화살표" },
  { tool: "rectangle", label: "사각형" },
  { tool: "ellipse", label: "원·타원" },
  { tool: "cloud", label: "수정구름" },
  { tool: "text", label: "문자" },
  { tool: "measure", label: "거리 측정" },
  { tool: "eraser", label: "삭제" },
];

export function toSheetPoint(clientX: number, clientY: number, bounds: DOMRect): NormalizedPoint {
  if (bounds.width <= 0 || bounds.height <= 0) throw new Error("Invalid sheet bounds");
  return {
    x: Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width)),
    y: Math.max(0, Math.min(1, (clientY - bounds.top) / bounds.height)),
  };
}

export function validateMarkup(item: DrawingMarkup): boolean {
  return Boolean(item.id && item.sheetId && Number.isInteger(item.sheetVersion) && item.sheetVersion > 0 &&
    item.points.length > 0 && item.points.every(p =>
      Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1) &&
    item.lineWidth > 0 && Number.isFinite(item.lineWidth));
}

/** Explicit control points are required before comparing or migrating markups across revisions. */
export function canAlignRevisions(a: { sheetId: string; revision: string },
  b: { sheetId: string; revision: string }, confirmedControlPoints: number): boolean {
  return a.sheetId !== b.sheetId && a.revision !== b.revision && confirmedControlPoints >= 2;
}
