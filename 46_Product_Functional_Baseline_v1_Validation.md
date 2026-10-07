# 46. Product / Functional Baseline v1.0 Validation

기준일: 2026-10-06
상태: PASS — Product / Functional Baseline v1.0

## 1. 목적

29개 관리대장, 핵심 Domain Objects, 역할, 상태, 권한, Evidence, Owner Governance가 하나의 일관된 Product Contract인지 검증한다.

## 2. Completion Target

- 관리대장 28개: M3
- 관리대장 02 계약·업무범위: R(의도적 Reference)
- R은 미완성이 아니라 기준정보 Source-of-Truth이며 별도 Workflow가 불필요하다는 설계결정이다.

## 3. Global Invariants

1. 제출 ≠ 승인
2. 수령/열람 ≠ 승인
3. Inspection Pass ≠ Next-work Release
4. Issue action complete ≠ Issue close
5. Issue close ≠ Owner Report close
6. AI result ≠ official judgment
7. RFI answer ≠ Change approval
8. Forecast ≠ Baseline
9. DelayEvent ≠ EOT entitlement
10. Payment recommendation ≠ Owner approval ≠ Paid
11. Permit approval ≠ workAuthorized
12. Safety Issue close ≠ Stop lift
13. Commissioning pass ≠ Handover
14. Handover ≠ Warranty close
15. Notification ≠ official DocumentTransmittal
16. Drawing approval ≠ Field Release
17. Lesson adopted ≠ Standard revision complete
18. Audit action complete ≠ independent verification

## 4. Authority Checks

- CON cannot close official Issue.
- ADM has no technical decision authority.
- AI/SYSTEM/INTEGRATION cannot exercise human approval.
- SUP authority requires RoleAssignment/Qualification/scope.
- Owner commercial/contract decisions are separate from SUP technical review.
- Contractor cannot self-resume after SUP Stop Order.

## 5. Version / Evidence Checks

- official decisions target exact version.
- original Evidence is immutable.
- snapshots preserve source IDs/versions.
- superseded records are retained.
- offline stale write cannot silently overwrite current version.
- generated forms are snapshots, not independent workflow sources.

## 6. Closed-loop Checks

Quality, Safety, Owner Reporting, Schedule, Payment, Compliance, Handover, Audit, Lesson workflows all require explicit completion and failure/rework paths.

## 7. Register Coverage

01 Permit M3
02 Contract Scope R
03 Personnel M3
04 Drawing M3
05 Transmittal M3
06 Submission M3
07 Shop Drawing M3
08 Material Approval M3
09 Receiving M3
10 Test M3
11 Inspection M3
12 NCR/Issue M3
13 RFI M3
14 Change M3
15 Site Instruction M3
16 Schedule M3
17 Payment M3
18 Safety Permit M3
19 Safety Equipment M3
20 Fire M3
21 Environment M3
22 Owner Governance M3
23 Daily Record/Evidence M3
24 Handover/Warranty M3
25 Risk M3
26 Notice/Claim/EOT M3
27 Insurance/Guarantee M3
28 Audit M3
29 Lesson M3

## 8. Backend Handoff

Backend 구현 전 최소 확인:
- subtype enum synchronized
- state/command semantics preserved
- expectedVersion + Idempotency-Key on commands
- actor policy checks
- audit events
- source version links
- no physical delete of official record

## 9. UI Handoff

UI는 상태를 합쳐 보이지 않는다.
예:
- Approved / Released / Current
- Claimed / Verified / Recommended / Approved / Paid
- Permit / Work Authorized / Stop
- Issue Closed / Owner Report Closed

## 10. Forms

DOUL A4 forms are generated snapshots from reviewed Projection DTOs.
법정 원본서식은 DOUL 양식으로 대체하지 않는다.

## 11. Final Gate

Baseline v1.0은 다음 항목을 모두 검증해 PASS로 확정한다.
- schema/contract validator
- generated OpenAPI current
- generated TypeScript current
- web register catalog current
- Core tests
- HTTP/Application tests
- git diff --check
- 29-register maturity table consistent
- form catalog/data/binding/template consistent
- role journey invariants consistent


### 11.1 2026-10-06 최초 Baseline 검증 결과 (historical)

- Contract validator: PASS — 10 machines / 98 transitions / 51 policies / 29 registers / 36 forms / 124 API operations
- OpenAPI generation: current
- TypeScript declarations: current
- Web register catalog: current
- Core tests: 108 PASS
- HTTP/Application tests: 66 PASS
- git diff --check: PASS
- Register maturity: 28 M3 + 1 Reference
- Form catalog/data/binding/template: 36/36/36/36 일치
- WorkItem / InformationItem subtype declarations: domain model과 schema enum 일치

따라서 Product / Functional Baseline v1.0 검증결과는 **PASS**다.

### 11.2 구현 인계 운영계약 검증

- Project Configuration / Product Change example validation: PASS
- Product configuration authority widening tests: PASS
- Owner Reporting F-01~F-17 Trigger catalog: PASS
- Media operations contract: v1.3, 기존 분석판정 의미 유지
- Core tests: 114 PASS
- HTTP/Application tests: 72 run — 69 PASS, 3 PostgreSQL live-integration tests skipped locally when DSN is absent
- OpenAPI / TypeScript / Web register catalog: current
- `git diff --check`: PASS

이 검증은 Baseline v1.0의 업무 의미를 재정의하지 않고 구현 인계·설정·인수·운영정책을 보완한 결과다.

### 11.3 F-03 Safety 실행계약 승격 검증

`30_Safety_Permit_Stop_Resume_Functional_Contract.md`의 상세정의를 실행 가능한 Product Contract로 승격했다.

- Safety typed data: `SafetyPermitData`, `SafetyStopOrderData`, `SafetyEquipmentInspectionData`, `SafetyReadiness`, `SafetyResumeGate`
- State Machine: `safety_permit`, `safety_stop_order`, `safety_equipment_inspection`
- Authority: `safety.*` 31개 정책 추가, `safety.stop_lift`는 SUP `chief_supervisor` 공식권한
- SYSTEM은 Permit/Equipment 만료의 `official=false` 파생전이만 수행하며 Permit 승인·Resume 승인·Stop Lift 권한 없음
- 관리대장 18·19: Safety domain command projection 적용, 19번을 actionable로 승격
- `workAuthorized` / `equipmentAvailable`: client 입력이 아닌 서버 파생값
- Contract validator: PASS — 13 machines / 164 transitions / 82 policies / 29 registers / 36 forms / 169 API operations
- OpenAPI / TypeScript / Web register catalog: current
- Core tests: 141 PASS
- HTTP/Application tests: 83 run — 80 PASS, 3 PostgreSQL live-integration tests skipped locally when DSN is absent
- `git diff --check`: PASS

이 변경은 F-03의 업무 의미를 새로 만드는 것이 아니라 이미 확정된 Safety 상세정의를 State/Authority/Schema/API 실행계약으로 구조화한 것이다. Backend는 이 계약을 소비하며 별도 상태·권한 의미를 재정의하지 않는다.

### 11.4 F-04 Schedule 실행계약 승격 검증

`31_Schedule_Delay_Recovery_Functional_Contract.md`의 상세정의를 실행 가능한 Product Contract로 구조화했다.

- Typed data: Schedule / ScheduleActivity / DelayEvent / DelayImpactAnalysis / RecoveryPlan
- State Machine: `schedule_baseline`, `schedule_progress`, `delay_event`, `recovery_plan`
- Authority: `schedule.*` 정책
- Baseline: exact approved version만 effective, 이전 effective Baseline은 삭제 없이 superseded
- Progress: frozen Snapshot 불변, 정정은 새 record + reason + supersedes chain
- Data Date: 역행 금지, 동일 Data Date는 explicit correction만 허용
- Forecast는 Baseline을 변경하지 않음
- Delay Event는 사실/영향 기록이며 EOT entitlement 판정이 아님
- Recovery acceptance/execution은 Baseline revision·EOT·Cost 승인이 아님
- Schedule Activity 100%는 Inspection/Handover 상태를 변경하지 않음
- Contract validator: PASS — 17 machines / 224 transitions / 112 policies / 29 registers / 36 forms / 218 API operations
- Schedule execution contract tests: 10 PASS
- Core tests: 156 PASS
- HTTP/Application tests: 174 run — 171 PASS, 3 PostgreSQL live-integration tests skipped locally when DSN is absent
- OpenAPI / TypeScript / Web register catalog: current
- `git diff --check`: PASS

이 변경은 F-04의 업무 의미를 새로 만드는 것이 아니라 이미 확정된 Schedule/Delay/Recovery 상세정의를 State/Authority/Schema/API 실행계약으로 구조화한 것이다. Backend B-P3 구현 인수 전까지 F-04 진척단계는 `contract_confirmed`로 유지한다.

### 11.5 F-08 Contract Notice / Claim / EOT 실행계약 승격 검증

`35_Contract_Notice_Claim_EOT_Functional_Contract.md`의 상세정의를 실행 가능한 Product Contract로 구조화했다.

- Typed data: `ContractNoticeData`, `ClaimData`, `EOTRequestData`
- State Machine: `contract_notice`, `claim`, `eot_request`
- Authority: `contract.*` 24개 공식 인간권한; AI/SYSTEM/INTEGRATION의 계약결정 권한 없음
- Notice: 공식 기한은 인간 확인, 기한 초과는 `timeBarRisk` 병렬 표시이며 자동 권리상실 판정이 아님
- Claim: 원 청구액/근거와 assessed/approved 결과를 분리하고 승인·부분승인·거절·분쟁을 명시적 Owner command로 기록
- EOT 제출: exact DelayEvent + submitted Notice + effective Baseline + impact refs + claimed days가 모두 필요
- EOT 결정: SUP 기술검토와 OWN 계약결정을 분리하고 exact current EOT version을 대상으로 함
- Baseline bridge: 승인/부분승인 EOT만 revision 요청 가능하며 승인 당시 EOT exact historical version을 `baselineRevisionBasisRef`로 서버 보존
- 새 F-04 Baseline은 해당 exact EOT version을 `revisionBasisRef`로 참조하고 effective가 된 뒤에만 EOT close 가능
- EOT command는 기존 effective Baseline을 직접 수정하지 않음
- 관리대장 26: raw status patch 없이 F-08 domain command projection 적용
- Contract validator: PASS — 20 machines / 269 transitions / 136 policies / 29 registers / 36 forms / 260 API operations
- F-08 execution contract tests: 9 PASS
- Core tests: 171 PASS
- HTTP/Application tests: 234 run — 204 PASS, 30 optional-integration tests skipped in local environment
- OpenAPI / TypeScript / Web register catalog: current
- `git diff --check`: PASS

이 변경은 F-08의 업무 의미를 새로 만드는 것이 아니라 이미 확정된 Notice/Claim/EOT 상세정의를 State/Authority/Schema/API 실행계약으로 구조화한 것이다. Backend B-P7 구현 인수 전까지 F-08 진척단계는 `contract_confirmed`로 유지한다.

## 12. 다음 단계

Baseline v1.0 이후는 Product 의미를 임의 확장하지 않고 다음 원칙으로 진행한다.
1. Baseline v1.x 변경관리는 계속 유지한다 (`48_Product_Baseline_Change_Control_v1.md`).
2. `47_Product_Implementation_Handoff_Backlog_v1.md`의 Backend/UI 구현과 Project Configuration Pack을 병렬로 진행한다 (`50_Project_Configuration_Pack_v1.md`).
3. 업무 API/UI가 나오는 단위마다 동일한 인수사례를 누적한다 (`49_Implementation_Acceptance_Scenarios_v1.md`).
4. 진척도는 `contract_confirmed → backend_api_implemented → ui_connected → integration_passed → pilot_verified`로 기록한다 (`54_Implementation_Progress_Stage_Ledger_v1.md`).
5. 시범운영은 `53_Field_Pilot_Acceptance_Plan_v1.md`의 착수·완료 Gate를 따른다.
