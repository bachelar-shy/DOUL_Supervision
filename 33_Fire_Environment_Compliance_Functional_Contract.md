# 33. Fire / Environment Compliance Functional Contract v1.0

기준일: 2026-10-06
Functional ID: F-06
Domain: D5 Safety / Compliance
대상 관리대장: 20 PCCC(소방), 21 환경
관련 양식: FM-27, FM-28

## 1. 목적

소방·환경 관리를 단순 증빙 보관이 아니라 다음 폐쇄형 업무로 관리한다.

> 적용성·조건 확인 → 제출/검토 → 시공·설치 확인 → 시험/측정 → 법정/계약상 수용 확인 → 미달 시 Issue/Action → 재확인 → 운영·인수 조건 반영

핵심 원칙:

1. 법정 제출 ≠ 법정 승인.
2. 내부 검토 ≠ 관할기관 승인.
3. 시험 Pass ≠ 전체 시스템 수용.
4. 법정 수용 ≠ Owner Handover.
5. 환경 측정값 수신 ≠ 감리의 적합판정.
6. 법정 원본서식·전자문서는 원형 그대로 보존하고 DOUL 양식이 대체하지 않는다.
7. 법령명·서식번호는 Project Requirement에 버전으로 관리하며 앱에 고정하지 않는다.
8. 승인/허가/검사 결과의 유효기간과 적용 Scope를 분리한다.

## 2. Product Objects

### FireCompliance
WorkItem / FireCompliance

최소 데이터:
- complianceNo
- requirementRefs
- designDocumentRefs
- authoritySubmissionRefs
- approvalRefs
- installationInspectionRefs
- precommissioningTestRefs
- integratedTestRefs
- statutoryAcceptanceRefs
- openFireIssueRefs
- applicableSystems
- locationScope
- currentStage
- blockedReasons

### EnvironmentalControl
기존 WorkItem / EnvironmentalControl을 상세화한다.

최소 데이터:
- controlNo
- requirementRefs
- permitOrRegistrationRefs
- monitoringPlanRef
- monitoringPointRefs
- limitCriteria
- sampling/test refs
- incidentRefs
- environmentalIssueRefs
- externalReportRefs
- correctiveActionRefs
- currentComplianceStatus

## 3. FireCompliance State

| 상태 | 의미 |
|---|---|
| applicability_review | 적용 Requirement 확인 |
| design_review | 설계 적합성 검토 |
| submission_pending | 법정/계약 제출 준비 |
| authority_review | 외부 심사/검토 중 |
| approved_for_construction | 해당 version 시공 가능 |
| installation_verification | 설치상태 확인 |
| test_pending | 개별 시험 대기 |
| integrated_test | 통합 시험 |
| acceptance_pending | 법정/계약상 수용 대기 |
| accepted | 요구된 수용 완료 |
| corrective_action | 미달 시정 |
| superseded | 새 version으로 대체 |
| expired | 유효성 만료 |
| not_applicable | 근거 있는 비적용 |

## 4. Fire Gate

시공/시험/인수 단계별 Gate를 분리한다.

### 설계 Gate
- applicable Requirement 식별
- exact drawing/spec version
- system boundary
- 계산/성능조건
- 타 공종 interface
- 필요한 외부 검토/승인

### 설치 Gate
- 승인 version 일치
- 승인 자재/장비
- 설치 Inspection
- concealed work evidence
- open Fire Issue 없음

### 시험 Gate
- test procedure current
- calibrated equipment
- precondition 충족
- 개별 system test
- integrated test
- failed test는 Issue/Retest로 연결

### 수용 Gate
- 필요한 시험 완료
- required statutory/contractual records 존재
- unresolved blocking issue 없음
- exact accepted version 보존

## 5. EnvironmentalControl State

| 상태 | 의미 |
|---|---|
| applicability_review | 적용조건 확인 |
| condition_registered | 요구조건 등록 |
| monitoring_planned | 측정/점검계획 확정 |
| monitoring_active | 정기관리 중 |
| exceedance_detected | 기준초과/위반 후보 |
| incident_response | 사고/민원/유출 대응 |
| corrective_action | 시정 중 |
| reverification | 재측정·재확인 |
| compliant | 현재 조건 충족 |
| reporting_pending | 외부/Owner 보고 필요 |
| suspended | 주요 조건 미충족으로 관련 작업 제한 |
| closed | 해당 관리기간 종료 |

## 6. 환경 Gate

- 적용 Requirement 및 허가/등록조건
- 측정 위치·주기·방법
- Lab/측정장비 적격성
- 기준값과 단위
- 원시 측정결과 보존
- SUP 판단 별도 기록
- 초과 시 영향범위
- 시정조치
- 재측정
- 필요 시 관할기관/Owner 보고

## 7. Compliance Readiness

fireComplianceReady = true 최소조건:
- applicable design approval current
- installation verification complete
- required tests passed
- integrated test complete if required
- statutory/contractual acceptance complete if required
- no blocking Fire Issue

환경 currentComplianceStatus는 다음을 분리한다.
- unknown
- compliant
- warning
- exceedance
- incident
- corrective_action
- suspended

unknown을 compliant로 간주하지 않는다.

## 8. 법정 원본과 DOUL Snapshot

- 법정 원본: 원 파일/전자원본 보존
- DOUL FM-27/FM-28: 내부 검토·상태 Snapshot
- 법정 원본의 서명/직인/전자검증을 재작성하지 않는다.
- DOUL 문서는 source document ID/version/hash를 참조한다.

## 9. Owner Reporting Trigger

즉시 또는 의사결정 보고 후보:
- 주요 법정 승인 지연
- 통합시험 실패
- 운영/인수에 영향을 주는 Fire Issue
- 환경 기준초과/사고/민원
- 작업중지 또는 생산/공정 영향
- 비용/공기 영향
- 관할기관 추가요구

Owner Report 수령은 법정 승인이나 기술판정을 대체하지 않는다.

## 10. 관리대장 20 Projection

- applicable requirements
- design approval status
- current stage
- authority submission/response
- installation verification
- test status
- integrated test
- statutory acceptance
- open Fire Issues
- expiry / renewal
- blockedReasons

기존 `pc18_signed` 같은 특정 서식 의존 필드는 legacy compatibility로만 취급하고, authoritative gate는 Requirement 기반으로 계산한다.

## 11. 관리대장 21 Projection

- permit/registration condition
- monitoring plan
- latest measurement
- compliance status
- exceedance/incident
- corrective action
- reverification
- external report
- Owner report
- next monitoring due

## 12. FM-27 / FM-28

FM-27: 소방 적합성·시험·수용 검토서
- Project/System/Location
- Requirement refs
- design approval
- installation inspection
- test/integrated test
- statutory acceptance refs
- open issue
- current conclusion

FM-28: 환경 준수·측정 검토서
- requirement/permit condition
- monitoring point/date/method
- raw result/criterion
- SUP interpretation
- incident/corrective action
- reverification
- reporting status

## 13. Backend / UI Handoff

Backend는 FireCompliance, EnvironmentalControl, exact version, blocking issue, statutory source refs를 보존한다.

UI는 다음을 하나의 Approved badge로 합치지 않는다.
- 제출
- 승인
- 설치검증
- 시험
- 법정수용
- 현재 준수상태

## 14. Validation Scenarios

1. 설계승인 완료, 통합시험 미완료 → fireComplianceReady=false
2. 법정문서 제출만 완료 → accepted 아님
3. 환경 측정값 기준초과 → Environmental Issue/Action 후보
4. 재측정 Pass → 최초 초과기록 유지
5. Owner 수령확인 → 법정/기술상태 변경 없음
6. Requirement version 변경 → 기존 승인 Scope 재평가

## 15. 완료판정

관리대장 20·21은 Actor/State/Gate/Exception/Owner Reporting/Completion이 정의되었으므로 M3로 평가한다.

## 16. Actor / Decision Right

| 행위 | 기본 Actor | Decision Right |
|---|---|---|
| 적용성·Requirement 등록 | SUP/ADM | SUP가 기술적 적용성을 확인, 법적 최종해석은 권한기관/법률검토 우선 |
| 소방 설계검토 | SUP/DES | 기술검토이며 관할기관 승인을 대체하지 않음 |
| 법정/계약 제출 | OWN/CON/SUP according to requirement | 제출주체는 프로젝트 Requirement가 결정 |
| 설치검증·시험판정 | SUP | 해당 자격/Scope의 SUP |
| 환경 측정자료 제출 | CON / external source | 원시값 제출권한만 가짐 |
| 환경 적합판정 | SUP | 기준·방법·Evidence 검증 후 판정 |
| 시정조치 | CON | 완료제출만 가능, 최종검증 불가 |
| 주요 예외/운영영향 결정 | OWN | 계약·운영·비용·공기 결정 |

ADM, AI, SYSTEM, INTEGRATION은 법정승인·기술판정·수용결정을 하지 않는다.

## 17. FireCompliance Command Contract

| From | Command | Actor | To | Required Gate |
|---|---|---|---|---|
| applicability_review | confirm_applicability | SUP | design_review / not_applicable | requirementRefs, basisVersion, scope |
| design_review | prepare_submission | SUP/DES | submission_pending | current design refs, review result |
| submission_pending | submit_to_authority | authorized party | authority_review | exact package, submittedAt, receipt evidence |
| authority_review | record_supplement_request | SUP/ADM | submission_pending | official response ref, dueAt |
| authority_review | record_design_acceptance | SUP/ADM | approved_for_construction | official approval/acceptance ref, scope/version |
| approved_for_construction | start_installation_verification | SUP | installation_verification | current approval, installation scope |
| installation_verification | request_test | SUP | test_pending | installation gate complete |
| test_pending | start_integrated_test | SUP | integrated_test | required individual tests passed |
| integrated_test | request_acceptance | SUP | acceptance_pending | integrated result, records package |
| acceptance_pending | record_acceptance | authorized party | accepted | statutory/contractual acceptance evidence |
| any active | open_corrective_action | SUP | corrective_action | failure/issue ref |
| corrective_action | reverify_compliance | SUP | appropriate prior stage | verified correction evidence |

승인/수용을 기록하는 command는 외부기관 또는 계약권한자의 원 결정을 생성하지 않고 **그 결정의 Evidence를 등록**하는 의미다.

## 18. Environmental Command Contract

| From | Command | Actor | To | Required Gate |
|---|---|---|---|---|
| applicability_review | confirm_environment_conditions | SUP | condition_registered | requirement/permit conditions |
| condition_registered | approve_monitoring_plan | SUP | monitoring_planned | point/method/frequency/criteria |
| monitoring_planned | start_monitoring | SUP | monitoring_active | readiness complete |
| monitoring_active | record_measurement | CON/SUP/source | monitoring_active | raw result + method + evidence |
| monitoring_active | flag_exceedance | SUP | exceedance_detected | criterion comparison |
| monitoring_active | record_incident | SUP/CON | incident_response | event scope/evidence |
| exceedance_detected/incident_response | require_correction | SUP | corrective_action | action owner/due |
| corrective_action | request_reverification | CON | reverification | correction evidence |
| reverification | confirm_compliance | SUP | compliant | valid remeasurement/reinspection |
| any active | require_external_report | SUP | reporting_pending | reporting trigger |
| reporting_pending | record_report_submission | authorized party | monitoring_active/compliant | submission/receipt evidence |

## 19. Exception / Escalation / SLA

프로젝트 설정으로 최소 다음 기한을 관리한다.

- authority response follow-up due
- supplement response due
- test/retest due
- environmental monitoring due
- exceedance corrective action due
- incident immediate-report due
- permit/approval/certificate expiry warning

기한초과는 자동 승인·부적합·법적책임 확정이 아니라 `overdue`/escalation 상태정보다.

Escalation 후보:
- critical path impact
- occupancy/operation/handover impact
- repeated test failure
- environmental incident with external impact
- statutory response/rejection threatening project milestone

## 20. Completion Criteria

FireCompliance 완료:
- applicable Requirements closed or transferred
- exact design approval/acceptance refs fixed
- required installation/test/integrated-test results accepted
- no blocking Fire Issue
- required statutory/contractual acceptance recorded
- final source versions/snapshots preserved

Environmental control period 완료:
- required monitoring performed
- exceedance/incident resolved or transferred to continuing case
- corrective action independently reverified
- required external/Owner report status complete
- next-period obligations transferred without loss

## 21. Backend Handoff Minimum

Backend implementation must expose explicit commands rather than generic status patching, preserve `expectedVersion` and idempotency, and calculate readiness from current Requirement/version/evidence rather than client-provided booleans.
