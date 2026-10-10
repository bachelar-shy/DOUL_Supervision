# 도면 변경 영향 · 업무 재확인 알림 v1

2026-10-08 (Asia/Bangkok), integration/parallel-test-v1.

## 업무 계약
- 정확한 도면 버전이 변경되거나 기술 승인/현장사용 조건이 유효하지 않으면 연결된 미완료 검측·이슈·시정조치를 조회한다.
- 검측 drawingRef, 이슈 inspectionIds, 검측 relatedIssueId, 이슈 actionIds, 조치 relatedIssueId 및 저장된 주석 연결만 사용한다. 공간의 근접성으로 관계를 추정하지 않는다.
- 완료/취소 검측, 종결/취소/대체 이슈, 검증완료/종결/취소 조치는 재확인 대상에서 제외한다.
- 담당자가 있으면 담당자, 없으면 작성자에게 앱 내 알림을 저장한다. 현재 프로젝트의 유효한 역할로 원 도면과 업무 모두 읽을 수 있어야 한다.
- 알림 원본은 생성 시 업무의 정확한 버전이며 도면 정보는 별도 메타데이터에 보존한다. 기존 업무 상태·도면 참조·승인·공정 허용은 자동 변경하지 않는다.
- 같은 영향 사건/업무/수신자는 중복 생성하지 않는다. 사용 조건 복구 후 다시 무효화되면 별도 사건이다. 알림 dueAt은 사건 발생 시각이며 업무 기한이 아니다.
- 현장사용본 대체·회수 감사 기록 처리 및 알림/영향 조회에서 평가한다. 예약 실행 및 외부 전송은 포함하지 않는다.
- GET /projects/{project_id}/parallel/drawing-impacts는 현재 권한으로 읽을 수 있는 영향 사건/업무만 제공한다.
- 기존 알림 목록은 추가 drawingImpact 정보를 표시하고 원 업무 이동·읽음 처리를 유지한다.

## 최종 검증 — 2026-10-08
- 관련 Python 23건 통과. 영향 알림 8, 검측 작성 5, 현장사용본 4, 기존 알림 1, 도면 주석/이슈 연결 5. fixture 클래스의 직접 import를 제거하여 중복 검사를 정리했다.
- Playwright 7건 통과 (3.0분, Chromium workers=1): 실제 현장 도면/회수/알림 전체 흐름 1, 알림 읽음 보존 1, 영향 문구 표시 1, 기존 원본 이동 1, 참조 로직 3.
- 전체 흐름은 실제 PDF 업로드와 설계자 개정 등록 → 감리 기술 검토/승인 → 관리자 승인 근거 갱신 → 감리 현장 사용본 발행 → 관리자 배포 → 시공사 수령 → 검측 초안 API 작성 → 관리자 회수 API → 담당자 알림 API/화면 → 검측 원본 이동을 사용한다. 이 검사에서 응답을 모킹하지 않는다.
- API로 초안을 만든 후 화면 작업공간을 다시 불러오고 시공사 역할을 명시적으로 선택한다. 회수 후 원 검측의 상태/버전/도면 참조 보존 및 새 검측 작성 옵션에서 해당 도면 제외도 확인했다.
- 서버 검사에서 공식 주석→이슈 생성 API로 연결된 검측·이슈·시정조치의 정확한 원본 버전 및 담당자별 단일 알림, 상태/참조 보존을 확인했다. 실패 검측·관찰 준비는 합성 fixture이므로 이슈/조치의 전체 운영 실증으로 표현하지 않는다.
- 중복 방지/재시작 보존/복구 후 재발/완료 대상 제외/읽기 권한/저장 실패 복구/다른 버전 제외를 확인했다.
- 알림 이동은 WorkItem 및 명시적인 Inspection↔inspection, Issue↔issue, Action↔action만 허용한다. 유형/업무 종류/프로젝트가 불일치하거나 미래 버전이면 이동을 차단한다. 과거 버전은 현재 버전과 구분한다.
- web typecheck / UI boundary / lint(오류 0, 기존 경고 59) / build / git diff --check 통과. 기존 500kB 초과 청크 경고 유지.
- 기존 Tailscale HTTPS 10002 응답 403은 Vite 허용 호스트 누락이었다. DOUL_TEST_ALLOWED_HOST에 정확한 호스트를 전달하여 프런트 재시작 후 HTTPS 200 확인. 기존 접속 경로와 API 8801/프런트 5191을 유지했다.
- 누적 테스트 자료에서 도면 목록 초기 로딩이 10초를 넘는 것을 관찰해 해당 준비 조건의 대기를 30초로 조정했다. 확인할 동작과 정확한 상태/버전 조건은 유지했다.

## 실행 명령
```bash
.venv/bin/python -m unittest tests_mvp.test_drawing_impacts tests_mvp.test_inspection_authoring tests_mvp.test_wave4_drawing_field_control tests_mvp.test_wave1_notification_events tests_mvp.test_wave3_drawing_markups -q
npx playwright test --config playwright.parallel.config.ts tests_browser/drawing-field-control.spec.ts tests_browser/notification-events.spec.ts tests_browser/notification-target.spec.ts
npm run typecheck --workspace apps/web
npm run check:ui-boundary
npm run lint --workspace apps/web
npm run web:build
git diff --check
```

## 다음 작업
1. 누적 도면/업무 데이터의 작업공간 조회 비용과 동시 조회 대기 측정 및 개선.
2. 알림에서 대상 도면과 영향 업무를 함께 탐색하는 화면 확장.
3. 운영 인증·외부 알림·예약 실행은 별도 계약/검증.
