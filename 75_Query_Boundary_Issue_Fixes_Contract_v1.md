# 조회 경계 이슈 #125/#126/#127 수정 계약
2026-10-08. 기준 integration/parallel-test-v1 @6fc3c49. 읽기 전용 모듈 수정이며 main 병합·열린 원 PR 변경·이슈 종료는 포함하지 않는다.

- #125: 인증된 위치 조회는 하위 위치 개수와 관계없이 authoritative RoleAssignment의 party/project/active/validFrom/validTo를 먼저 검증한다. 유효한 빈 프로젝트만 빈 트리 반환. 기존 개별 위치·도면 읽기 권한과 내부 비인증 경로 유지.
- #126: 읽음 기록의 키 구조를 검증하고 현재 recipient+allowed project에 해당하는 timestamp만 검증한다. 타 사용자/타 프로젝트 timestamp 오류가 현재 조회를 실패시키지 않는다. 현재 범위의 malformed 기록은 오류 유지. 공식 수령과 읽음 표시를 합치지 않는다.
- #127: SafetyStopOrder=WorkItem/SafetyStopOrder; affectedPermitRefs=WorkItem/SafetyPermit; issueRefs=Issue; correctiveActionRefs=Action; resumeVerificationRefs=Inspection; ownerReportRefs=InformationItem/Report (engine._stop_owner_reports_satisfied와 일치); drawingRef=InformationItem/Drawing. 시험의 OwnerReport subtype은 실제 canonical Report로 정합화한다.
- 잘못된 참조는 invalid_reference와 target=null로 정리하고 자식 링크를 추적하지 않는다. 누락·타 프로젝트·권한 오류 진단은 기존 비식별 의미를 유지한다. 역사적 ref의 정확한 버전과 current-ID lookup 구분 유지.
- 조회이므로 draft/issued/completed 등의 상태를 새로 제한하지 않는다. 공식 승인·재개 gate의 상태 판단을 복제하지 않는다.
- 정수 version>0, ref/결과 id 일치, 결과 version 일치 및 타입 표지가 있으면 기대 유형 일치를 확인한다. current-ID 결과도 같은 원본 정합 원칙을 따른다.

서버별 별도 worktree로 개발, 루트 통합 후 focused 및 실제 알림/위치/안전 API 회귀 검사. 현재 integration 브랜치에만 commit/push하며 main 병합 전 이슈를 해결 완료로 종료하지 않는다.
