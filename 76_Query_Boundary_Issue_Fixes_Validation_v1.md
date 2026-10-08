# 조회 경계 이슈 #125/#126/#127 검증
2026-10-08 (Asia/Ho_Chi_Minh), integration/parallel-test-v1.
기준 6fc3c49, 계약 75_Query_Boundary_Issue_Fixes_Contract_v1.md.
통합 커밋: #125 dfd291e, #126 4de0899, #127 b3c373e.

## 변경
- #125: 위치 목록이 비어도 Project를 읽기 전에 현재 RoleAssignment의 party/project/active/validFrom/validTo를 확인한다. 개별 위치·도면 읽기 필터와 trusted internal 경로 유지.
- #126: 읽음 기록의 키 구조를 먼저 검증한 뒤 recipient와 허용 프로젝트 범위에 해당하는 timestamp만 검증한다. 타 범위의 손상 값은 격리하고 현재 범위 손상 및 범위를 판별할 수 없는 키는 오류 유지. 공식 acknowledgedAt/배송 상태를 변경하지 않는다.
- #127: 연결 필드별 objectType과 필요한 subtype을 검증한다. ownerReportRefs는 실제 엔진 계약의 InformationItem/Report이며 기존 시험의 OwnerReport 표기를 정합화했다. 도면·루트·current-ID 조회도 identity/version/type 표지 정합을 검사한다. 잘못된 연결은 target=null의 invalid_reference 진단에만 남고 자식 자료 추적에서 제외한다.
- 공식 상태전이·작업재개 gate·권한 정책·도메인 상태를 변경하지 않는다.

## 검사
### Python
통합 73/73 PASS (2.587초):
tests.test_s3_location_query, tests.test_s5_notification_inbox, tests.test_s6_business_traceability,
tests_mvp.test_parallel_workspace_api, tests_mvp.test_wave1_notification_events,
tests_mvp.test_safety_http, tests_mvp.test_drawing_impacts, tests_mvp.test_drawing_impact_lifecycle.
위치 API 추가 10/10 PASS (0.786초):
tests_mvp.test_wave1_location_edit, tests_mvp.test_wave2_location_anchors.
총 83건, 실패/skip 없음.
직접 projection 검사는 빈 외부 프로젝트, 불일치 사용자, 비활성/만료/기간 경계, 타 수신자/프로젝트 손상 receipt, 현재 범위 오류 유지, 잘못된 Issue/Action/Inspection/Report 유형, 원본 id/version 불일치, exact historical version 유지 및 sanitized 권한/외부 프로젝트 진단을 확인한다.

### Browser
Chromium worker1, 5/5 PASS (약 2.3분):
location-editor.spec.ts, notification-events.spec.ts, safety-connected.spec.ts, safety-command-verification.spec.ts.
실제 위치 저장/수정, 알림 읽음 유지, 영향 알림 표시, server action 및 차단된 안전 재개, 기존 안전 화면 연결을 검사한다.
조회 모듈의 신규 경계 조건은 Python projection 검사로 확인했으며 기존 UI/API의 회귀 검사를 신규 projection HTTP 연결 완료라고 표현하지 않는다.

### 기타 및 반영 범위
git diff --check PASS. API 8801 갱신, 기존 Vite 5191 및 Tailscale HTTPS 10002 HTTP200.
https://automation-macmini.tail0e9ef7.ts.net:10002/#/parallel-test
이번 변경은 Python 모듈·시험·문서이며 웹 코드/의존성은 변경하지 않았다.
integration/parallel-test-v1에 수정 반영. 기존 PR #117/#118/#119 및 main은 직접 갱신/병합하지 않았다. 이슈 #125/#126/#127은 main 반영과 종료 판단 전까지 열린 상태로 유지한다. 이슈 댓글은 작성하지 않았다.
