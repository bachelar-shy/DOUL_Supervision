# 17. DOUL 감리 앱 Domain · State · Authority Model v2

기준일: 2026-10-04
상태: v0.2 구현기준

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
- SYS: AI / 자동화 / 외부 시스템 연동

시험기관과 외부검토자는 앱 사용자군에서 제외한다. 시험성적서·외부검토자료는 시공사가 제출하고 감리가 검토하는 InformationItem/Evidence로 관리한다.

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
- AI/SYS: 제안·분류·초안 가능, 공식 승인/종결 불가

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
