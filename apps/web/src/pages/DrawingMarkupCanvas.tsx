import { useRef, useState, type PointerEvent } from "react";
import type { DrawingSheetMarkup, DrawingMarkupKind, NewSheetMarkup } from "../data/drawing-sheet-client";
import { toSheetPoint, type NormalizedPoint } from "../data/drawing-markup-toolkit";

interface Props {
  tool: DrawingMarkupKind | "eraser" | "pointer";
  markups: DrawingSheetMarkup[];
  sheetVersion: number;
  color: string; lineWidth: number; text: string;
  mmPerSheetWidth: number | null;
  canWrite: boolean;
  onCreate: (item: NewSheetMarkup) => void;
  onErase: (item: DrawingSheetMarkup) => void;
}

const S = (p: NormalizedPoint) => [p.x * 1000, p.y * 1000] as const;

/** A closed run of outward quadratic scallops, not a dashed rectangle. */
function revisionCloudPath(x: number, y: number, width: number, height: number): string {
  if (width < 3 || height < 3) return `M ${x} ${y} h ${width} v ${height} h ${-width} Z`;
  const edges: Array<[number, number, number, number, number, number]> = [
    [x, y, x + width, y, 0, -1],
    [x + width, y, x + width, y + height, 1, 0],
    [x + width, y + height, x, y + height, 0, 1],
    [x, y + height, x, y, -1, 0],
  ];
  const path = [`M ${x} ${y}`];
  for (const [x0, y0, x1, y1, nx, ny] of edges) {
    const distance = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(distance / 23));
    const bulge = Math.min(13, Math.max(2.5, (distance / steps) * 0.55));
    for (let index = 0; index < steps; index++) {
      const middle = (index + 0.5) / steps;
      const next = (index + 1) / steps;
      const cx = x0 + (x1 - x0) * middle + nx * bulge;
      const cy = y0 + (y1 - y0) * middle + ny * bulge;
      const px = x0 + (x1 - x0) * next;
      const py = y0 + (y1 - y0) * next;
      path.push(`Q ${cx} ${cy} ${px} ${py}`);
    }
  }
  return path.join(" ") + " Z";
}


export function DrawingMarkupCanvas({
  tool, markups, sheetVersion, color, lineWidth, text, mmPerSheetWidth,
  canWrite, onCreate, onErase,
}: Props) {
  const [draft, setDraft] = useState<NormalizedPoint[] | null>(null);
  const active = useRef<NormalizedPoint[] | null>(null);
  const isDrawing = canWrite && tool !== "pointer" && tool !== "eraser";
  function point(event: PointerEvent<SVGSVGElement>) {
    return toSheetPoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect());
  }
  function begin(event: PointerEvent<SVGSVGElement>) {
    if (!isDrawing || event.button !== 0) return;
    event.stopPropagation();
    const p = point(event);
    active.current = [p];
    setDraft([p]);
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent<SVGSVGElement>) {
    if (!active.current) return;
    event.stopPropagation();
    const p = point(event);
    const pts = active.current;
    if (tool === "pen") {
      const last = pts[pts.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) > .002) {
        active.current = [...pts, p].slice(0, 500);
        setDraft(active.current);
      }
    } else {
      active.current = [pts[0], p];
      setDraft(active.current);
    }
  }
  function end(event: PointerEvent<SVGSVGElement>) {
    const pts = active.current;
    if (!pts) return;
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    active.current = null;
    setDraft(null);
    if (tool === "pointer" || tool === "eraser") return;
    const finalPoints = tool === "text" ? pts.slice(0, 1) : pts;
    if (tool !== "text" && (finalPoints.length < 2 ||
      Math.hypot(finalPoints[0].x - finalPoints[finalPoints.length - 1].x,
                 finalPoints[0].y - finalPoints[finalPoints.length - 1].y) < .005)) return;
    if (tool === "text" && !text.trim()) return;
    onCreate({tool, points: finalPoints, sheetVersion, color, lineWidth, text: tool === "text" ? text : ""});
  }

  function paint(toolKind: DrawingMarkupKind, pts: NormalizedPoint[], stroke: string,
                 width: number, label: string, key: string) {
    if (!pts.length) return null;
    const start = S(pts[0]);
    const endPoint = S(pts[pts.length - 1]);
    const x = Math.min(start[0], endPoint[0]);
    const y = Math.min(start[1], endPoint[1]);
    const w = Math.abs(start[0] - endPoint[0]);
    const h = Math.abs(start[1] - endPoint[1]);
    const common = {stroke, strokeWidth: width * 1.4, fill: "none" as const,
                    vectorEffect: "non-scaling-stroke" as const, strokeLinecap: "round" as const};
    if (toolKind === "pen") {
      return <polyline key={key} points={pts.map(p => S(p).join(",")).join(" ")} {...common}/>;
    }
    if (toolKind === "text") {
      return <text key={key} x={start[0]} y={start[1]} fill={stroke}
        stroke="none" fontSize="26" fontWeight="600">{label.slice(0, 500)}</text>;
    }
    if (toolKind === "rectangle") {
      return <rect key={key} x={x} y={y} width={w} height={h} {...common}/>;
    }
    if (toolKind === "cloud") {
      return <path key={key} d={revisionCloudPath(x, y, w, h)} {...common}/>;
    }
    if (toolKind === "ellipse") {
      return <ellipse key={key} cx={x + w / 2} cy={y + h / 2}
        rx={w / 2} ry={h / 2} {...common}/>;
    }
    const dx = endPoint[0] - start[0];
    const dy = endPoint[1] - start[1];
    const length = Math.max(1, Math.hypot(dx, dy));
    const ux = dx / length, uy = dy / length;
    const wings = [
      endPoint[0] - ux * 20 - uy * 9, endPoint[1] - uy * 20 + ux * 9,
      endPoint[0], endPoint[1],
      endPoint[0] - ux * 20 + uy * 9, endPoint[1] - uy * 20 - ux * 9
    ];
    return <g key={key}>
      <line x1={start[0]} y1={start[1]} x2={endPoint[0]} y2={endPoint[1]} {...common}/>
      {toolKind === "arrow" && <polyline points={
        wings.slice(0,2).join(",") + " " + wings.slice(2,4).join(",") + " " + wings.slice(4).join(",")
      } {...common}/>}
      {toolKind === "measure" && <text x={(start[0] + endPoint[0]) / 2}
        y={(start[1] + endPoint[1]) / 2 - 10} fontSize="23" stroke="none" fill={stroke}>
        {mmPerSheetWidth ? (Math.hypot(dx, dy) / 1000 * mmPerSheetWidth).toFixed(1) + " mm"
          : "축척 미설정"}
      </text>}
    </g>;
  }

  return <svg className={"drawing-board-markup-layer" + (isDrawing || (canWrite && tool === "eraser") ? " active" : "")}
    viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-label="도면 마크업 레이어"
    onPointerDown={begin} onPointerMove={move} onPointerUp={end} onPointerCancel={() => {
      active.current = null; setDraft(null);
    }}>
    {markups.map(item => <g key={item.id} className={tool === "eraser" ? "markup-erasable" : ""}
      onPointerDown={event => { if (tool === "eraser" && canWrite) event.stopPropagation(); }}
      onClick={event => {
        if (tool === "eraser" && canWrite) {
          event.stopPropagation();
          onErase(item);
        }
      }}>
      {paint(item.tool, item.points, item.color, item.lineWidth, item.text, item.id)}
    </g>)}
    {draft && isDrawing &&
      paint(tool, draft, color, lineWidth, text, "draft")}
  </svg>;
}
