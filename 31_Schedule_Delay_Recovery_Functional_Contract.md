# 31. Schedule / Delay / Recovery Functional Contract v1.0

기준일: 2026-10-06
문서상태: Product / Functional 상세계약 v1.0
Functional ID: F-04
Functional Domain: D6 Schedule / Commercial / Contract
대상 관리대장: 16 공정·지연
관련 양식: FM-19 주간 감리보고
연계: Owner Report / Decision / Approval / Contract Notice / Claim / EOT

---

## 1. 목적

공정관리를 단순 예정일·실적일 비교가 아니라 다음의 폐쇄형 업무로 관리한다.

> Baseline 확정 → 주기별 Progress Update → 계획 대비 검증 → 지연/위험 식별 → Delay Event 등록 → 원인·영향 분석 → Mitigation / Recovery Plan → 실행 → 효과검증 → 필요 시 Owner Decision / Notice / Claim / EOT 전환 → 종결

핵심 원칙:

1. Baseline은 승인된 특정 버전이며 이후 Progress Update가 이를 덮어쓰지 않는다.
2. Progress Update 수령·확인은 새로운 Baseline 승인과 동일하지 않다.
3. Forecast 변경은 계약상 Completion Date 변경과 동일하지 않다.
4. Delay Event 식별은 EOT entitlement 인정과 동일하지 않다.
5. Recovery Plan 승인·수행은 Contractor 책임 또는 EOT 권리의 자동 인정·포기를 의미하지 않는다.
6. Owner Report 수령은 일정변경 승인 또는 EOT 결정이 아니다.
7. Schedule 데이터는 Data Date와 Source Version을 가진다.
8. 실제실적은 Evidence와 연결하고 과거 실적을 조용히 수정하지 않는다.
9. Critical Path / Total Float 변화와 단순 Activity 지연을 구분한다.
10. 계약상 Notice / Claim / EOT 판단은 F-08에서 별도로 관리한다.

---

## 2. Product Object Model

### 2.1 InformationItem / Schedule

F-04는 다음 InformationItem subtype을 도입한다.

> InformationItem / Schedule

Schedule은 원본 공정파일 또는 검증된 Schedule Snapshot이다.

최소 데이터:

- scheduleNo
- scheduleKind
- revision
- sourceFileRef
- sourceFormat
- dataDate
- periodStart
- periodEnd
- projectStartAt
- contractualCompletionAt
- forecastCompletionAt
- calendars
- wbsVersion
- milestoneSet
- criticalPathRef
- activityCount
- scheduleQualitySummary
- supersedesRef
- submittedAt
- reviewedAt
- acceptedAt

scheduleKind:

- baseline
- progress_update
- recovery
- lookahead

### 2.2 WorkItem / ScheduleActivity

기존 ScheduleActivity는 Schedule Snapshot에서 정규화된 Activity 수준 업무데이터다.

최소 데이터:

- activityId
- wbsPath
- activityName
- responsibleOrganizationId
- plannedStartAt
- plannedFinishAt
- actualStartAt
- actualFinishAt
- forecastStartAt
- forecastFinishAt
- originalDuration
- remainingDuration
- percentComplete
- totalFloat
- critical
- predecessorRefs
- successorRefs
- milestone
- evidenceIds
- sourceScheduleRef

ScheduleActivity는 Source Schedule의 특정 version에 묶인다.

### 2.3 WorkItem / DelayEvent

F-04는 다음 subtype을 도입한다.

> WorkItem / DelayEvent

Delay Event는 일정영향이 발생하거나 발생할 가능성이 있는 사건을 추적한다.

최소 데이터:

- delayEventNo
- eventType
- status
- observedAt
- knownAt
- eventStartAt
- eventEndAt
- causeCategory
- description
- affectedActivityRefs
- affectedMilestoneRefs
- baselineScheduleRef
- currentScheduleRef
- initialForecastImpactDays
- currentForecastImpactDays
- criticalPathAffected
- totalFloatImpact
- evidenceIds
- mitigationActionRefs
- recoveryPlanRefs
- ownerReportRefs
- contractNoticeRefs
- claimRefs
- eotDecisionRef

### 2.4 WorkItem / RecoveryPlan

F-04는 다음 subtype을 도입한다.

> WorkItem / RecoveryPlan

Recovery Plan은 지연을 줄이거나 목표일을 회복하기 위한 실행계획의 검토·승인·효과검증 Case다.

최소 데이터:

- recoveryPlanNo
- triggerDelayEventRefs
- targetMilestoneRefs
- targetCompletionAt
- currentForecastCompletionAt
- proposedForecastCompletionAt
- strategy
- resequencing
- additionalResources
- shiftChanges
- productivityAssumptions
- procurementActions
- designDecisionDependencies
- qualityImpact
- safetyImpact
- costImpact
- contractImpact
- recoveryScheduleRef
- approvalRef
- decisionRefs
- actionRefs
- monitoringPeriod
- effectivenessResult

---

## 3. Baseline과 Update 분리

### Baseline

Baseline은 다음을 의미한다.

> 프로젝트 일정 성과를 비교하는 승인된 기준버전

Baseline에는 최소 다음을 고정한다.

- 계약상 Start / Completion / Milestone
- WBS
- Activity Logic
- Calendar
- Original Duration
- Planned Start / Finish
- Critical Path
- Float
- 승인 대상 Schedule Version

Baseline 변경은 기존 Baseline 수정이 아니라 새로운 Schedule version과 Approval/Decision으로 처리한다.

### Progress Update

Progress Update는 특정 Data Date의 실제 진행상태와 Forecast를 기록한다.

Progress Update는:

- Baseline을 덮어쓰지 않는다.
- Forecast Completion을 갱신할 수 있다.
- 실제 Start/Finish와 Percent Complete를 갱신한다.
- Critical Path와 Float 변화를 기록한다.
- 지연위험과 Delay Event를 생성할 수 있다.

---

## 4. Baseline Review Gate

Baseline 승인 전 최소 검토:

- 계약상 Start / Completion / Milestone 정합
- WBS 완전성
- Activity ID 고유성
- Calendar 정의
- Activity Logic
- Predecessor / Successor 관계
- Open End 식별
- 과도한 Constraint 식별
- 비정상적으로 긴/짧은 Duration
- Critical Path 계산 가능성
- Total Float 이상치
- Procurement / Submittal / Approval / Permit / Testing / Handover Activity 반영
- 발주처 제공정보 또는 Decision dependency 반영
- 공종 간 Interface
- 계약이 요구하면 Resource / Cost Loading
- 원본 공정파일 보존

Schedule 품질검토 통과가 곧 계약상 모든 일정책임 인정은 아니다.

---

## 5. Baseline 상태

Product 상태:

| 상태 | 의미 |
|---|---|
| draft | 작성 중 |
| submitted | 공식 제출 |
| completeness_review | 완전성검토 |
| technical_review | 공정 논리·계약기준 검토 |
| decision_pending | 승인 또는 발주처 결정 대기 |
| approved | 특정 version 승인 |
| effective | 현재 비교기준 |
| returned | 보완요청 |
| rejected | 승인불가 |
| superseded | 새 승인 Baseline으로 대체 |
| withdrawn | 제출자 철회 |

Baseline Approval target은 반드시 정확한 Schedule version을 가리킨다.

---

## 6. Progress Update

정기 Update는 프로젝트별 승인된 주기와 Data Date를 따른다.

최소 입력:

- Schedule source version
- Data Date
- 실제 착수/완료
- Physical Progress
- Remaining Duration
- Forecast Start / Finish
- Updated Logic 변경내역
- Critical Path
- Total Float
- Milestone Forecast
- 주요 지연사유
- 향후 Lookahead
- Evidence

실적은 다음과 연결할 수 있다.

- Inspection
- Material delivery
- Test result
- Photo / Video Evidence
- Daily record
- Approved document
- Owner Decision

---

## 7. Progress Update 검증 규칙

감리는 최소 다음을 확인한다.

1. Data Date가 명시됨
2. 이전 Update와 연속성이 있음
3. 실제 Start/Finish가 Evidence와 정합
4. Percent Complete가 현장실적과 정합
5. 미래일자가 Actual로 입력되지 않음
6. 이전 Actual 변경 시 수정사유가 기록됨
7. Logic 변경이 별도 기록됨
8. Calendar 변경이 기록됨
9. Baseline Activity와 매핑 가능
10. 신규/삭제 Activity가 식별됨
11. Critical Path 변화가 설명됨
12. Forecast Milestone 변화가 설명됨

실적검증 완료는 Forecast 또는 Delay 책임의 승인과 동일하지 않다.

---

## 8. Progress 상태

Progress Update 처리상태:

| 상태 | 의미 |
|---|---|
| submitted | 시공사 제출 |
| completeness_review | 자료 완전성 확인 |
| verification | 실적·Logic·Forecast 검증 |
| accepted_for_reporting | 보고·비교에 사용 가능 |
| returned | 보완 필요 |
| frozen | 해당 Data Date의 확정 Snapshot |
| superseded | 정정 Update로 대체 |

frozen 이후 수정은 새 version으로 한다.

---

## 9. Variance

관리대장 16은 최소 다음 편차를 분리한다.

- Start Variance
- Finish Variance
- Milestone Variance
- Forecast Completion Variance
- Percent Complete Variance
- Critical Path Shift
- Total Float Change
- Negative Float
- Recovery Gap

단순 Delay Days 하나로 모든 일정상태를 표현하지 않는다.

---

## 10. Delay Trigger

다음은 Delay Event 생성 Trigger가 될 수 있다.

- Baseline Milestone 지연
- Forecast Completion 악화
- Critical Path Activity 지연
- Total Float 급감/음수
- 승인/의사결정 대기
- 설계변경
- RFI 장기 미결
- 자재/장비 조달 지연
- 시험/검측 실패
- Safety Stop
- 인허가/PCCC 영향
- Owner Instruction
- Contractor 생산성 저하
- Subcontractor 문제
- 불가항력 또는 외부사건 후보
- 반복되는 계획 대비 실적미달

Threshold는 프로젝트 공정관리계획에서 설정한다.

시스템은 threshold 초과를 자동으로 계약상 지연책임 확정으로 해석하지 않는다.

---

## 11. Delay Event 상태

| 상태 | 의미 |
|---|---|
| observed | 지연/위험 식별 |
| notified | 관계자 공식 통보 |
| under_assessment | 원인·범위 검토 |
| impact_analysis | Schedule Impact 분석 |
| mitigation_active | 완화조치 실행 |
| monitoring | 영향 지속 관찰 |
| resolved | 사건 자체 종료 |
| transferred | Notice / Claim / EOT로 이관 |
| closed | 사실·영향·후속경로 정리 완료 |
| cancelled | 오등록/중복 등 정당한 취소 |

---

## 12. Delay Event Command

| From | Command | Actor | To | 핵심 Gate |
|---|---|---|---|---|
| - | create_delay_event | SUP/CON | observed | 사건·근거·Schedule refs |
| observed | notify | SUP | notified | 공식 통보 |
| notified | start_assessment | SUP | under_assessment | 담당자 지정 |
| under_assessment | start_impact_analysis | SUP | impact_analysis | 원인·영향대상 식별 |
| impact_analysis | start_mitigation | SUP/CON | mitigation_active | Action/Recovery 연결 |
| mitigation_active | monitor | SUP | monitoring | 실행상태 확인 |
| monitoring | resolve_event | SUP | resolved | 사건 종료근거 |
| under_assessment/impact_analysis/monitoring | transfer_contract_track | SUP | transferred | Notice/Claim/EOT ref |
| resolved/transferred | close_delay_event | SUP | closed | 후속경로·보고 정리 |

---

## 13. 원인과 계약상 권리 분리

Delay Event에는 사실원인과 계약판단을 구분한다.

### 사실원인 예

- design_information_late
- owner_decision_late
- contractor_productivity
- procurement_delay
- subcontractor_delay
- authority_delay
- weather_event
- safety_stop
- quality_rework
- change_event
- access_constraint
- utility_interface
- other

### 계약상 분류

다음은 F-04가 확정하지 않는다.

- excusable
- non-excusable
- compensable
- non-compensable
- concurrent delay
- EOT entitlement

이 판단은 Contract Notice / Claim / EOT(F-08)의 계약검토와 Decision으로 확정한다.

---

## 14. Impact Analysis

Delay Impact는 최소 다음을 보존한다.

- 분석기준 Baseline version
- 분석 Data Date
- 분석대상 Schedule version
- 영향 Activity
- 영향 Milestone
- Critical Path 여부
- Before/After Forecast
- Float 변화
- 예상 지연일
- 실제 지연일
- Mitigation 반영 여부
- 사용한 가정
- Evidence
- Analyst
- ReviewedAt

분석방법은 프로젝트 계약과 Schedule Management Plan에 따라 정한다.

한 분석방법을 모든 프로젝트에 강제하지 않는다.

---

## 15. Recovery Plan Trigger

다음 중 하나 이상이면 Recovery Plan을 요구할 수 있다.

- Critical Milestone Forecast 지연
- Project Completion Forecast 지연
- Negative Float
- 반복된 주간 실적미달
- Delay Event의 영향이 프로젝트 Threshold 초과
- 발주처/감리 공식 요구
- 계약상 Recovery Schedule 제출조건 발생

---

## 16. Recovery Plan 상태

| 상태 | 의미 |
|---|---|
| requested | 제출요구 |
| draft | 시공사 작성 |
| submitted | 공식 제출 |
| completeness_review | 자료 완전성 검토 |
| technical_review | 실행가능성 검토 |
| decision_pending | 주요 변경/비용/공기 결정 대기 |
| accepted_for_execution | 실행 승인 |
| returned | 보완요청 |
| rejected | 실행불가 |
| active | 실행 중 |
| monitoring | 효과검증 |
| effective | 목표 회복 또는 유의미한 회복 |
| ineffective | 목표 미달 |
| completed | 계획 종료 |
| superseded | 새 Recovery Plan으로 대체 |
| cancelled | 취소 |

---

## 17. Recovery Plan 검토 Gate

최소 확인:

- 현재 Data Date
- 현재 Forecast
- 회복 Target
- Critical Activities
- Resequencing
- Resource 추가
- Shift/Working Hour 변경
- Procurement 대책
- Submittal/Approval 단축조건
- 발주처 Decision dependency
- 품질영향
- 안전영향
- 인허가/PCCC 영향
- 비용영향
- 계약영향
- 생산성 가정
- 실행 책임자
- 주간 Monitoring KPI
- Recovery Schedule exact version

품질·안전기준 완화를 회복수단으로 인정하지 않는다.

---

## 18. Recovery Plan 승인과 EOT 관계

다음은 서로 다르다.

- Recovery Plan accepted
- Baseline revision approved
- Owner Decision
- Acceleration instruction
- Variation
- EOT approved
- Claim agreed

예:

> 발주처가 Recovery Plan 실행을 승인했어도 EOT를 거절/보류할 수 있다.

반대로:

> EOT가 승인되어도 Recovery Plan이 필요한 경우가 있다.

---

## 19. Baseline Revision

Baseline은 다음 경우에만 새 version으로 갱신한다.

- 계약상 승인된 일정변경
- 승인된 EOT
- 승인된 주요 Variation/Change로 기준일정 변경
- 발주처가 계약상 권한으로 새 Baseline 승인
- 프로젝트별 Baseline Reset 조건 충족

현재 Forecast 악화만으로 Baseline을 변경하지 않는다.

새 Baseline이 effective가 되면 기존 Baseline은 superseded지만 삭제하지 않는다.

---

## 20. Schedule Data Integrity

공정데이터는 다음을 Audit한다.

- Source file hash
- Source file version
- ImportedAt
- Data Date
- Parser/version if imported
- Activity mapping
- Manual corrections
- Who/when/reason
- Baseline reference
- Previous Schedule reference

같은 Activity ID라도 Source Schedule version이 다르면 값을 조용히 덮어쓰지 않는다.

---

## 21. Actual Progress Evidence

Actual Start / Finish / Percent Complete는 가능한 범위에서 Evidence로 검증한다.

예:

- Inspection pass
- Material delivery
- Approved shop drawing
- Test pass
- Daily record
- Photo/video
- Equipment commissioning
- Signed record

공정정보는 다른 Domain의 상태를 임의로 변경하지 않는다.

예:

- Activity 100% ≠ Inspection passed
- Schedule milestone complete ≠ Owner accepted
- Forecast finish achieved ≠ Handover complete

---

## 22. Owner Reporting Trigger

다음은 발주처 보고 대상이다.

- 계약상 주요 Milestone Forecast 지연
- Project Completion Forecast 지연
- Critical Path 악화
- Negative Float
- Recovery Plan 요구
- Recovery Plan ineffective
- Owner Decision이 Critical Path를 Blocking
- 주요 Safety Stop/Quality Rework가 일정에 영향
- 인허가/PCCC 영향
- 계약상 Notice 필요 가능성

중대 지연은 Immediate Report, 일반 추세는 Weekly/Periodic Report로 관리한다.

발주처 보고는 정확한 Schedule/DelayEvent/RecoveryPlan version을 sourceDomainRefs로 참조한다.

---

## 23. Owner Decision Trigger

다음은 Decision으로 전환할 수 있다.

- 발주처 제공정보 기한
- 설계안 선택
- 장기납기품 결정
- 주요 Sequence 변경
- 발주처 책임 Access/Interface
- Acceleration 비용
- Contractual Completion Date 변경
- 주요 Recovery Alternative 선택

Decision 수령확인과 Decision 완료를 구분한다.

---

## 24. Contract Notice / Claim / EOT 연계

Delay Event가 계약상 권리·책임 판단이 필요한 경우 F-08로 전달한다.

전달할 최소 Package:

- Delay Event exact version
- Baseline exact version
- Progress Update exact version
- Impact Analysis
- Event chronology
- Evidence
- Related Instruction/Decision/Change
- Notice deadline
- Preliminary impact

F-04 Delay Event를 닫아도 F-08 Claim/EOT가 자동 종결되지 않는다.

---

## 25. FM-19 주간보고 Mapping

FM-19는 공정 원장을 대신하지 않는 보고 Snapshot이다.

주간보고의 공정 파트는 최소 다음 Source를 참조한다.

- effective Baseline
- current frozen Progress Update
- current Data Date
- 주요 Milestone variance
- Critical Path
- Forecast Completion
- Open Delay Events
- Active Recovery Plans
- Owner Decision blockers
- 다음주 Lookahead

기존 텍스트 필드는 해당 Source를 요약한다.

weekly.progress에 원본 Schedule 상태를 수동복사해 원장처럼 사용하지 않는다.

---

## 26. 관리대장 16 Projection

보여줄 것:

- Effective Baseline Version
- Current Schedule Version
- Data Date
- Baseline Completion
- Forecast Completion
- Forecast Variance
- Major Milestones
- Critical Path Summary
- Negative Float
- Open Delay Events
- Delay Cause Status
- Active Recovery Plan
- Recovery Target
- Recovery Effectiveness
- Owner Decision blockers
- Contract Notice / Claim / EOT refs
- Last Verified Update
- Next Update Due

16번 대장은 조회형 Projection으로 유지할 수 있다.

실제 상태변경은 Schedule/DelayEvent/RecoveryPlan의 Domain Command에서 수행한다.

---

## 27. Functional Inventory

| ID | Function | Primary Actor | Trigger | 완료조건 |
|---|---|---|---|---|
| F04-01 | Baseline Submit | CON | 착수/계약요구 | Schedule version 제출 |
| F04-02 | Baseline Review | SUP | 제출 | 품질·논리 검토 |
| F04-03 | Baseline Approval | 권한자 | 검토완료 | effective baseline 확정 |
| F04-04 | Progress Update | CON | 주기/Data Date | 공식 Update 제출 |
| F04-05 | Progress Verification | SUP | Update | frozen verified snapshot |
| F04-06 | Variance Detection | SYSTEM/SUP | Update | 편차 식별 |
| F04-07 | Delay Event | SUP/CON | 지연/위험 | 사건 Case 생성 |
| F04-08 | Delay Assessment | SUP | Event | 원인·영향 검토 |
| F04-09 | Impact Analysis | SUP/Planner | 중요 Event | Schedule impact 기록 |
| F04-10 | Mitigation | CON/SUP | 영향확인 | 완화조치 실행 |
| F04-11 | Recovery Request | SUP | Threshold 초과 | 제출요구 |
| F04-12 | Recovery Review | SUP | Recovery 제출 | 실행가능성 검토 |
| F04-13 | Recovery Approval | 권한자 | 검토완료 | 실행 승인 |
| F04-14 | Recovery Monitoring | SUP | 실행 | 효과검증 |
| F04-15 | Owner Reporting | SUP | 주요 지연 | 보고·Decision 연결 |
| F04-16 | Contract Track Transfer | SUP | 권리판단 필요 | F-08 전달 |
| F04-17 | Baseline Revision | OWN/SUP | 승인된 일정변경 | 새 Baseline effective |

---

## 28. Completion Criteria

### Progress Update 완료

- Data Date 확정
- Activity Actual 검증
- Forecast 검토
- Critical Path 검토
- 주요 Variance 설명
- Snapshot frozen
- Source version 보존

### Delay Event 완료

- 사건기간/원인 사실관계 정리
- 영향 Activity/Milestone 연결
- Impact 상태 정리
- Mitigation 결과 기록
- Owner Report 필요사항 처리
- Contract Notice/Claim/EOT 필요 시 F-08로 이관
- Audit 보존

### Recovery Plan 완료

- 승인된 실행안 존재
- Action 책임자/기한 존재
- Monitoring 결과 존재
- Effective/Ineffective 판정
- 미회복 시 후속 Plan 또는 Contract Track 연결
- 최종 Schedule snapshot 보존

---

## 29. Backend Handoff Contract

Backend는 다음 Product 의미를 변경하지 않는다.

- InformationItem / Schedule
- WorkItem / ScheduleActivity
- WorkItem / DelayEvent
- WorkItem / RecoveryPlan
- Baseline exact version
- Data Date
- immutable Progress Snapshot
- Forecast와 Baseline 분리
- Delay 사실과 EOT entitlement 분리
- Recovery Plan과 Baseline Revision 분리
- Owner Report / Decision refs
- Contract Notice / Claim / EOT refs
- Audit / source file hash

Product 실행계약은 다음 기계계약으로 확정한다.

- `app/schema/domain_schemas_v2.json`: `ScheduleData`, `ScheduleActivityData`, `DelayEventData`, `DelayImpactAnalysisData`, `RecoveryPlanData` 및 Schedule 품질/Variance 하위 Schema
- `app/schema/state_machines_v1.json`: `schedule_baseline`, `schedule_progress`, `delay_event`, `recovery_plan`
- `app/schema/authority_matrix_v1.json`: `schedule.*` 권한정책
- `app/schema/schedule_execution_contract_v1.json`: Baseline activation, Progress freeze/correction, Delay entitlement 경계, Recovery/Baseline/EOT 경계
- `app/reference/machine_bindings_v1.json`: Schedule/Delay/Recovery API collection과 create authority
- 관리대장 16의 command projection

Backend는 위 계약을 구현하며 별도 상태·권한·필드 의미를 재정의하지 않는다. `variance`, `effectivenessResult`, workflow timestamp는 사용자 임의입력이 아니라 검증/명령 결과로 계산되는 서버 관리값이다.

Baseline activation은 동일 Project/Package/Discipline 범위에서 exact approved Schedule 하나만 effective가 되도록 원자적으로 처리하고, 기존 effective Baseline은 삭제하지 않고 `superseded`로 보존한다. Progress `frozen` Snapshot은 수정하지 않으며 정정은 새 Schedule record + reason + supersedes chain으로 처리한다.

---

## 30. UI Handoff Contract

UI는 최소 다음을 한 화면에서 구분해 보여준다.

- Baseline Completion
- Current Forecast Completion
- Data Date
- Critical Path 상태
- Delay Events
- Recovery Plan 상태
- Owner Decision blockers
- Contract Track 상태

예:

> Baseline 2027-03-31 / Forecast 2027-04-18 / +18 days / Critical Delay Event 2건 / Recovery Plan Active

Baseline과 Forecast를 같은 날짜 필드 하나로 합치지 않는다.

---

## 31. Product Validation Scenarios

### Scenario A — 정상 Progress Update

Baseline v3 effective → Progress Update D-2026-10-05 제출 → 검증 → frozen

기대:
- Baseline v3 유지
- Forecast만 갱신
- Source version 보존

### Scenario B — Forecast 악화

Forecast Completion +14일

기대:
- Baseline 변경 없음
- Delay Threshold 평가
- 필요 시 DelayEvent 생성

### Scenario C — Owner Decision 지연

Owner Decision이 Critical Activity를 Blocking

기대:
- Delay Event 연결
- Owner Report / Decision due 추적
- EOT entitlement는 아직 미확정

### Scenario D — Recovery Plan 승인

Recovery Plan으로 Forecast +14일 → +5일 개선

기대:
- Recovery Plan effectiveness 기록
- Baseline은 자동 변경되지 않음

### Scenario E — EOT 승인

F-08 EOT Decision +10일 승인

기대:
- 새 Baseline version 승인절차
- 과거 Baseline superseded
- 이력 유지

### Scenario F — 과거 Actual 수정

이전 Update의 Actual Finish 변경 필요

기대:
- 기존 frozen Snapshot 수정 금지
- 정정 Schedule version + reason + Audit

### Scenario G — Activity 100%

Schedule Activity 100%이지만 Inspection 미합격

기대:
- 공정정보만 100%
- Inspection 상태는 변경하지 않음

### Scenario H — Delay Event 종료 후 Claim 진행

Delay Event 사실관계 종료 → F-08 Claim 진행

기대:
- Delay Event는 transferred/closed 가능
- Claim/EOT는 독립 상태 유지

---

## 32. F-04 완료판정

F-04 Product / Functional Design은 다음을 정의했으므로 관리대장 16의 Product 성숙도를 M3로 평가한다.

- Schedule Snapshot
- Baseline
- Progress Update
- Data Date
- Schedule Activity
- Variance
- Delay Event
- Impact Analysis
- Recovery Plan
- Baseline Revision
- Owner Reporting / Decision
- Contract Notice / Claim / EOT 경계
- FM-19 Mapping
- Register Projection
- Completion Criteria
- Backend/UI Handoff
- Baseline / Progress / Delay / Recovery 실행 State Machine·Authority·Guard
- immutable Schedule source/hash/version 및 server-managed timestamp
- Baseline activation / Progress correction atomicity
- Delay Event와 entitlement 분리
- Recovery acceptance와 Baseline/EOT/Cost 승인 분리

F-04의 업무 의미는 `app/schema/schedule_execution_contract_v1.json`과 상기 State/Authority/Schema 계약으로 실행 가능하게 구조화했다. Backend B-P3 구현 인수 전까지 진척단계는 `contract_confirmed`로 유지한다.

다음 Product 상세설계는 F-05 Progress Measurement / Payment로 진행한다.

---

## 33. Schedule 원본과 Activity 원자적 입력 실행계약

Source of Truth: `app/schema/schedule_source_import_contract_v1.json`.
상태: **Product 계약 정의, Backend/API 미구현**. Proposed endpoint는 실제 사용 가능한 API가 아니다.

### 33.1 입력과 권한

원본 공정 하나와 그 원본에서 정규화한 전체 Activity를 `import_schedule_source_package` 한 요청으로 입력한다. Baseline은 기존 `schedule.baseline.create`, Progress는 `schedule.progress.submit`, supporting Recovery Schedule은 `schedule.recovery.submit` 권한을 그대로 소비한다. 프로젝트·패키지·분야·위치·책임 조직과 유효 배치를 모두 검증한다. SUP/OWN/ADM 또는 SYSTEM에 시공사 원본 제출권한을 추가하지 않는다.

Baseline은 `draft`, Progress는 `submitted`로 시작하고 이후 기존 F-04 명령·검토·승인 절차를 따른다. Recovery 원본은 기존 `snapshot` supporting record이며 회복계획 수락·기준공정 승인 상태를 얻지 않는다. Lookahead 입력과 XER/MS Project 자동 파서는 후속 범위다. v1은 보존된 정규화 JSON 원본만 지원한다.

### 33.2 원본 증빙과 식별

원본 Evidence의 정확한 ID/version, fileId, 보존된 bytes의 SHA-256, 파일 버전과 parser version을 검증한다. Evidence가 다른 프로젝트·권한 범위이면 입력을 거부한다. 파일이 읽히지 않거나 해시·정규화 내용이 요청 Schedule/Activity와 다르면 저장을 성공으로 확정하지 않는다. source fileId/hash를 임의 문자열로 입력했다는 사실만으로 원본 보존을 인정하지 않는다.

Activity의 `sourceScheduleRef`는 서버가 신규 Schedule의 **최초 원본 version 1**로 생성한다. 사용자는 이를 주입할 수 없다. Activity ID는 해당 원본 내에서 고유하며 객체 ID 충돌을 거부한다. 선후행 관계는 같은 원본의 정확한 Activity 참조로 검증한다. 주공정 Activity ID가 해당 원본에 있어야 하며 서버가 `criticalPathRef`와 `activityCount`를 만든다.

### 33.3 원자성·불변성·정정

Schedule, 모든 Activity, Audit, 중복요청 결과를 하나의 transaction으로 저장한다. 일부 Activity·파일 검증·저장 실패 시 전부 rollback한다. 고아 Activity와 부분 성공은 허용하지 않는다. 동일 Idempotency-Key/동일 본문은 재시작 후에도 최초 결과를 재현하고, 동일 키/다른 본문은 거부한다.

입력 완료된 원본 Schedule 내용과 Activity는 immutable이다. 접수·검토·승인 등 workflow version이 증가해도 Activity의 최초 source version을 현재 version으로 다시 연결하지 않는다. source ref와 critical Activity가 가리키는 최초 원본을 역사 조회로 재현할 수 있어야 한다.

입력된 원본의 파일·날짜·작업·예측 내용 정정은 새 Schedule/Activity 원본 객체로 만든다. imported record의 일반 workflow payload로 원본 내용을 교체하지 않는다. 검토 체크리스트·승인 참조·검증 결과·업무 timestamp는 기존 명령에서 관리한다. 기존 legacy 기록의 참조를 자동 재해석하거나 다시 연결하지 않는다.

Progress는 effective Baseline, 이전 frozen Snapshot과 필요한 정정 사유를 exact version으로 검증하고 기존 Data Date 역행·동일 Data Date 정정조건을 적용한다. Baseline Activity mapping은 해당 기준공정의 원본 버전에 속해야 한다. 실제 시작/종료가 Data Date보다 미래이거나 종료가 시작보다 빠른 입력을 거부한다.

### 33.4 인수

계약 JSON의 acceptance 목록을 Backend/UI/Platform 통합시험에서 증명한다. Product schema 검증 통과는 저장/API 구현 인수가 아니다. Baseline → 승인·적용 → Progress → 검증·확정을 실제 입력 경로로 연결하고, Baseline 보존·정정 이력·중복요청·재시작·권한·파일 장애·부분 transaction 실패를 검증한다. 100% 진도는 검측/인수 합격 또는 EOT 승인이 아니며 발주처 후속조치 종결도 별도이다.

### 33.5 정규화 원본의 비교 경계

v1 정규화 JSON 원본은 `schedule`, `activities`, `criticalActivityId`를 갖는다. `schedule` 내용 비교에서 sourceFileRef/sourceFileHash는 제외한다. 이 값들은 원본 파일을 저장·해시 계산한 후의 외부 식별자이므로 파일 내용 자체에 SHA-256을 포함시켜 자기참조하도록 요구하지 않는다. 역할·객체 생성 ID·증빙 연결 ID 등 요청 envelope도 원본 내용 비교에서 제외한다.

원본 작업 관계는 predecessorActivityIds/successorActivityIds라는 원본 내 Activity ID 목록으로 입력한다. 서버가 동일 원본의 실제 WorkItem ID/version 1 참조로 변환하며, 사용자는 predecessorRefs/successorRefs를 주입하지 않는다. 없는 작업·다른 원본 관계·중복 작업 ID를 거부한다. 선정한 주공정 작업은 critical=true여야 한다. 사용자 객체 ID는 원본 비교와 분리하되 요청 내 고유성을 검사한다.

기존 명령 폼이 동일 원본 값을 재전송하는 것은 내용 수정이 아니므로 허용할 수 있다. 값이 실제로 달라지는 경우에만 새 원본 입력을 요구한다. 이 조건은 imported source에 적용하며 과거 legacy workflow를 임의 변경하지 않는다.

서버는 Schedule.metadata.sourceImport에 contractVersion, parserVersion, inputMode, sourceEvidenceRef, 최초 sourceScheduleRef와 전체 activityRefs를 보존한다. 이 provenance 표시는 사용자가 생성/변경하지 않는다. Activity의 프로젝트·패키지·위치·분야·책임 조직은 부모 Schedule 범위를 상속하며, 증빙 권한은 각 참조에 대해 다시 검사한다.
