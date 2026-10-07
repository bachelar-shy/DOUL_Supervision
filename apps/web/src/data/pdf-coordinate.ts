export interface PdfViewport {
  width: number;
  height: number;
  viewBox: readonly number[];
  convertToPdfPoint(x: number, y: number): readonly number[];
  convertToViewportPoint(x: number, y: number): readonly number[];
}

export interface CssRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PdfPoint {
  x: number;
  y: number;
}

export interface CssPoint {
  left: number;
  top: number;
}

function finitePoint(x: number, y: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y);
}

export function isPdfPointInViewBox(viewport: PdfViewport, point: PdfPoint): boolean {
  const [minX, minY, maxX, maxY] = viewport.viewBox;
  return Number.isFinite(minX) && Number.isFinite(minY) && Number.isFinite(maxX) && Number.isFinite(maxY)
    && minX <= point.x && point.x <= maxX && minY <= point.y && point.y <= maxY;
}

export function cssPointToPdfPoint(viewport: PdfViewport, rect: CssRect, clientX: number, clientY: number): PdfPoint | null {
  if (![viewport.width, viewport.height, rect.left, rect.top, rect.width, rect.height, clientX, clientY].every(Number.isFinite)) return null;
  if (viewport.width <= 0 || viewport.height <= 0 || rect.width <= 0 || rect.height <= 0) return null;
  const cssX = clientX - rect.left;
  const cssY = clientY - rect.top;
  if (cssX < 0 || cssY < 0 || cssX > rect.width || cssY > rect.height) return null;
  // PDF.js viewport dimensions are CSS-space values; device-pixel-ratio is intentionally excluded.
  const viewportX = cssX * viewport.width / rect.width;
  const viewportY = cssY * viewport.height / rect.height;
  const [x, y] = viewport.convertToPdfPoint(viewportX, viewportY);
  const point = { x, y };
  return finitePoint(x, y) && isPdfPointInViewBox(viewport, point) ? point : null;
}

export function pdfPointToCssPoint(viewport: PdfViewport, rect: Pick<CssRect, "width" | "height">, point: PdfPoint): CssPoint | null {
  if (![viewport.width, viewport.height, rect.width, rect.height, point.x, point.y].every(Number.isFinite)) return null;
  if (viewport.width <= 0 || viewport.height <= 0 || rect.width <= 0 || rect.height <= 0 || !isPdfPointInViewBox(viewport, point)) return null;
  const [viewportX, viewportY] = viewport.convertToViewportPoint(point.x, point.y);
  if (!finitePoint(viewportX, viewportY)) return null;
  const left = viewportX * rect.width / viewport.width;
  const top = viewportY * rect.height / viewport.height;
  return left >= 0 && top >= 0 && left <= rect.width && top <= rect.height ? { left, top } : null;
}
