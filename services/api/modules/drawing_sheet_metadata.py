"""Extract proposed per-page sheet identity from PDF text, never invent official approvals."""
from __future__ import annotations
from dataclasses import dataclass
import re

NUMBER = re.compile(r"(?im)^\s*Drawing Number\s+([A-Z]{1,5}-[0-9]{2,4}[A-Z]?)\s*$")

@dataclass(frozen=True)
class SheetCandidate:
    page: int
    number: str | None
    title: str | None
    needs_review: bool
    provenance: str

def extract_sheet_candidate(page: int, extracted_text: str) -> SheetCandidate:
    """Use title block evidence only, not arbitrary drawing references in the sheet body."""
    if page <= 0:
        raise ValueError("Pages use one-based indexes")
    matches = NUMBER.findall(extracted_text)
    numbers = list(dict.fromkeys(matches))
    number = numbers[-1] if len(numbers) == 1 else None
    lines = [line.strip() for line in extracted_text.splitlines()]
    anchor = next((i for i, line in enumerate(lines) if "Drawing Title" in line), -1)
    title = None
    if anchor >= 0:
        candidates = []
        for line in lines[anchor + 1:anchor + 6]:
            if any(stop in line for stop in ("Rev No", "Drawing Number", "SỐ HIỆU BẢN VẼ", "LẦN SỬA")):
                break
            if line and len(line) <= 110:
                candidates.append(line)
        if candidates:
            title = " ".join(candidates[:2])[:220]
    return SheetCandidate(
        page=page, number=number, title=title,
        needs_review=number is None or title is None,
        provenance="pdf-text/title-block; human verification required",
    )
