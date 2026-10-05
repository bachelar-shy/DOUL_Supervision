# 19. DOUL 감리 MVP 업무흐름과 검증

기준일: 2026-10-04 · 버전: v2.1

## 1. 합격 흐름 — AI 선택사항

시공사 자체검측과 사전자료 확인 → Inspection 생성 → request → 감리 receive → 완전성 확인 → schedule → start → 증빙·checkResults 제출 → pass → 해당 결과 버전의 FM-09 스냅샷과 필수서명 → Hold Point 기술승인(해당 시) → release_next_work → 완료·후속공정 허용.

자체검측, 기준선, 승인도면, 자재·시험·선행작업·변경 확인 중 빠진 항목이 있으면 접수 후 반려 사유를 남기고 resubmit으로 다시 제출한다. 전 항목 적용제외만으로 합격할 수 없다. 아직 서명되지 않은 합격 결과는 후속공정을 허용하지 않는다.

request/resubmit은 자체검측 여부·precheck·기준/도면 참조와 요청시각을 보완할 수 있다. 결과·작업범위·Hold Point·후속공정 허용은 이 명령으로 변경할 수 없다. 기준/도면이 개정된 요청도 receive/return으로 보완 대상으로 돌릴 수 있으며, 최신 참조로 resubmit하기 전 schedule은 거부한다. 이전 버전과 감사기록을 보존한다.

FM-09는 정확한 버전의 Inspection 하나를 `primarySourceRef`로 보존한다. 추가 증빙·기준 참조의 순서는 서명 대상에 영향을 주지 않는다. 필수 시공사 서명은 검측의 책임 조직에 속한 유효한 배치·자격을 가진 담당자만 수행한다.

## 2. 불합격·반복 재검측 흐름

불합격 결과·증빙 → FM-09 서명 및 record_failure → 사람의 관찰 확인 → 공식 Issue/NCR → 책임자·시정 Action 배정 → 시정·원인·재발방지·증빙 제출 → 새 Inspection 생성 → issue.request_reinspection으로 새 검측 연결 → 감리 start_reinspection → 실제 검측.

재검측 불합격은 reject_reinspection으로 새 correctionCycle을 시작한다. 새 시정 Action을 link_actions로 추가하고 새 재검측을 만든다. 재검측 합격·서명·후속공정 승인이 완료되고 현재 주기의 시정 Action도 검증되어야 Issue.close를 실행할 수 있다. 원검측·과거 시정·실패주기를 덮어쓰거나 삭제하지 않는다. 종결된 원본 버전으로 문서 스냅샷을 만든다.

검측 전 현장 관찰로 발행된 Issue는 최초 주기에서 선행 검측 없이 첫 시정 검증 Inspection을 만들 수 있다. 이후 재검측은 이슈의 바로 전 검측을 previousInspectionId로 연결한다. 모든 검증은 이슈의 프로젝트·공종·패키지·위치·책임 조직과 현재 시정주기에 일치해야 한다.

## 3. 보고·결정 흐름

InformationItem(Report) 초안·검토 → issue → 발주처 acknowledge → 결정/Action 연결 → dispatch → 조치 완료·결정 이행 검증 → verify → close. Decision과 Action은 각각의 상태모델을 따른다. 기한초과는 알림 의도를 만들며 자동 승인을 실행하지 않는다. 세부 책임·시각·종결조건은 21을 따른다.

RFI 답변만으로 변경을 실행하지 않는다. ChangeRequest 영향 검토·발주처 버전별 결정·개정정보 발행·실행·검증을 별도 처리한다. request_decision의 decisionId는 예정 ID를 지정할 수 있으나 실제 Decision이 생성되고 해당 변경 버전을 승인하기 전에는 approve가 거부된다.

RFI submit/resubmit은 질문·하나 이상의 정확한 참조·답변기한을 모두 본문에 포함한다. 빈 질문·빈 참조·다른 프로젝트 참조를 거부한다. 보고서 초안/검토 버전은 SUP/ADM만 읽고 렌더링할 수 있으며, 해당 버전이 들어 있는 문서도 동일한 제한을 적용한다. 발주처는 발행된 보고의 지정 수신자여야 한다.

## 4. 화면과 API

감리 모바일: 오늘·촬영·검측·체크리스트·분석 검토·관찰 확인·공식 이슈·시정검토·재검측·종결. 시공사 웹/PWA: 자체검측·요청·내 이슈·시정·재검측요청. 발주처 웹: 주요사항·보고 수령·결정·승인. 설계자: RFI·기술답변·개정정보. 관리자: 프로젝트·배치·자격·기준선·권한·양식.

실제 명령 경로는 `/projects/{projectId}/inspections/{objectId}/start`, `/issues/{objectId}/request-reinspection`, `/owner-reports/{objectId}/acknowledge` 등이며 전체 경로는 OpenAPI를 따른다. 모든 쓰기 요청은 인증, RoleAssignment, expectedVersion, 명령별 payload, evidenceIds와 Idempotency-Key를 사용한다. 생성·업로드·문서 요청은 각 전용 스키마를 사용한다.

Stitch 화면은 표현 설계 자료다. 명령·권한·필수자료 검증을 화면 내부에 재정의하지 않는다. 버튼 활성 여부는 서버가 계산한 허용 업무와 실패조건을 표시해야 한다.

## 5. 현재 완료와 다음 구현

참조 실행과 자동검증: AI 없는 합격/불합격·반복 재검측, 역할·범위·자격·배치, Hold, 기준·도면·버전 충돌, RFI/변경/승인, 발주처 수령·조치·기한, 분석결과 출처, 불변 HTML·서명 해시.

운영 구현: DB 트랜잭션·인증·HTTP·파일/단말 동기화·업로드·모델/미디어 작업자·실제 알림·전자서명·공식서식·DOCX/PDF·페이지 시각 QA·현장 성능시험. 참조 검증을 운영 앱 완료로 표시하지 않는다. 22의 재현 명령과 이슈 #1 근거를 따른다.
