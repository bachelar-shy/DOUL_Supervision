# Reproducible A4 internal document exports

Issue #47. The runtime produces DOCX and PDF **derivatives of an existing frozen
HTML DocumentSnapshot**, not a new legal original and not a new approval.

## Runtime and authority boundary

`DocumentExportPort.export(snapshot, preserved_html, format)` validates the exact
HTML hash, frozen source payload hash, source version references, internal form
identity and language before rendering. It never queries a current management
register or replaces the stored original HTML. The optional authenticated route
`GET /projects/{projectId}/documents/{documentId}/exports/{format}` checks current
read rights on every frozen source before rendering and again before download.
The usual HTML preview/render API and its DocumentSnapshot response semantics
remain unchanged. An absent renderer returns 501, not a fake PDF/DOCX.

Exports have independent SHA-256 values in `X-Artifact-SHA256`; the original HTML
hash remains `X-Source-Render-Hash`. The cache manifest records both, exact source
references, template identity and renderer fingerprint. A source signature is
not transferred to the different PDF/DOCX bytes; this is explicit in the file
and response. Received statutory forms and trusted signature verification are
still separate, blocked adapters. No Product state or signature meaning changes.

## Installation

Build `infra/docker/document-runtime.Dockerfile` or combine
`infra/compose/compose.documents.yml` with the development stack. The optional
API enables `DOUL_DOCUMENT_RUNTIME=local` and a private persistent
`DOUL_DOCUMENT_CACHE`. Default API images do not claim the renderer is installed.

The container uses a pinned Python base digest and signed Debian snapshot
repositories at 2026-10-01. LibreOffice Writer, Poppler, fontconfig, Noto Sans and
Noto Sans CJK packages are installed from those repositories. Python dependencies
are separately locked. Installed versions, font hashes and license notice hashes
are written to `/opt/doul-document-runtime.json` at build time. Runtime startup
rejects a changed font inventory. Font files are never committed to the repo or
included in generated documents/artifact downloads; PDF font embedding is performed
by the licensed renderer. Package copyright notices remain in the image.

## Layout and immutability

A4 portrait, 17 mm margins, black typography, Korean CJK/Latin Vietnamese font
selection, repeated table headers, expanding rows, bounded long-token wrapping,
and minimum-height signature boxes are explicit. Long rows may flow instead of
being clipped. The data comes from the preserved template HTML, including the
existing field labels; this is not a redesign of all 36 business form contracts.

DOCX ZIP metadata is normalized for byte-identical repeated generation. A private
flock-protected cache publishes complete DOCX/PDF/manifest sets atomically. Once
published, reads return preserved bytes after hash checks. Cache-free PDF runs
can differ in internal timestamps, so CI compares rendered pixels; it does not
claim universal PDF byte identity across different renderer versions. Changes to
the runtime fingerprint create a new derivative, not a replacement of the old
source snapshot. Back up persistent output caches or retain exported derivatives
with their manifests when byte-exact retrieval is required after a disaster.

LibreOffice runs with an isolated temporary user profile, finite timeout and no
network during CI. It receives only our generated DOCX, not uploaded macros or
untrusted office files. Image/resource downloads and executable HTML elements
are rejected by the frozen-HTML reader.

## Validation evidence

- All 36 current internal form contracts are exercised for source preservation,
  A4 OOXML, font declarations, repeated headers where a data table exists, and
  deterministic DOCX output.
- Representative FM-09 signature, FM-20 report, long Korean and long Vietnamese
  fixtures are converted by real LibreOffice and rasterized by Poppler.
- CI checks A4 dimensions, page bounds, multilingual text, the last table row,
  pagination, Noto font presence, immutable cached bytes and cache-free pixel
  repeatability; reviewable PNG/PDF/DOCX files are uploaded for visual inspection.
- The optional download endpoint tests authority, absent-runtime failure and
  independent source/artifact hash semantics.

The CI outputs contain synthetic fixture data, not real project information.
Visual review of the generated pages is required before merging layout changes.
