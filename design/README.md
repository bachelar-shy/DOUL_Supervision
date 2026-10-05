# DOUL UI design registry

Stitch 프로젝트 ID `11486949689509673114`.

## UI source

- `ui/README.md`: **DOUL Supervision UI Design System v1.0**
- `ui/tokens.json`: 기계 판독용 디자인 토큰
- `../apps/web/src/design-system.css`: 웹 적용 토큰 및 기존 MVP 호환 계층
- `../apps/web/src/ui/index.tsx`: 공통 React UI 프리미티브

## Stitch

- `stitch/screen-plan.json`: 요청한 화면 요구사항
- `stitch/screens.json`: 실제 리소스, 캔버스 확인, 역할·경로·업무명령 연결
- `verification/`: 재현 가능한 실행결과와 제약

업무 규칙의 Source of Truth는 Domain / State / Authority / Requirement / API 계약이며, Stitch와 UI Design System은 Presentation 계층이다.

생성 응답의 임시 다운로드 URL 및 원시 로그는 `.local/stitch/`에만 보관하며 Git 대상에서 제외한다. 사용자 디자인 승인 상태는 별도로 유지한다.
