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


# Very dense vector-text PDF plans can contain >1 million characters on one page.
# The titleblock often appears near the *end*; truncating the first 250k loses it.
# Keep labeled field neighborhoods, preserving page-local order and bounded memory.
_TITLEBLOCK_HINT = re.compile(
    r"Drawing\s*(?:Number|No\.?|Title|Name)|DWG\.?\s*(?:No\.?|Number)|"
    r"Sheet\s*(?:No\.?|Number|Title)|SỐ\s*HIỆU\s*BẢN\s*VẼ|"
    r"SỐ\s*BẢN\s*VẼ|TÊN\s*BẢN\s*VẼ",
    re.IGNORECASE,
)
_MAX_PDF_INDEX_TEXT = 250000


def _titleblock_excerpt(content: str) -> str:
    """Select explicit drawing-label rows even if they follow a huge PDF drawing body."""
    if len(content) <= _MAX_PDF_INDEX_TEXT:
        return content
    lines = content.splitlines()
    markers = [i for i, line in enumerate(lines) if _TITLEBLOCK_HINT.search(line)]
    if not markers:
        return content[-_MAX_PDF_INDEX_TEXT:]
    nearby = set()
    for index in markers[-60:]:
        nearby.update(range(max(index - 2, 0), min(index + 7, len(lines))))
    extracts: list[str] = []
    remaining = _MAX_PDF_INDEX_TEXT
    for index in sorted(nearby, reverse=True):
        line = lines[index].strip()
        if not line:
            continue
        if len(line) > 10000:
            matches = list(_TITLEBLOCK_HINT.finditer(line))
            if matches:
                pos = matches[-1].start()
                line = line[max(0, pos - 256):pos + 3000]
            else:
                line = line[-2000:]
        line = line[-min(len(line), remaining):]
        if not line:
            break
        extracts.append(line)
        remaining -= len(line) + 1
        if remaining <= 0:
            break
    return "\n".join(reversed(extracts))


def pdf_page_text(pdf_path: Path, page: int) -> str:
    """Extract only the selected page for titleblock indexing, not vector display."""
    result = _run(["pdftotext", "-f", str(page), "-l", str(page),
                   "-layout", str(pdf_path), "-"], RENDER_TIMEOUT)
    return _titleblock_excerpt(result.stdout.decode("utf-8", errors="replace"))
