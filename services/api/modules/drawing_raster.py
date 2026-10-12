"""Rasterize a PDF set into lightweight, per-sheet JPEG previews.

No vector PDF is delivered to the viewer. Poppler executes in bounded child
processes with no shell; the original PDF is retained once in private storage.
"""
from __future__ import annotations

from pathlib import Path
import re
import subprocess
import tempfile

MAX_SOURCE_BYTES = 20 * 1024 * 1024
MAX_SHEETS = 150
MAX_PREVIEW_BYTES = 4 * 1024 * 1024
PDFINFO_TIMEOUT = 18
RENDER_TIMEOUT = 28


class PdfSheetError(Exception):
    pass


def _run(args: list[str], timeout: int) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(args, check=True, timeout=timeout, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, stdin=subprocess.DEVNULL)
    except (FileNotFoundError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        raise PdfSheetError("PDF 분석 또는 페이지 이미지 변환 실패") from exc


def pdf_pages(pdf_path: Path) -> int:
    value = _run(["pdfinfo", str(pdf_path)], PDFINFO_TIMEOUT).stdout.decode("utf-8", errors="replace")
    match = re.search(r"^Pages:\s*(\d+)\s*$", value, re.MULTILINE)
    if not match:
        raise PdfSheetError("PDF 페이지 수를 확인할 수 없습니다")
    count = int(match.group(1))
    if count < 1 or count > MAX_SHEETS:
        raise PdfSheetError(f"PDF 페이지 수는 1~{MAX_SHEETS}장만 지원합니다")
    return count


def page_image(pdf_path: Path, page: int, *, thumb: bool = False) -> bytes:
    size = 330 if thumb else 2200
    quality = 56 if thumb else 76
    with tempfile.TemporaryDirectory(prefix="doul-page-render-") as temp:
        target = Path(temp) / "image"
        _run(["pdftoppm", "-f", str(page), "-l", str(page), "-singlefile",
              "-jpeg", "-jpegopt", f"quality={quality},optimize=y",
              "-scale-to", str(size), str(pdf_path), str(target)], RENDER_TIMEOUT)
        output = target.with_suffix(".jpg")
        if not output.is_file():
            raise PdfSheetError("PDF 이미지가 생성되지 않았습니다")
        data = output.read_bytes()
    if not data.startswith(b"\xff\xd8\xff") or len(data) > MAX_PREVIEW_BYTES:
        raise PdfSheetError("이미지가 크기 제한을 초과하거나 올바르지 않습니다")
    return data
