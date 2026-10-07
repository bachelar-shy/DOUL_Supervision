# 47. Product Baseline v1.0 — Implementation Handoff Backlog

기준일: 2026-10-06
상태: Product / Functional Baseline v1.0 후속 인계기준

## 1. 목적

Product / Functional에서 확정된 의미를 Backend, UI, Platform이 임의 재해석하지 않고 구현할 수 있도록 후속 작업을 분리한다.

업무 Contract 의미 변경이 필요하면 해당 구현축에서 직접 바꾸지 않고 Product / Functional의 Baseline v1.x Change로 되돌린다.

---

## 2. Backend 우선순위

### B-P1. 신규 subtype persistence/API

구현 대상:
- SafetyStopOrder
- Schedule
- DelayEvent
- RecoveryPlan
- ContractBOQ
- QuantityMeasurement
- FireCompliance
- Claim
- EOTRequest
- RegulatoryPermit
- DocumentTransmittal
- PersonnelDeployment
- DailyRecord

Acceptance:
- domain_model / domain_schema enum과 DB/API 표현 일치
- object ID/version/audit/source refs 보존
- physical delete 금지
- stale expectedVersion 거부
- Idempotency-Key 재시도 안정성

### B-P2. Safety workflow

Product 실행계약 Source of Truth:
- `state_machines_v1.json`: `safety_permit`, `safety_stop_order`, `safety_equipment_inspection`
- `authority_matrix_v1.json`: `safety.*` 정책
- `domain_schemas_v2.json`: Safety typed data / readiness / resume gate
- `safety_execution_contract_v1.json`: server-derived fields / server timestamps / atomic `issue_stop` / resume sequencing

Backend 구현:
- 위 command/state/guard를 저장·API·트랜잭션으로 소비
- `workAuthorized` / `equipmentAvailable` 서버 계산
- Stop 발행 시 affected Permit linkage·suspend·`workAuthorized=false`를 **하나의 원자적 transaction**으로 반영하고 부분실패 시 rollback
- Equipment Readiness와 Resume Gate 검증
- SYSTEM 만료는 파생처리만 수행하고 사람의 승인·Stop Lift 권한을 대체하지 않음

Acceptance:
- Issue close가 Stop lift를 자동발생시키지 않음
- Permit 승인만으로 workAuthorized=true가 되지 않음
- CON self-resume 불가

### B-P3. Schedule / Delay / Recovery

Product 실행계약 Source of Truth:
- `state_machines_v1.json`: `schedule_baseline`, `schedule_progress`, `delay_event`, `recovery_plan`
- `authority_matrix_v1.json`: `schedule.*` 정책
- `domain_schemas_v2.json`: Schedule/Activity/Delay/Impact/Recovery typed data
- `schedule_execution_contract_v1.json`: Baseline/Progress/Delay/Recovery cross-object invariants

Backend 구현:
- Schedule immutable version/snapshot + source file/hash 보존
- Data Date와 frozen Progress correction chain
- Baseline activation 시 기존 effective Baseline을 원자적으로 supersede
- DelayEvent state/command + factual impact analysis
- RecoveryPlan state/command + effectiveness tracking
- Baseline/Forecast 분리
- `schedule_source_import_contract_v1.json` Product 보완계약 병합 후 원본 Schedule + Activity package의 입력/조회 경로 구현
- 보존된 정규화 JSON 원본 bytes/hash와 요청 내용 확인; Activity 관계/원본 참조는 서버 생성
- 전체 package·Audit·Idempotency 원자적 저장, 최초 원본 version 보존, 부분실패 rollback
- F-08 EOT/Claim/Notice는 refs로 연결하되 Schedule에서 entitlement를 판정하지 않음

Acceptance:
- Progress Update가 Baseline을 덮어쓰지 않음
- 과거 frozen Progress Snapshot 직접 수정 금지
- Data Date 역행 금지; 동일 Data Date 정정은 reason + new record 필요
- DelayEvent가 EOT를 자동승인하지 않음
- Recovery 승인/실행이 Baseline revision·EOT·Cost 승인으로 해석되지 않음
- Activity 100%가 Inspection/Handover 상태를 변경하지 않음

### B-P4. Measurement / Payment

Product 실행계약:
- `state_machines_v1.json`: `contract_boq`, `quantity_measurement`, `payment_claim`
- `authority_matrix_v1.json`: `payment.*` 공식 인간권한
- `domain_schemas_v2.json`: `ContractBOQData`, `QuantityMeasurementData`, `PaymentClaimData` 및 canonical Decimal string
- `measurement_payment_execution_contract_v1.json`: BOQ version / 물량검증 / 지급적격 / 누계 / 중복청구 / 지급기록 불변조건
- 관리대장 17: read-only Projection, raw status patch 금지

Backend 구현:
- ContractBOQ exact version과 effective/superseded history를 보존하고 과거 기성을 최신 BOQ로 재계산하지 않음
- QuantityMeasurement는 claimed와 verified를 분리하고, 수량 검증과 지급적격을 별도 판정
- PaymentClaim은 claimed / verified / recommended / ownerApproved / paid 금액을 각각 보존
- 통화·단가·금액·정밀수량은 canonical Decimal string으로 계산하고 binary floating-point를 공식값으로 사용하지 않음
- 동일 QuantityMeasurement의 활성 PaymentClaim 중복청구 차단
- 미승인 Variation은 청구내역에 보존하되 기본 지급추천액에서 제외
- previous PaymentClaim exact ref를 기준으로 cumulative certified / paid를 재조정
- Owner Decision은 exact current PaymentClaim version을 대상으로 함
- 지급추천은 exact `calculationRuleRef`의 Formula/Deduction/Rounding Rule로 서버 재계산하고 Deduction Line 합계와 Aggregate 필드를 reconcile
- 부분지급은 Owner Approved 금액을 변경하지 않고 append-only `paymentRecords[]`로 지급건별 보존; `paidAmount/cumulativePaidAmount`는 유효 지급기록에서 파생
- 지급 Reference/외부시스템 Reference 재사용 차단; 정정·취소는 원기록 삭제 없이 supersede trace로 연결
- 실제 지급은 외부 payment reference/evidence를 기록하며 은행 지급기능으로 해석하지 않음

Acceptance:
- Schedule Progress ≠ QuantityMeasurement
- Inspection pass ≠ Payment approval
- claimed quantity ≠ verified quantity
- verified Measurement라도 지급 Gate 미충족 시 `paymentEligible=false` 유지
- claimed / verified / recommended / ownerApproved / paid 분리
- unapproved Variation 기본 지급추천 제외
- 동일 측정량 중복 기성청구 차단
- 잘못된 추천금액·Deduction 불일치·Rounding 불일치 시 Recommendation 전이 차단
- 부분지급 후 모든 Actual Payment Record 조회 가능하고 누계가 그 기록에서 재현됨
- 지급 Reference 중복 차단 및 correction/cancellation supersede trace 보존
- 부분지급 후 unpaid balance 0 이전에는 PaymentClaim close 금지
- 관리대장 17에서 직접 상태수정 금지

### B-P5. Compliance / Permit

구현:
- FireCompliance
- EnvironmentalControl lifecycle
- RegulatoryPermit lifecycle
- statutory original source refs

Acceptance:
- submission ≠ approval
- expiry/change impact reevaluation
- 법정 원본과 DOUL Snapshot 분리

### B-P6. Completion / Warranty

구현:
- CommissioningPackage
- HandoverPackage
- WarrantyClaim
- partial handover exact scope

Acceptance:
- test pass ≠ handover
- handover ≠ warranty close

### B-P7. Contract Notice / Claim / EOT

Product 실행계약:
- `state_machines_v1.json`: `contract_notice`, `claim`, `eot_request`
- `authority_matrix_v1.json`: `contract.*` 공식 인간권한
- `domain_schemas_v2.json`: `ContractNoticeData`, `ClaimData`, `EOTRequestData`
- `contract_notice_claim_eot_execution_contract_v1.json`: Notice/Claim/EOT 및 F-04 Baseline 연결 불변조건
- 관리대장 26: raw status patch 금지, F-08 domain command projection

Backend 구현:
- Notice deadline은 versioned Contract Requirement를 기준으로 계산하되 시스템 계산은 advisory로만 취급
- 공식 `noticeDueAt`은 인간 권한으로 확인하며 기한 초과는 `timeBarRisk` 병렬 표시만 생성
- Claim 원 청구액/근거와 assessed/approved 결과를 별도 필드·버전으로 보존
- EOT는 exact DelayEvent + submitted Notice + effective Baseline + impact refs가 있어야 제출 가능
- Owner Decision은 exact current Claim/EOT version을 대상으로 해야 하며 승인/부분승인/거절/분쟁을 명시적 command로 기록
- 승인/부분승인 EOT만 Baseline revision 요청 가능
- Baseline revision 요청 시 서버가 승인 당시 EOT의 exact historical version을 `baselineRevisionBasisRef`로 보존
- 새 F-04 Baseline이 그 exact EOT version을 `revisionBasisRef`로 참조하고 effective가 된 뒤 EOT close
- 기존 effective Baseline 직접 수정 금지
- F-04/F-05 source refs 및 Audit/Idempotency/expectedVersion 적용

Acceptance:
- DelayEvent 단독으로 EOT 제출/승인 불가
- Notice 제출 ≠ Claim 인정
- deadline overrun = risk flag, 자동 권리상실 판정 금지
- SUP 기술검토 ≠ Owner 계약결정
- EOT 승인 ≠ Cost Claim 승인
- 승인 EOT exact version 없이 Baseline revision 불가
- EOT decision 자체가 기존 Baseline을 변경하지 않음
- 부분승인 Claim은 원 청구액을 보존하고 승인액/분쟁잔액을 별도 기록

### B-P8. Supporting workflows

구현:
- SiteInstruction
- Risk / ComplianceAudit
- InsuranceGuarantee
- Lesson
- DocumentTransmittal
- PersonnelDeployment
- Drawing Field Release / Distribution readiness
- DailyRecord freeze/revision

---

## 3. UI 우선순위

### U-P1. 공통 상태표현 규칙

절대 하나로 합치지 않을 상태:
- Submitted / Received / Approved
- Approved / Released / Current
- Inspection Pass / Next-work Released
- Issue Closed / Owner Report Closed
- Permit Authorized / Work Authorized / Stop
- Baseline / Forecast
- Claimed / Verified / Recommended / Owner Approved / Paid
- Test Passed / Handover Ready / Owner Accepted

### U-P2. Role Workspaces

SUP:
- Review Queue
- Field Verification
- Safety/Stop/Resume
- Delay/Recovery
- Payment Review
- Compliance
- Completion/Handover
- Owner Report

CON:
- Submissions
- Permit requests
- Inspection/reinspection
- corrective actions
- schedule updates
- measurement/payment claims
- commissioning/handover submissions

OWN:
- Report receipt
- Decision Queue
- commercial/time decisions
- handover acceptance
- follow-up closure

### U-P3. Register Surfaces

29개 대장은 Projection 화면으로 구현한다.
대장에서 독립적인 상태 patch를 허용하지 않고 해당 Domain command 화면으로 이동한다.

### U-P4. 36 Forms

- reviewed Projection DTO 기반 Preview/Generate
- sourceDomainRefs + sourceVersion 표시
- 법정 원본과 DOUL 내부양식 시각구분
- generated snapshot 재렌더링 불변성

---

## 4. Platform 우선순위

Platform은 업무 의미를 변경하지 않는다.

필요 지원:
- immutable/retained object storage
- upload integrity/hash
- background worker/queue infrastructure
- notification delivery infrastructure
- audit/log retention
- backup/restore
- document generation runtime
- observability for command failure / worker retry
- environment-specific secret/config
- clock/timezone consistency for due/notice calculations

Platform failure가 Domain 결과를 임의 성공으로 만들지 않는다.

---

## 5. Cross-workstream Integration Gates

### Gate 1 — Contract Consumption

Backend/UI가 사용하는 subtype/status/command 이름은 Product Baseline exact version과 연결한다.

### Gate 2 — Generated Contract

OpenAPI / TypeScript / web register catalog가 source contract와 current여야 한다.

### Gate 3 — Authority

새 화면/API가 기존 authority_matrix보다 넓은 권한을 암묵적으로 허용하지 않는다.

### Gate 4 — Evidence / Version

공식 판정과 출력물은 source object ID/version/evidence를 재현할 수 있어야 한다.

### Gate 5 — End-to-End

최소 Pilot E2E:
1. Quality fail → Issue → correction → reinspection → close → Owner follow-up
2. Safety permit → Stop → correction → explicit resume
3. Schedule delay → Recovery → EOT decision → Baseline revision
4. Quantity measurement → Payment recommendation → Owner approval → payment record
5. Commissioning → Handover → Warranty defect → close

---

## 6. Product Change Control

상세 변경관리 계약은 `48_Product_Baseline_Change_Control_v1.md`와 `app/schema/product_change_record_contract_v1.json`을 따른다. 구현 중 다음이 발견되면 Product Baseline v1.x 변경요청으로 전환한다.

- 새 Actor/Decision Right 필요
- 새로운 official state 필요
- 기존 Gate의 의미변경
- 권한충돌
- 새 legal/contract interpretation
- 기존 Completion Criteria로 닫히지 않는 정상업무 Case
- Owner Reporting Trigger 누락
- Evidence/version traceability 불가능

단순 UI 배치, 내부 코드구조, infrastructure 선택은 Product Contract 변경이 아니다.

---

## 7. 인계 완료조건

Product / Functional 인계는 다음이 충족되면 완료다.

- Baseline v1.0 Validation PASS
- 28 M3 + 1 Reference
- 36 DOUL internal form contracts aligned
- OpenAPI / TypeScript / register catalog current
- Role E2E journeys documented
- Implementation Acceptance Scenario catalog established (`49_Implementation_Acceptance_Scenarios_v1.md`)
- Project Configuration Pack contract established (`50_Project_Configuration_Pack_v1.md`)
- Owner Reporting Trigger Matrix established (`51_Owner_Reporting_Trigger_Matrix_v1.md`)
- Media operations policy gaps resolved without rewriting the analysis contract (`52_Media_Analysis_Operations_Policy_v1.md`)
- Field Pilot acceptance plan established (`53_Field_Pilot_Acceptance_Plan_v1.md`)
- Implementation progress tracked by evidence stages, not percentages (`54_Implementation_Progress_Stage_Ledger_v1.md`)
- Backend/UI/Platform backlog separated
- Business semantic changes routed back to Product

이 문서를 기준으로 Product / Functional은 v1.0 설계를 완료하고 구현축으로 인계한다.
