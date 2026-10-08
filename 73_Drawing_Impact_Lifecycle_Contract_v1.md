# 도면 영향 발생·해소 이력 실행계약 v1
2026-10-08. 기준 integration/parallel-test-v1 @7aba9d8. 별도 worktree/branch로 서버와 UI를 병렬 개발하며 루트가 통합 검증하고 현재 integration branch만 push한다.

## 목적과 범위
도면의 사용 조건 변경, 복구 관측, 재발을 같은 정확한 도면 버전에서 구분한다. 업무 완료·취소·재승인·도면 참조 변경을 자동 수행하지 않는다. 해소는 도면 조건의 복구 관측이며 현장 업무 해결/검토 승인과 다르다.

## 서버 계약
기존 GET /parallel/drawing-impacts 응답과 notification metadata 의미를 유지한다.
추가 GET /projects/{project_id}/parallel/drawing-impacts/history -> {items: DrawingImpactHistory[], total: 사건 수}.
DrawingImpactHistory: {incidentId, drawingRef, title, revision, reason, occurredAt, resolvedAt: string|null, state: 'active'|'restored', items: [{sourceRef,machine,title,status,responsiblePartyId}]}.
items는 사건에서 관측한 정확한 업무 버전의 기록이다. 현재 미완료 목록과 혼동하지 않는다. 원본 접근은 현재 활성 역할·프로젝트·원본 및 현재 업무 읽기 권한으로 필터링한다. 다른 프로젝트·회수된 권한의 기록을 유출하지 않는다.
같은 도면 버전의 사용 조건이 복구되면 resolvedAt을 최초 복구 관측 시각으로 보존한다. 다시 사용 불가가 되면 새 incidentId/generation으로 보존한다. archive는 store metadata에 transactionally 저장하며 재시작/롤백에 안전하고 조회 재실행은 중복 사건·알림을 만들지 않는다.
기존 데이터는 현재 남은 incident 및 notice metadata로 확인 가능한 정보만 이관한다. 과거에 덮어써져 소실된 사건·해소 시간을 추측해서 생성하지 않는다. 미관측 과거 복구는 이번 조회 관측 시각으로 기록한다.
활성/해소는 업무 상태 변화로 결정하지 않고 기존 unavailable_reason을 사용한다. 최초 관측 원본 refs를 자동 최신 버전으로 바꾸지 않는다.

## UI 계약
기존 DrawingImpactPanel에서 현재 미완료와 '발생·해소 이력'을 분리 표시한다. 서버 state 한국어: active='사용 조건 확인 필요', restored='사용 조건 복구 관측'. 해소 표시에는 '연결 업무의 완료 또는 재승인을 뜻하지 않습니다' 안내.
exact drawingRef 및 알림 incidentId 선택을 유지한다. 알림 선택은 해당 사건 이력을 보여주고 도면 선택은 해당 정확한 버전의 이력을 보여준다. 현재 목록이 없더라도 역사적 사건을 표시할 수 있다.
이력 업무는 사건 당시 버전임을 표시하고 기존 canonical helper로 exact/past/unavailable 이동한다. 과거 기록을 현재 업무로 무단 대체하지 않는다.
명시적 '다시 조회' 버튼. fetch 실패/빈 목록/로딩을 구분하고 역할·프로젝트·선택·재조회 변경의 stale 성공/오류를 무시한다. data adapter + ui-contract 경계, 원본 PDF 동작 유지. 서버 state나 접근권한을 UI에서 추론하지 않는다.

## 소유 경계 및 검증
서버: services/api/modules/drawing_impacts.py, 신규 lifecycle unittest만.
UI: DrawingImpactPanel, drawing-impact-client, ui-contract, 신규 lifecycle browser spec만.
루트: 이 계약, 기존 실제 회수 E2E와 playwright config, 최종 검증 기록.
필수: 발생→복구→재발 이력; exact refs; 원본 업무 불변; 알림 중복 없음; restart/rollback; 기존 이관; 외부 프로젝트/권한 차단. UI active/restored/재발 구분, 실패 후 재조회, stale 역할 응답 및 실제 회수 통합검사.
Context7 React 공식 useEffect cleanup/ignore 지침 적용.

## 이력 보존 세부 기준
- 연속 사용 불가 중 사유 변경은 같은 사건이며 history.reason은 최초 관측 사유를 보존한다. 기존 현재 영향 조회는 최신 사유를 반환한다.
- 이력 items는 처음 관측한 업무별 정확한 버전을 보존하고 새로 연결된 업무만 추가한다. 이후 완료되어도 기록을 지우지 않는다.
- 기존 inactive snapshot 또는 더 높은 generation 등 기존 상태 흐름으로 복구를 증명할 수 있으나 시각이 없으면 restored/resolvedAt=null이며 화면은 ‘복구 시각 미기록’으로 표시한다. 증명할 수 없는 과거 해소는 추정하지 않는다.
- 이력 조회 실패가 현재 미완료 영향 목록이나 PDF 원본까지 숨기지 않도록 실패 표시와 재조회를 구분한다.
