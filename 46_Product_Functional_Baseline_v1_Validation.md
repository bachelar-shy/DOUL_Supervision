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


### 11.1 2026-10-06 검증 결과

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

## 12. 다음 단계

Baseline v1.0 이후는 Product 의미를 임의 확장하지 않고 다음 원칙으로 진행한다.
1. Baseline v1.x 변경관리는 계속 유지한다 (`48_Product_Baseline_Change_Control_v1.md`).
2. `47_Product_Implementation_Handoff_Backlog_v1.md`의 Backend/UI 구현과 Project Configuration Pack을 병렬로 진행한다 (`50_Project_Configuration_Pack_v1.md`).
3. 업무 API/UI가 나오는 단위마다 동일한 인수사례를 누적한다 (`49_Implementation_Acceptance_Scenarios_v1.md`).
4. 진척도는 `contract_confirmed → backend_api_implemented → ui_connected → integration_passed → pilot_verified`로 기록한다 (`54_Implementation_Progress_Stage_Ledger_v1.md`).
5. 시범운영은 `53_Field_Pilot_Acceptance_Plan_v1.md`의 착수·완료 Gate를 따른다.
