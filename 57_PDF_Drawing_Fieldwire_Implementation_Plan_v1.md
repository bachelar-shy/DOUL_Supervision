# 57. PDF Drawing and Field Coordination Implementation Plan v1

Date: 2026-10-07
Status: Planning only; no implementation or release-readiness claim
Workstream: S1 — drawings and documents
Related functional contract: [43_Drawing_Revision_Field_Distribution_Functional_Contract.md](43_Drawing_Revision_Field_Distribution_Functional_Contract.md), F-16

## 1. Purpose

Build a lightweight, PDF-first drawing experience that adopts useful field-coordination capabilities demonstrated by Fieldwire: a focused sheet view, task pins, photos and links on the plan, visible layers, text search, and explicit plan comparison. The first implementation should help a field user open a known drawing revision, find and discuss a page location, and link it to existing work records.

This plan does not change Product 43 or the current domain schema. The current `InformationItem` schema cannot establish the release, supersede, or distribution facts required for an official field-use decision. Until a Product-approved contract and compatible persistence/API work exist, the viewer must show source status and exact revision identity without deriving “current for construction,” “released,” or equivalent labels.

## 2. Product and data principles

- Keep every drawing file byte-for-byte immutable after registration. Identify a revision by its exact domain reference and source-file checksum; a replacement upload creates a new revision.
- Keep page pins and vector markups in a separate, versioned overlay. Never flatten, rewrite, or annotate the source PDF.
- Bind every pin and manual link to the exact drawing revision and page where it was created. Show that identity when opening the item.
- Keep workflow facts distinct: uploaded, submitted, approved, released for field use, distributed, and superseded are separate states. A newer upload does not imply that it is released or replaces a field-used version.
- Preserve historical pins and overlays. Do not automatically move them to a successor revision. A later alignment workflow may propose a location only after an authorized person reviews and confirms it.
- Treat task, photo, location, file, and other record associations as explicit links. Do not infer them from a shared title, filename, revision text, or page label.

## 3. Capability plan

| Capability | Initial behavior | Boundary |
|---|---|---|
| Plan view | Open one selected PDF revision in a page-focused viewer with page navigation, zoom, rotate-for-view, and thumbnails | View transforms never change stored page coordinates or the source file |
| Page pins | Place a pin on a page and link it to an existing task, photo/evidence item, or location; allow a pin to open its linked record | Each association names the exact revision and page; pin existence does not mean approval or release |
| Vector overlay | Draw simple points, lines, arrows, and polygons in a separate overlay layer | Overlay writes create auditable overlay versions; source PDF remains unchanged |
| Manual links | Place an explicit link at a page location to another drawing sheet/revision or authorized project record | The target must be a readable exact reference; the link is not an inferred relationship |
| Thumbnails and search | Show page thumbnails; search extracted PDF text and explicitly indexed drawing metadata | Search results identify page and exact revision; OCR is a later, human-confirmed stage |
| Compare plans | Compare two explicitly selected revisions or sheets with side-by-side/overlay viewing | Comparison is a review aid; it does not supersede a revision or move pins |
| Future alignment | Let a reviewer align two revisions using explicit control points and inspect proposed pin mappings | No automatic migration; each adopted mapping requires review and confirmation |
| Future measurement | Calibrate a page scale, then create length/area annotations in the overlay | Not a quantity measurement or payment record; show calibration source and units |
| Future OCR | Queue selected pages, surface text/region suggestions, and require human confirmation | OCR output is a suggestion, never authoritative drawing metadata or a release decision |
| Future offline use | Let a user explicitly select authorized drawings/pages for a controlled offline package | Scope, expiry, revocation, and local-device protection must be designed before enabling it |

## 4. Staged implementation and acceptance

### Stage 0 — Contract and integration preparation

Inventory the existing `DocumentPage`, drawing records, PDF storage adapters, access checks, and exact-version references. Agree with S0 on any shared API, route, schema, or PDF.js dependency changes before editing those shared surfaces. Consume S2’s file-storage interface rather than creating another upload path. Confirm the target viewer can request byte ranges through an authorized service boundary.

Acceptance:

- Documented source of truth for file identity, exact revision reference, permissions, and storage interface.
- Explicit list of shared files or dependencies requiring S0 coordination.
- No new drawing state or release-readiness rule is introduced by the viewer plan.

### Stage 1 — Read-only PDF viewer

Render a selected PDF in the browser using PDF.js. Provide page navigation, zoom, view rotation, page thumbnails, and text search where the PDF contains an extractable text layer. The initial viewer is read-only and labels the source revision and status exactly as stored.

Acceptance:

- A user can open only drawings and files authorized for the active project and role.
- Page count and page navigation match the selected exact PDF revision.
- Zoom and view rotation preserve page identity and do not mutate the source or persisted coordinates.
- Search results include page number and exact revision; a scan without text returns a clear “no searchable text” state.
- Changing to another revision clearly changes the displayed exact reference; no “latest means released” inference appears.

### Stage 2 — Pins, linked records, and vector overlays

Add page pins linked to existing tasks, photos/evidence, and locations. Add a small set of vector markups and manual links. Keep these in a separate overlay record/version, with actor, timestamp, exact drawing revision, page, and link references. Provide layer visibility controls so a user can hide pins, markups, or links while inspecting the source sheet.

Acceptance:

- A pin remains at the same PDF page coordinate after zoom, view rotation, resize, and reload.
- Pins and markups from one revision never silently appear as writable items on another revision.
- Every displayed linked record passes the current role/project authorization check; unauthorized targets reveal no title or metadata.
- Creating, editing, or removing an overlay item leaves source PDF bytes and checksum unchanged.
- Missing or unreadable targets are shown as unavailable without exposing protected record details.
- Existing tasks and evidence remain independently managed; a drawing pin is a link, not a duplicate task/photo store.

### Stage 3 — Explicit comparison and reviewed alignment

Provide comparison for two user-selected sheets or revisions. Start with side-by-side viewing; add an optional translucent overlay only when the two page coordinate spaces can be aligned. Any alignment is a review artifact with its two exact source revisions, method, control points, and reviewer confirmation. It is not a revision lifecycle command.

Acceptance:

- Both source revisions remain identifiable throughout comparison.
- An unaligned comparison does not imply positional equivalence.
- The system does not auto-copy or migrate historical pins, overlays, or links.
- A reviewer can reject a proposed mapping without changing the old or new revision.
- Confirmed mappings are inspectable and reversible through a new overlay version, with the earlier mapping retained in history.

### Stage 4 — Calibrated measurement

After comparison and overlay behavior are stable, permit an authorized user to set a scale from a known dimension or a project-approved calibration input. Store the calibration basis and measurement geometry in the overlay, separate from quantity/payment records.

Acceptance:

- Calibration is scoped to one exact page/revision and records its basis, units, actor, and time.
- Page rotation and zoom do not alter stored measurement geometry or calculated values.
- Measurements are visibly identified as drawing annotations and cannot write or imply a verified quantity, payment amount, or contractual entitlement.
- A changed/replaced source revision invalidates neither the historical measurement nor its provenance; a new calibration is required for the new revision.

### Stage 5 — Optional OCR and selected offline support

Only after the basic viewer and access model are accepted, add a queued OCR path for selected pages and an explicit offline package for selected authorized drawings. OCR results remain suggestions until a human confirms the text or location. Offline support must include project scoping, expiry, revocation behavior, and protected local storage before pilot use.

Acceptance:

- OCR work is requested for explicit pages, persisted as a derivative, and never changes the source PDF or official drawing fields by itself.
- A reviewer can accept, correct, or reject each OCR suggestion; the decision and source page remain traceable.
- Offline downloads are user-selected, permission-checked, bounded by configurable size/page limits, and have an explicit expiry and cleanup behavior.
- Revoked or expired packages stop being usable according to the approved device security design.

## 5. Coordinate and version handling

Persist geometry in a canonical PDF page coordinate frame derived from the page box and rotation metadata, never CSS pixels or the current canvas size. Convert between PDF coordinates and the current PDF.js viewport at render time. Store page number as a stable one-based index for display plus the exact page identity needed by the implementation; reject coordinates outside the canonical page bounds.

A pin/overlay reference should include the exact drawing `DomainRef`, page number, geometry, and overlay version. Historical records continue to open against the revision they reference, even if a newer drawing exists. A page-count or page-box change in a successor revision must not be treated as proof of alignment.

## 6. Resource and performance constraints

The target host is a Mac mini M4 with 16 GB unified memory. Do not size production capacity from local development results alone.

Browser PDF.js behavior:

- Use the PDF.js display API and its worker; do not move full-document rendering or OCR into a React component’s synchronous path.
- Render the visible page and, at most, a small configurable adjacent-page window. Cancel obsolete render tasks on navigation, document change, and unmount.
- Reuse or release canvases and page resources when pages leave the active window. Bound cached thumbnails, rendered canvases, and total canvas pixels; cap device-pixel-ratio scaling for large sheets.
- Avoid fetching the full PDF into a JavaScript buffer. Use the PDF.js loading/range support against an authorized byte-range endpoint.

Server behavior:

- Stream source bytes from the S2 object-storage adapter; never buffer the entire PDF in the API process to serve a page or range.
- Place thumbnail, OCR, and other derivative generation behind a durable job boundary. Start with one heavy derivative job at a time on the shared host; make concurrency configurable and change it only after measurement.
- Make temporary-disk quotas configurable, monitor free space, and clean partial/expired work safely. Do not enqueue bulk thumbnail/OCR generation for every historical drawing by default.
- Keep derivative generation separate from latency-sensitive API and notification handling. Record queue delay, job duration, peak memory, temporary disk use, and failures during load tests.
- Validate on native ARM64 paths and the actual Mac mini before making an operating-capacity claim. No performance guarantee is part of this plan.

## 7. Access, audit, and failure behavior

- Check project and role access before returning document metadata, page search results, thumbnails, byte ranges, overlays, or linked-record summaries.
- Re-check authorization for every manual link target and every download/range request; storage object IDs are not authorization tokens.
- Keep source PDF, generated derivatives, and user-created overlays distinguishable and traceable to the source revision/checksum.
- Log overlay changes and alignment confirmations with actor, time, prior/new overlay version, and source references.
- Handle missing pages, corrupt PDFs, range failures, expired access, derivative failures, and unavailable link targets without substituting another revision.
- Do not treat a viewer event, pin, markup, upload, or comparison as approval, field release, distribution, or a construction-use decision.

## 8. Dependencies and coordination

- S0: coordinate PDF.js dependency pinning and any shared API route, DTO, schema, or generated-client changes before they are made.
- S2: consume the existing file-storage contract for immutable source PDFs and derivatives; do not duplicate upload or object-store logic.
- S3: consume location references and authorization boundaries for location-linked pins.
- Task/evidence owners: link to their existing records through explicit exact references; do not create parallel task or photo persistence in the drawing viewer.
- Product/Functional: required before adding official release, distribution, supersede, alignment, or measurement semantics beyond the current contract.

## 9. Reference capabilities and implementation sources

Fieldwire’s documentation describes a single plan view with task pins, markup tools, attachments/links, layer visibility, version control, plan text search, and comparison. This plan adopts those capability patterns while retaining DOUL’s exact-version references and review-before-alignment rule:

- [Fieldwire: Single Plan View and Markup Tools (Web)](https://help.fieldwire.com/hc/en-us/articles/202909260-How-to-use-the-Single-Plan-View-and-Markup-Tools-Web)
- [Fieldwire: How to Compare Plans](https://help.fieldwire.com/hc/en-us/articles/115000652623-How-to-Compare-Plans)

PDF.js implementation references for a browser worker-backed viewer and display API:

- [PDF.js Hello World example](https://github.com/mozilla/pdf.js/blob/master/examples/learning/helloworld.html)
- [PDF.js display API source](https://github.com/mozilla/pdf.js/blob/master/src/display/api.js)

## 10. Not implemented or proven by this plan

This document is an implementation plan only. It does not add a PDF viewer, PDF.js dependency, endpoint, schema, storage adapter, queue, OCR provider, offline package, pin/overlay persistence, revision alignment, measurement, or Fieldwire-compatible UI. It does not claim that any drawing is released, distributed, current for construction, ready for field use, or production-capable. Each stage requires its own implementation, focused tests, role-based access checks, and field validation before it can be reported complete.
