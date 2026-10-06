# F-04 공정 작업공간 v1 — UI/API 연결 범위

기준: main 882a843, Product F-04 PR #74, Backend B-P3 PR #76, 현재 명령 증빙 PR #82.

## 이번 구현

- `#/schedule`: 기준공정, 진도기록, 지연사건, 회복계획 탭.
- 기존 UI 경계의 SupervisionClient를 통해 네 collection의 생성/명령 API 연결.
- 서버 제공 상태/명령/차단 사유 표시. UI는 상태·권한·업무 판정을 생성하지 않음.
- 원본 버전, 기준일, 기준공정 완료일과 예측 완료일, source hash/version 및 연결 참조 분리 표시.
- 명령 입력 타입은 Product Schema에서 생성. string sourceFileRef와 구조화 DomainRef 구분; 숫자, boolean, 배열/객체 보존.
- 신규 기록의 중복 재시도는 동일 payload에 동일 object ID / Idempotency-Key 유지.
- 오프라인은 마지막 조회본 표시 및 공식 명령 차단. 충돌 오류 후 취소·새로고침으로 최신 원본 확인.
- 신규 입력 폼은 현재 수동 원본자료 입력용. 복잡한 달력/품질검토/영향분석/참조는 구조화 입력이며, 외부 공정 파일 자동 가져오기 기능이 아님.
- Mock에서는 신규 기록/공식 실행 불가.

## 검증 범위

`tests_browser/schedule.spec.ts`:
- 실제 HTTP + SQLite: 기준공정 생성 → 재조회 → 철회, 기준일/계약 완료일/예측일 분리 보존.
- expectedVersion, Idempotency-Key 전송.
- 오프라인 차단 및 OWN 역할의 CON 철회 명령 부재.
- 다른 창의 갱신 후 stale command 409, 충돌 안내 및 최신 원본 재조회.
- 숫자/객체 입력 타입 보존 및 자료 미완성 제출의 서버 거부.
- 390/768/1440 화면폭에서 네 탭 레이아웃.

생성물 점검: `python3 scripts/generate_schedule_ui.py --check` (MVP CI에 포함).
표준 검증: `npm run check:ui-boundary`, web typecheck/lint/build, 전체 Playwright.

## 남은 의존성 / 완료판정

F-04 전체를 Integration Tested 또는 Field Validated로 승급하지 않는다.

- ScheduleActivity 원본 snapshot 입력/조회와 exact sourceScheduleRef, criticalPathRef의 실제 연결 경로.
- 회복계획의 supporting recovery Schedule 원본 입력 경로 (새 workflow 상태를 UI에서 생성하지 않음).
- 네 업무의 충분한 원본자료를 사용한 Baseline → Progress → Delay → Recovery 전체 브라우저 인수.
- F-08 EOT 실행계약/결정의 구현 및 승인 근거를 이용한 새 Baseline version 생성.
- 발주처 보고/후속조치 종결, 파일 원본 저장·source hash 검증, 실제 현장 검증.

다음 단일 작업: ScheduleActivity 원본 입력 경로를 연결하여 Baseline → Progress 통합 인수를 진행한다.
