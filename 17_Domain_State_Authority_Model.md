# 17. DOUL 감리 앱 Domain · State · Authority Model v2

기준일: 2026-10-04
상태: v2.1 구현기준

## 1. 목적

29개 관리대장을 직접 업무엔티티로 구현하는 v1 접근을 확장하여, 실제 업무행위와 상태전이를 표현하는 Core Domain Model을 정의한다.

원칙:
- Core Domain Object = 업무의 원본
- 29개 관리대장 = 조회·관리·보고용 Projection
- FormTemplate / LegalFormTemplate = 출력
- DocumentSnapshot = 특정 revision의 불변 문서

## 2. Core Domain Objects

1. Project
2. Party
3. RoleAssignment
4. Requirement
5. Location
6. Asset
7. InformationItem
8. Evidence
9. WorkItem
10. Inspection
11. Observation
12. Issue
13. Action
14. Decision
15. Approval

### 주요 하위유형

- InformationItem: Drawing, Specification, Method Statement, Checklist Template, Report, Certificate, Meeting Record, Manual, General Document
- Asset: Building Element, Equipment, System, Material, Material Lot, Installed Component
- WorkItem: Contractor Submission, Inspection Request, Material Submittal, Test Request, RFI, Change Request, Variation, Schedule Activity, Payment Claim, Safety Permit, Owner Decision Request, Commissioning Package, Handover Package, Warranty Claim
- Issue: Defect, NCR, Safety, Environmental, Material, Fire, Punch, Schedule, Design

NCR와 RFI는 별도 Root Object로 두지 않는다. NCR는 Issue subtype, RFI는 WorkItem subtype이다.

## 3. 핵심 관계

Requirement → WorkItem / Inspection / Issue
Location → Asset
Inspection → Evidence
Evidence → Observation
Observation → authorized verification → Issue
Issue → Action → Reinspection → Closure
WorkItem / Issue → Decision → Approval → Action
Project → 모든 상위 객체

## 4. Evidence 원칙

원본 증빙은 수정하지 않는다.

필수 메타데이터:
- Evidence ID
- 원본/파생 여부
- 작성·촬영 시각
- 작성자
- 위치
- Asset
- Drawing revision
- 파일 hash
- source relation

AI keyframe, crop, enhancement 등은 원본을 덮어쓰지 않고 Derived Evidence로 별도 연결한다.

## 5. Observation과 Issue

Observation은 사실 후보 또는 관찰기록이다.

- Source: Supervisor / Contractor / Owner / AI
- State: Candidate → Under Review → Confirmed / Rejected

AI는 Observation Candidate만 제안할 수 있다. 공식 Issue 전환은 권한 있는 사람이 검증해야 한다.

## 6. Inspection 상태

Draft / Requested
→ Completeness Review
→ Scheduled
→ In Progress
→ Result Pending
→ Passed / Conditional / Failed / Hold
→ Completed

재검측은 기존 Inspection을 덮어쓰지 않고 새 Inspection으로 생성하고 원 Issue 및 correction cycle과 연결한다.

## 7. Issue 상태

Open
→ Assigned
→ In Progress
→ Ready for Recheck
→ Reinspection
→ Closed

실패 시: Reinspection → Rework Required → In Progress

Cancelled / Superseded는 사유와 권한이 있을 때만 허용한다.

시공사는 공식 Issue를 Closed로 변경할 수 없다.

## 8. RFI / Change / Approval

### RFI
Draft → Submitted → Supervisor Review → Designer/Responsible Party → Response Received → Supervisor Review → Answered/Closed

RFI 답변은 설계변경 승인 자체가 아니다.

### Change
Proposed → Impact Review → Decision Required → Approved / Rejected / Returned → Revised Information Issued → Implementation → Verification → Closed

### Approval
Pending / Under Review → Approved / Rejected / Returned / Expired / Revoked / Superseded

Approval은 대상 객체와 정확한 version/revision에 결합한다.

## 9. 사용자군

상위 Human Actor Group:
- SUP: DOUL 감리
- ADM: DOUL PM / 관리자
- CON: 시공사
- OWN: 발주처
- DES: 설계자

System Actor:
- AI: 관찰후보 제안
- SYSTEM: 분석작업·업무자동화
- INTEGRATION: 외부자료 연동

시험기관과 외부검토자는 MVP 로그인 대상에서 제외한다. Party(TEST_LAB/EXTERNAL_REVIEWER), sourcePartyId, submittedBy와 원본 발행 출처는 보존한다.

## 10. RoleAssignment

권한은 User에 직접 고정하지 않는다.

User → Organization → Project → RoleAssignment → Authority

감리단장, 분야감리, 안전담당, 문서관리 등은 상위 사용자군이 아니라 프로젝트별 RoleAssignment다.

## 11. 핵심 Authority Rule

- Contractor: 자체검측, 검측요청, 시정조치, 재검측요청
- Supervisor: 검측, 공식 Issue/NCR 발행, 재검측, 종결
- Designer: RFI 기술답변, 설계검토, 개정정보
- Owner: 계약·비용·공기·주요변경·중요사항 결정/승인
- Admin/PM: 프로젝트·조직·권한·기준 관리
- AI/SYSTEM/INTEGRATION: 승인·판정·종결·법정서명 불가. 정책·계정·허용명령을 각각 분리한다.

## 12. 불변 규칙

R01 Evidence 원본 불변
R02 Observation은 자동으로 공식 Issue가 되지 않음
R03 Issue 종결권한은 RoleAssignment 기반
R04 Issue 종결에는 Closure Evidence 필요
R05 Approval은 version-specific
R06 Requirement version 보존
R07 Drawing revision 변경 시에도 Location semantic anchor 보존
R08 공식 기록 물리삭제 금지
R09 AI는 공식 승인·판정·종결 수행 금지
R10 Report는 원천데이터를 복제하지 않고 source record를 참조
R11 Hold Point 승인 전 후속공정 진행 금지
R12 Offline 충돌은 Last-Write-Wins로 자동 덮어쓰지 않음
R13 RFI 답변만으로 설계변경 실행 승인 불가
R14 구도면 사용 차단
R15 승인 필요 변경은 Approval 전 실행 불가

## 13. 29개 관리대장과의 관계

기존 29개 관리대장은 유지한다. 다만 앱 DB의 유일한 업무원본으로 사용하지 않고 Domain Object를 집계한 관리 View/Projection으로 사용한다.

- 검측·검수 대장 ← Inspection + Evidence + Requirement
- 부적합·시정 대장 ← Issue + Action + Evidence
- 기술질의 대장 ← WorkItem(RFI) + InformationItem
- 설계변경 대장 ← WorkItem(Change) + Decision + Approval
- 발주처 보고·결정 대장 ← Issue/WorkItem + Decision + Approval + Report
- 일일기록·사진증빙 ← Evidence + WorkItem + Inspection

## 14. 명령·범위·완료판정의 상세 계약

`state_machines_v1.json`은 기존 파일명을 유지한 v2 계약이며 10개 모델·98개 전이를 선언한다. Observation/Inspection/Issue/RFI/Change/Approval 외에 Action, Decision, Report, AnalysisRun을 포함한다. 각 전이는 from/to/command/authority/guards/필수증빙/payload_fields/실패사유/감사기록을 가진다. 상태 직접 PATCH는 금지한다.

검측의 `status`, `resultStatus`, `nextWorkAllowed`를 분리한다. `completed`만으로 합격이나 후속공정 허용을 해석하지 않는다. 합격은 정확한 결과 버전의 작업검수 서명, Hold Point는 추가 기술승인 후 `release_next_work` 명령을 실행한다. 불합격 결과도 서명 기록을 남기되 후속공정은 허용하지 않는다.

각 재검측은 새 Inspection이며 이전 검측·Issue·correctionCycle을 참조한다. 실패하면 주기를 증가시키고 새 시정 Action과 새 재검측을 연결한다. 과거 검측과 조치를 목록에서 제거할 수 없다. 이슈 종결에는 현재 주기 조치 검증, 서명·승인된 합격 재검측, 종결증빙이 필요하다.

RoleAssignment 검사는 인증된 Party·프로젝트·활성 배치·분야·패키지·위치·조직·roleCode·authorityCode와 검증된 자격·등급·유효기간을 함께 확인한다. 숫자 등급 1이 상위이며 현장 기준이 허용하는 등급 범위를 적용한다. 자격 증빙의 적법성·분야 분류는 프로젝트 기준선에서 확인한다. 최소 등급은 신뢰된 Project.qualificationRules에서 계산하며 요청자가 더 낮은 요건을 입력해도 프로젝트 요건을 완화하지 않는다. 기술승인은 요청에 적힌 범위와 실제 승인대상의 범위를 함께 검사한다. 명시적으로 승인된 `*` 범위만 광역 권한이며 SUP라는 그룹만으로 검사·종결권한을 부여하지 않는다.

버전은 optimistic concurrency의 기준이다. 동일한 Idempotency-Key와 동일 본문 재전송은 같은 결과를 반환하고 다른 본문은 충돌한다. 재전송도 현재 인증·배치권한을 확인한다. 오류는 상태·버전·자료·권한을 변경하지 않는다. 운영 저장소는 레코드 갱신·감사기록·중복요청 결과를 한 트랜잭션으로 확정해야 한다.

29개 대장의 연결·계산은 `register_projection_map_v2.json`, 모든 객체의 필드는 `domain_schemas_v2.json`, 문서의 출처 DTO는 `form_domain_bindings_v2.json`이 정의한다. 계산 자료가 빠지면 null/unavailable을 반환한다. 아직 명령서비스가 없는 다른 WorkItem 하위유형은 읽기 전용 조회로 다룬다.
