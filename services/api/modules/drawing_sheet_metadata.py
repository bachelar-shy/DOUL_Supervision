"""Extract conservative per-page sheet identity from PDF text, never infer approval.

Supports English and Vietnamese titleblocks. A number without a nearby explicit
titleblock label is NOT evidence; a conflicting or unreadable field remains blank.
Original PDF bytes and approval/issue status are never changed by this parser.
"""
from __future__ import annotations

from dataclasses import dataclass
import re

NUMBER_FIELD = re.compile(
    r"(?:Drawing\s*(?:Number|No\.?)|DWG\.?\s*(?:No\.?|Number)|"
    r"Sheet\s*(?:No\.?|Number)|SỐ\s*HIỆU\s*BẢN\s*VẼ|SỐ\s*BẢN\s*VẼ)",
    re.IGNORECASE,
)
NUMBER_CODE = re.compile(
    r"\b[A-Z]{1,5}(?:[-._][A-Z0-9]{1,5}){0,3}[-._]?\d{2,5}[A-Z]?\b",
    re.IGNORECASE,
)
TITLE_FIELD = re.compile(
    r"(?:Drawing\s*(?:Title|Name)|Sheet\s*Title|TÊN\s*BẢN\s*VẼ)",
    re.IGNORECASE,
)
STOP_FIELD = re.compile(
    r"^(?:Rev(?:ision)?(?:\s*No\.?)?\b|Date\b|Scale\b|Drawing\s*(?:No\.?|Number)\b|"
    r"DWG\.?\s*(?:No\.?|Number)\b|SỐ\s*HIỆU\s*BẢN\s*VẼ\b|"
    r"LẦN\s*SỬA\b|Project\s*Name\b|Checked\s*By\b|Drawn\s*By\b)",
    re.IGNORECASE,
)
NUMERIC_ONLY = re.compile(r"^[\d\s+\-./%]+$")


@dataclass(frozen=True)
class SheetCandidate:
    page: int
    number: str | None
    title: str | None
    needs_review: bool
    provenance: str


def _candidate_numbers(lines: list[str]) -> list[str]:
    candidates: list[str] = []
    for index, line in enumerate(lines):
        field = NUMBER_FIELD.search(line)
        if not field:
            continue
        # Right of the explicit titleblock label; prefer the same row.
        suffix = line[field.end():].strip(" \t:./#|-")
        found = NUMBER_CODE.search(suffix)
        if found:
            candidates.append(found.group(0).upper())
            continue
        # Some text PDF extractors place the field value on the next row.
        for next_line in lines[index + 1:index + 3]:
            if NUMBER_FIELD.search(next_line) or TITLE_FIELD.search(next_line) or STOP_FIELD.match(next_line):
                break
            if NUMBER_CODE.fullmatch(next_line.strip()):
                candidates.append(next_line.strip().upper())
                break
            if next_line.strip():
                break
    return list(dict.fromkeys(candidates))


def _candidate_titles(lines: list[str]) -> list[str]:
    titles: list[str] = []
    for index, line in enumerate(lines):
        fields = list(TITLE_FIELD.finditer(line))
        if not fields:
            continue
        # English label is often repeated after a Vietnamese label on the same row.
        field = next((f for f in reversed(fields)
                      if f.group(0).lower().startswith(("drawing", "sheet"))), fields[-1])
        suffix = line[field.end():].strip(" :|/-\t")
        fragments: list[str] = []
        if suffix and not TITLE_FIELD.search(suffix) and not STOP_FIELD.match(suffix):
            fragments.append(suffix)
        for item in lines[index + 1:index + 7]:
            if STOP_FIELD.match(item) or NUMBER_FIELD.search(item) or TITLE_FIELD.search(item):
                break
            value = item.strip()
            if (4 <= len(value) <= 95 and not NUMERIC_ONLY.fullmatch(value)
                    and not NUMBER_CODE.fullmatch(value)):
                fragments.append(value)
            if len(fragments) >= 2:
                break
        if fragments:
            titles.append(" ".join(fragments[:2])[:220])
    return list(dict.fromkeys(titles))


def extract_sheet_candidate(page: int, extracted_text: str) -> SheetCandidate:
    """Index only labeled titleblock fields; ambiguous values require human review."""
    if page <= 0:
        raise ValueError("Pages use one-based indexes")
    lines = [line.strip() for line in extracted_text.splitlines() if line.strip()]
    codes = _candidate_numbers(lines)
    names = _candidate_titles(lines)
    number = codes[0] if len(codes) == 1 else None
    title = names[0] if len(names) == 1 else None
    ambiguous = len(codes) > 1 or len(names) > 1
    return SheetCandidate(
        page=page, number=number, title=title,
        needs_review=ambiguous or number is None or title is None,
        provenance=("pdf-text/labeled-titleblock/ambiguous; human verification required"
                    if ambiguous else
                    "pdf-text/labeled-titleblock; human verification required"),
    )
