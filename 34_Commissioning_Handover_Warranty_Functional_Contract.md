# 34. Commissioning / Handover / Warranty Functional Contract v1.1

기준일: 2026-10-10
Functional ID: F-07
Domain: D9 Completion / Handover
대상 관리대장: 24 준공·인수·하자
관련 양식: FM-11, FM-23, FM-24, FM-25

## 1. 목적

준공을 단일 완료체크가 아니라 System별 준비·시험·인수·하자 폐쇄형 업무로 관리한다.

> Completion Scope 정의 → Pre-commissioning → Commissioning/Test → Punch → Documentation → Training → Handover Readiness → Owner Acceptance → Warranty → Defect Closeout

핵심 원칙:
1. 시공완료 ≠ Commissioning 완료.
2. Commissioning Pass ≠ Owner Handover.
3. Handover ≠ Warranty 종료.
4. Punch close ≠ 전체 Package close.
5. O&M/As-built/Training 등 문서 Gate를 별도 관리한다.
6. 부분인수와 전체인수를 구분한다.
7. Warranty 시작일은 계약상 Trigger를 따른다.

## 2. Product Objects

기존 WorkItem subtype을 상세화한다.
- CommissioningPackage
- HandoverPackage
- WarrantyClaim

CommissioningPackage 최소:
- packageNo/system/location
- requirementRefs
- prerequisiteInspectionRefs
- precommissioningChecklist
- testProcedureRefs
- testResultRefs
- integratedTestRefs
- punchIssueRefs
- readinessStatus

HandoverPackage 최소:
- handoverNo/scope
- commissioningPackageRefs
- asBuiltRefs
- omManualRefs
- trainingRefs
- sparePartsRefs
- certificates/authority records
- openIssueRefs
- ownerAcceptanceRef
- handoverDate

WarrantyClaim 최소:
- claimNo
- handoverRef
- warrantyPeriodRef
- defectObservedAt
- defectScope
- issueRef/actionRefs
- responseDue
- remedyEvidence
- reinspectionRef
- closureRef

## 3. Commissioning State

planned → prerequisite_review → precommissioning → test_ready → testing → result_review → passed / failed → punch_resolution → ready_for_handover → closed

failed는 원 결과를 보존하고 Retest를 새 기록으로 생성한다.

## 4. Commissioning Gate

- approved/current drawings/specs
- prerequisite inspections passed
- material/equipment readiness
- calibration/current certificates
- test procedure approved
- utilities/temporary conditions available
- safety permit if needed
- test witnesses
- result acceptance criteria
- open blocking issues 없음

## 5. Handover State

draft → completeness_review → technical_readiness → owner_review → accepted_with_reservations / accepted → partial_handover / final_handover → closed

반려/보완은 returned 상태로 되돌린다.

## 6. Handover Readiness

handoverReady=true 최소조건:
- required commissioning packages ready
- statutory/contractual acceptance current
- as-built required set complete
- O&M manuals complete
- training complete
- spare/tool obligations complete
- required certificates complete
- blocking Punch/Issue 없음 또는 approved reservation
- asset/system identity traceable

## 7. Punch / Outstanding Work

- Punch는 Issue subtype Punch 사용
- 중요도/인수영향 구분
- Owner가 조건부 인수한 Punch는 due/owner/closure requirement 유지
- Handover 후에도 미결 Punch는 삭제하지 않는다.

## 8. Partial Handover

부분인수 시 exact scope를 고정한다.
- system/location/asset boundary
- effective date
- accepted documents
- outstanding work
- warranty trigger 여부

부분인수를 전체 프로젝트 인수로 확장 해석하지 않는다.

## 9. Warranty State

WarrantyClaim:
reported → acknowledged → assessment → action_required → remedy_in_progress → reinspection → accepted / rework_required → closed

Contractor는 자기 WarrantyClaim을 최종 close할 수 없다.

## 10. Warranty Gate

- warranty applicability
- handover exact scope
- observation evidence
- cause/impact
- response deadline
- corrective action
- reinspection
- closure evidence

## 11. Owner Reporting

즉시/정기 보고 후보:
- Handover date risk
- major commissioning failure
- statutory acceptance delay
- major outstanding work
- repeated warranty defect
- operational impact
- Owner decision required

## 12. 관리대장 24 Projection

- commissioning readiness by package/system
- test/fail/retest
- open Punch
- documentation completeness
- training/O&M
- handover scope/status/date
- reservations
- warranty period
- open WarrantyClaims
- closeout readiness

## 13. 기존 양식 Mapping

FM-11 완료검수기록: completion/acceptance snapshot
FM-23 준공서류 완성도표: documentation readiness
FM-24 인수인계 확인서: HandoverPackage snapshot
FM-25 미완료·하자 추적표: Punch/Warranty projection

## 14. Validation Scenarios

1. 모든 시험 Pass, O&M 누락 → handoverReady=false
2. 부분인수 A구역 → B구역 상태 변화 없음
3. 조건부 인수 → reservation/Punch 유지
4. Warranty defect 조치완료, 재검측 미완료 → close 불가
5. Retest Pass → 최초 Fail 보존
6. Handover 후 WarrantyClaim 발생 → Handover record immutable

## 15. 완료판정

관리대장 24는 Package별 상태·Gate·부분인수·Warranty closeout까지 정의되었으므로 M3로 평가한다.

## 16. Actor / Decision Right

| 행위 | 기본 Actor | Decision Right |
|---|---|---|
| Commissioning 자료·준비 | CON | 제출/실행 책임 |
| 시험 준비·결과 검토 | SUP | 기술판정 |
| 전문기술 확인 | DES/전문기관 | 지정 Scope에 한함 |
| Handover readiness 판정 | SUP/chief_supervisor | 감리 준비도 판정 |
| 인수 결정 | OWN | 부분/최종 인수 결정 |
| Warranty remedy | CON | 시정 실행 |
| Warranty close | SUP/OWN according to contract | Contractor self-close 금지 |

## 17. Commissioning Command Contract

| From | Command | Actor | To | Gate |
|---|---|---|---|---|
| planned | start_prerequisite_review | SUP | prerequisite_review | package scope/current refs |
| prerequisite_review | start_precommissioning | SUP | precommissioning | prerequisite inspections/materials/documents |
| precommissioning | declare_test_ready | SUP | test_ready | checklist complete |
| test_ready | start_test | SUP/CON | testing | approved procedure, witness/readiness |
| testing | submit_test_result | CON/source | result_review | raw result/evidence |
| result_review | accept_test | SUP | passed | acceptance criteria met |
| result_review | reject_test | SUP | failed | failure reason/evidence |
| failed | require_punch_resolution | SUP | punch_resolution | Issue/Action refs |
| punch_resolution | request_retest | CON | test_ready | correction verified |
| passed | mark_ready_for_handover | SUP | ready_for_handover | package completion gate |
| ready_for_handover | close_commissioning | SUP | closed | snapshot/audit complete |

## 18. Handover Command Contract

| From | Command | Actor | To | Gate |
|---|---|---|---|---|
| draft | submit_handover_package | CON | completeness_review | scope/doc refs |
| completeness_review | return_handover | SUP | returned | missing/invalid items |
| completeness_review | start_readiness_review | SUP | technical_readiness | complete package |
| technical_readiness | submit_owner_review | chief_supervisor | owner_review | handoverReady or explicit reservations |
| owner_review | accept_with_reservations | OWN | accepted_with_reservations | reservation list/owner/due |
| owner_review | accept_handover | OWN | accepted | acceptance evidence |
| accepted/accepted_with_reservations | record_partial_handover | OWN/SUP | partial_handover | exact scope/effective date |
| accepted | record_final_handover | OWN/SUP | final_handover | full scope gate |
| partial_handover/final_handover | close_handover_package | SUP | closed | documents/audit complete |

## 19. Warranty Command Contract

| From | Command | Actor | To | Gate |
|---|---|---|---|---|
| - | report_warranty_defect | OWN/SUP | reported | handover scope + evidence |
| reported | acknowledge_claim | CON | acknowledged | receipt time |
| acknowledged | assess_warranty | SUP | assessment | warranty applicability |
| assessment | require_remedy | SUP | action_required | action owner/due |
| action_required | start_remedy | CON | remedy_in_progress | action accepted |
| remedy_in_progress | submit_remedy | CON | reinspection | remedy evidence |
| reinspection | accept_remedy | SUP | accepted | reinspection pass |
| reinspection | require_rework | SUP | rework_required | failure evidence |
| rework_required | start_remedy | CON | remedy_in_progress | revised action |
| accepted | close_warranty_claim | SUP/OWN | closed | closure evidence/contract gate |

## 20. Exception / SLA

- commissioning test failure → Issue/Action/Retest; original result immutable
- missing statutory acceptance → Handover blocking reason
- reservation due date → overdue/escalation, not automatic rejection
- warranty response/remedy/reinspection due dates → contract-configured
- operational emergency defect → immediate Owner/SUP escalation and separate safety/quality controls

## 21. Completion Criteria

CommissioningPackage: required tests accepted + punch blocking items resolved + exact source snapshot.
HandoverPackage: exact scope accepted + documents/training/spares/certificates complete + reservations tracked.
WarrantyClaim: remedy + reinspection + closure evidence + decision authority complete.

## 22. Backend / UI Handoff

Backend must keep separate objects/states for Commissioning, Handover, Warranty. UI must not collapse `test passed`, `ready for handover`, `owner accepted`, and `warranty closed` into one completion status.


## 23. Reference Lifecycle Amendment v1.1 (PCR-2026-002, C2)

승인: Product/Functional Owner — “제안대로 v1.1에 채택”
적용 예정: 2026-10-10 00:00 +07:00. 검증된 릴리스에 포함되어야 효력이 발생한다.

Exact reference의 정상적인 Issue correction/reinspection 버전 증가로 workflow가 막히면 SUP가 명시적 refresh command를 실행한다. 기존 authority, expectedVersion, exact current version 확인, audit, idempotency 및 모든 readiness/acceptance/closure gate는 유지한다. 자동 refresh는 금지한다. refresh는 기존 Issue identity 집합과 defect identity를 그대로 유지하며 Issue 추가·삭제·대체를 허용하지 않는다. cancelled/superseded Issue는 closure로 인정하지 않는다. 제출 당시 refs와 모든 이전 snapshot은 보존한다.

- Commissioning `mark_ready_for_handover`는 선택적으로 `punchIssueRefs`와 `correctionActionRefs`를 함께 받는다. Punch identity 집합은 기존과 같아야 하고 모든 current-cycle Action은 최신이며 in-scope, verified/closed여야 한다. 두 목록이 없는 기존 no-Punch 요청은 계속 허용한다.
- Handover `refresh_issue_references`는 선택적으로 `currentIssueRefs`를 받는다. 기존 `openIssueRefs`와 identity 집합이 같아야 한다. 서버가 current open/resolved refs를 파생 저장한다. Owner 승인 및 reservation snapshot은 바꾸지 않는다. final handover는 현재 open Issue가 없어야 한다.
- Warranty `refresh_remedy_references`는 `issueRef`와 `actionRefs`를 함께 받아 같은 defect Issue 및 완전한 current correction cycle을 확인한다. `accept_remedy`도 두 refs를 선택적으로 함께 받을 수 있다. Remedy, 재검측 및 Warranty close 조건은 유지한다.

Formal change record는 `app/reference/product_change_record_pcr_2026_002.json`이다. 기존 product-change-record schema와 Project Configuration validator는 변경하지 않는다.
