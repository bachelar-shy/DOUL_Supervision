import { useLayoutEffect, useRef, useState } from "react";
import type { DrawingSheetPin } from "../data/drawing-sheet-client";
import "./drawing-pin-indicators.css";

export type PinMarker = Pick<DrawingSheetPin, "kind" | "x" | "y"> & {
  id?: string; pinId?: string;
};
const labels = {issue: "지적·이슈", inspection: "검측", site: "현장상황"} as const;
const order = ["issue", "inspection", "site"] as const;

/** Color is redundant with text; absence of a pin is never represented as zero evidence. */
export function DrawingPinCountBadges({ pins }: { pins: readonly PinMarker[] }) {
  return <span className="drawing-pin-badges" aria-label="도면별 현장 마크 건수">
    {order.map(kind => {
      const count = pins.filter(pin => pin.kind === kind).length;
      return count > 0 ? <span key={kind} className={"drawing-pin-badge " + kind}
        aria-label={labels[kind] + " " + count + "건"}>
        <span aria-hidden="true" className="drawing-pin-badge-dot" />
        {labels[kind]} {count}
      </span> : null;
    })}
  </span>;
}

/** Markers use the actual contained image box rather than the thumbnail viewport:
 * white letterboxes must not shift the coordinates recorded on the source sheet.
 */
export function DrawingThumbnailPins({ pins, naturalSize }: {
  pins: readonly PinMarker[];
  naturalSize: { width: number; height: number } | null;
}) {
  const root = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState({width: 0, height: 0});
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const valid = !!(naturalSize && naturalSize.width > 0 && naturalSize.height > 0 &&
    size.width > 0 && size.height > 0);
  const scale = valid && naturalSize ? Math.min(size.width / naturalSize.width,
    size.height / naturalSize.height) : 0;
  const width = naturalSize ? naturalSize.width * scale : 0;
  const height = naturalSize ? naturalSize.height * scale : 0;
  const offsetX = (size.width - width) / 2;
  const offsetY = (size.height - height) / 2;
  return <span ref={root} className="drawing-thumbnail-pins" aria-hidden="true">
    {valid && pins.slice(0, 30).map((pin, index) =>
      <span key={pin.id ?? pin.pinId ?? index} className={"drawing-thumbnail-pin " + pin.kind}
        style={{
          left: offsetX + Math.max(0, Math.min(1, pin.x)) * width,
          top: offsetY + Math.max(0, Math.min(1, pin.y)) * height,
        }}>{index + 1}</span>)}
  </span>;
}
