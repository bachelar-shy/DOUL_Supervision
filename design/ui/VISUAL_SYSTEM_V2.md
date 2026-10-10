# DOUL Supervision Visual System v2.0 — Quiet Graphite

## Scope
Presentation-only pilot over existing v1 components. Preserve domain/state/authority, evidence, issue closure and approval gates. No font binaries bundled.

## Base palette
| Semantic token | Hex | Usage |
|---|---|---|
| Canvas | #F7F8F8 | App background |
| Navigation | #F1F3F4 | Sidebar |
| Surface | #FFFFFF | Cards, tables, forms |
| Ink | #202A35 | Headings/primary data |
| Secondary | #536171 | Support text |
| Line | #E4E7EB | Separators |
| Primary | #2555D6 | Active actions, selection |
| Selected | #EAF0FF | Active navigation |
| Success | #127A4A | Status text |
| Warning | #B45309 | Status text |
| Danger | #D4183D | Critical issues |

Keep operational statuses server-owned and pair any color with text; do not conflate inspection passes, downstream release, report receipt and owner approval.

## Typography
- Stack: Pretendard Variable/Pretendard -> Inter -> Be Vietnam Pro -> Noto Sans KR -> system fonts
- Font loading is optional; existing safe fallback remains functional.
- Proposed hierarchy: page 24/600, section 17/600, body 14/400, table 13/400-500, helper 12/400.
- Incremental typography migration: legacy 9-11px selectors need screen-by-screen regression before widening.

## UI composition
- Primary buttons are brand blue; avoid decorative gradients and strong shadows.
- Table rows and navigation use subtle hover fills.
- Sidebar is neutral and selected entries have soft-blue background.
- Workbench and document grid children must allow min-width 0.
- Long table scrolling remains inside the table scroller; do not stack independent scroll areas without reason.
- Future follow-up: shared resizable panes, density toggle, drawing-focus mode, full font coverage and 390/768/1024/1440/1920px visual regression.

## Validation
Run web typecheck/build/lint and UI boundary checks. This phase is a restrained visual layer upgrade, not a replacement of 29 register or 36 form domain components.
