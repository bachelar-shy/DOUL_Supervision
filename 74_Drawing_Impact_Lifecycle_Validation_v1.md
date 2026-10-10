# 도면 영향 발생·해소 이력 통합 검증 v1
2026-10-08 (Asia/Ho_Chi_Minh). 브랜치 integration/parallel-test-v1, 기준 7aba9d8.
서버 1c0447f, 화면 9426b3e, 검사 보강 0e22980. 실행계약: 73_Drawing_Impact_Lifecycle_Contract_v1.md.

## 완료 기능
- 사건별 발생, 사용 조건 복구 관측, 재발을 transactional metadata archive에 보존한다.
- GET /parallel/drawing-impacts/history는 정확한 도면 버전과 사건 당시 처음 관측한 업무 버전을 제공한다. 현재 미완료 조회 API 응답 계약을 유지한다.
- 같은 사용 불가 기간의 사유 변경은 새 사건을 만들지 않는다. 이력은 최초 사유를 보존하고 현재 영향 조회는 최신 사유를 사용한다.
- 연결 업무 완료나 도면 참조 변경 후에도 사건 당시 기록을 보존한다. 업무 완료를 도면 사용 조건 복구로 해석하지 않는다.
- 읽기 권한은 과거 도면/업무와 현재 도면/업무 모두 재확인하고 프로젝트별로 필터링한다.
- 기존 snapshot과 유효한 Notification에서 증명할 수 있는 사건만 이관한다. 과거 세대는 기존 결정적 사건 ID로 증명하며 소실된 복구 시각은 null로 유지한다.
- 현재 미완료 업무와 발생·해소 이력을 분리 표시한다. 알림 사건 ID와 exact drawingRef를 유지한다.
- ‘다시 조회’, 이력 실패 안내, ‘복구 시각 미기록’, 당시 업무 버전 및 과거/현재 원본 구분을 제공한다. 이력 실패 중에도 현재 업무와 PDF 원본 표시가 가능하다.
- 복구 관측은 연결 업무 완료나 재승인을 의미하지 않는다. 업무 상태·버전·참조를 자동 변경하지 않는다.

## 검증
### 서버
43 unittest PASS (8.548초):
drawing_impact_lifecycle, drawing_impacts, command_preview, parallel_workspace_api, inspection_authoring, wave4_drawing_field_control, wave1_notification_events, wave3_drawing_markups.
신규 9건은 발생→복구→재발, 완료 후 최초 버전 보존, 사유 변경, SQLite 재시작/롤백, 기존 이관 및 알 수 없는 복구 시각, 과거/현재 업무 접근 및 도면/프로젝트 필터를 확인한다.

### 브라우저
대상 17종의 최종 검증 완료 (Chromium, worker 1).
통합 실행은 16개 통과, 이력 실패/재조회 fixture 1개 실패였다. React StrictMode의 개발용 추가 Effect 실행으로 첫 요청만 실패시키는 fixture가 두 번째 요청에서 성공한 것이 원인이었다.
앱 코드를 바꾸지 않고 재조회 클릭 전까지 모든 요청을 실패시키도록 fixture를 수정했다. 현재 업무가 그대로 보이는 조건을 추가하고, 이전 조회를 모두 지연시킨 뒤 새 조회가 완료되어도 이전 응답이 덮어쓰지 못하도록 보강했다.
수정된 신규 lifecycle 5종을 다시 실행하여 5/5 PASS (55초). 나머지 통합 12종은 기존 통합 실행에서 PASS이며 변경된 파일은 신규 lifecycle spec뿐이다.
실제 등록·승인·배포·수령·회수 E2E에는 사건 ID, 도면/검측 exact refs, API active 이력, 화면 이력, 재조회 후 단일 사건, PDF 및 업무 이동을 추가했고 PASS했다. 이 실제 흐름은 응답 mock을 사용하지 않는다.
복구·재발 API 경계는 합성 서버 fixture, 복구·재발/실패/race UI는 제어한 응답으로 검사한다. 운영 현장 전체 실증으로 확대 해석하지 않는다.

### 기타
웹 typecheck, UI boundary, lint, production build 및 git diff --check PASS.
기존 lint 59 warnings / 0 errors, 500kB 초과 bundle 경고 유지.
테스트 서버는 기존 API 8801 / Vite 5191 및 Tailscale HTTPS 10002 유지. HTTP 200 확인.
https://automation-macmini.tail0e9ef7.ts.net:10002/#/parallel-test

## Context7
React 공식 useEffect cleanup/ignore 및 StrictMode 추가 setup-cleanup 문서를 참고했다.
https://github.com/reactjs/react.dev/blob/main/src/content/reference/react/useEffect.md
https://github.com/reactjs/react.dev/blob/main/src/content/reference/react/StrictMode.md

이 단계는 기존 테스트 인증과 도면 영향 이력 범위다. 예약 실행·외부 알림 및 main 병합은 포함하지 않는다.
