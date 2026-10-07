# 32. Progress Measurement / Payment Functional Contract v1.0

기준일: 2026-10-06
문서상태: Product / Functional 상세계약 v1.0
Functional ID: F-05
Functional Domain: D6 Schedule / Commercial / Contract
대상 관리대장: 17 물량·기성
관련 양식: FM-26 물량·기성 검토·추천서
연계: Inspection / Material / Test / Change / Variation / Owner Decision / Contract Notice

---

## 1. 목적

물량·기성을 단순 금액입력이나 공정률 복사로 처리하지 않고 다음의 폐쇄형 업무로 관리한다.

> Contract BOQ 기준확정 → 시공물량 측정 → 검수·시험·변경 적격성 확인 → 기성신청 → 수량검증 → 금액평가 → 감리 추천 → 발주처 승인/조정 → 실제 지급기록 → 누계조정·종결

핵심 원칙:

1. 공정률과 기성물량은 동일하지 않다.
2. 시공사가 청구한 수량과 감리가 검증한 수량은 분리한다.
3. 감리 수량확인과 감리 지급추천은 동일하지 않다.
4. 감리 지급추천과 발주처 지급승인은 동일하지 않다.
5. 발주처 지급승인과 실제 지급은 동일하지 않다.
6. Inspection Pass는 지급적격성의 한 조건일 수 있으나 자동 기성승인이 아니다.
7. Schedule Activity 100%는 기성 100%를 의미하지 않는다.
8. 미승인 Variation 물량을 승인 BOQ 물량처럼 합산하지 않는다.
9. 지급보류·Retention·선급금 상계·기타 공제는 계약조건과 승인된 계산규칙을 따른다.
10. 금액·단가·정밀수량은 부동소수점 오차를 피하기 위해 API에서 Decimal 문자열과 단위를 함께 보존한다.
11. 세금·통화·환율·지급절차는 프로젝트 계약·발주처 회계체계를 우선하며 감리앱이 임의 확정하지 않는다.
12. 실제 은행지급 기능이 없는 경우 앱은 지급사실과 외부 Reference만 기록한다.

---

## 2. Product Object Model

### 2.1 InformationItem / ContractBOQ

F-05는 다음 InformationItem subtype을 도입한다.

> InformationItem / ContractBOQ

ContractBOQ는 계약상 수량·단가·금액 기준의 정확한 버전이다.

최소 데이터:

- boqNo
- revision
- currency
- contractRef
- effectiveFrom
- sourceFileRefs
- lineItems
- provisionalSumRules
- measurementRulesRef
- roundingRule
- supersedesRef
- approvedAt

BOQ Line 최소 데이터:

- boqItemId
- itemNo
- description
- unit
- contractQuantity
- unitRate
- contractAmount
- packageId
- discipline
- locationScope
- measurementRuleRef
- variationEligible
- provisional

### 2.2 WorkItem / QuantityMeasurement

F-05는 다음 WorkItem subtype을 도입한다.

> WorkItem / QuantityMeasurement

QuantityMeasurement는 특정 기간·위치·BOQ 항목에 대해 실제 시공량을 측정하고 감리가 검증하는 Case다.

최소 데이터:

- measurementNo
- periodStart
- periodEnd
- measuredAt
- boqRef
- boqItemRef
- packageId
- locationId
- discipline
- claimedQuantity
- verifiedQuantity
- unit
- measurementMethod
- drawingRefs
- inspectionRefs
- testRefs
- materialLotRefs
- evidenceIds
- changeRefs
- variationRefs
- previousCertifiedQuantity
- cumulativeVerifiedQuantity
- eligibilityStatus
- blockedReasons

### 2.3 WorkItem / PaymentClaim

기존 PaymentClaim은 기성신청에서 실제 지급기록까지 이어지는 Commercial Case다.

최소 데이터:

- paymentClaimNo
- periodStart
- periodEnd
- contractRef
- boqRef
- currency
- submittedAt
- quantityMeasurementRefs
- claimedGrossAmount
- verifiedGrossAmount
- eligibleVariationAmount
- eligibleMaterialOnSiteAmount
- retentionAmount
- advanceRecoveryAmount
- otherDeductionAmount
- taxAmount
- recommendedNetAmount
- ownerApprovedAmount
- paidAmount
- paymentReference
- paidAt
- disputedAmount
- blockedReasons
- recommendationRef
- approvalRef
- decisionRefs
- evidenceIds

---

## 3. Decimal / Currency Contract

금액·단가·수량은 API에서 임의 binary floating-point 계산을 기준으로 하지 않는다.

기본 표현:

decimal value: string
currency: ISO 4217 code 또는 프로젝트 승인 통화코드
unit: 프로젝트 승인 Unit Code

예:

unitRate = "1250000.00"
verifiedQuantity = "12.375"
currency = "VND"
unit = "m3"

규칙:

- Decimal 문자열은 정규화된 숫자형 문자열이다.
- 소수자리 제한은 Quantity/Rate/Currency별 프로젝트 설정을 따른다.
- 중간 계산값을 조기 반올림하지 않는다.
- 최종 반올림 지점과 규칙을 Audit한다.
- 원본 Claim 값과 감리 조정값을 각각 보존한다.
- 통화가 다른 금액을 환율기준 없이 직접 합산하지 않는다.
- 환율이 적용되면 rate, source, effective date를 함께 보존한다.

---

## 4. Contract BOQ Baseline

기성은 반드시 특정 ContractBOQ version을 기준으로 한다.

BOQ 변경 사유 예:

- 승인된 Variation
- 계약 Amendment
- 발주처 승인된 신규단가
- 정정된 계약수량
- Provisional Sum 정산

새 BOQ version이 승인되어도 이전 기성 Snapshot은 과거 BOQ version을 그대로 참조한다.

현재 BOQ로 과거 Payment Claim을 재계산하지 않는다.

---

## 5. Quantity Measurement State

Product 상태:

| 상태 | 의미 |
|---|---|
| draft | 측정자료 작성 중 |
| submitted | 시공사 제출 |
| completeness_review | 근거자료 확인 |
| field_verification | 현장수량 확인 |
| technical_verification | 도면·검수·시험·변경 정합 확인 |
| adjustment_required | 수량/근거 조정 필요 |
| verified | 감리 검증 완료 |
| disputed | 시공사와 수량 이견 |
| superseded | 정정 Measurement로 대체 |
| cancelled | 오등록/중복 취소 |

---

## 6. Quantity Measurement Command

| From | Command | Actor | To | 핵심 Gate |
|---|---|---|---|---|
| draft | submit_measurement | CON | submitted | BOQ item·기간·근거 |
| submitted | receive_measurement | SUP | completeness_review | 공식 접수 |
| completeness_review | return_incomplete | SUP | adjustment_required | 누락사유 |
| completeness_review | start_field_verification | SUP | field_verification | 현장확인 가능 |
| field_verification | start_technical_verification | SUP | technical_verification | 수량측정 완료 |
| technical_verification | request_adjustment | SUP | adjustment_required | 조정사유 |
| adjustment_required | resubmit_measurement | CON | submitted | 수정본 |
| technical_verification | verify_quantity | SUP | verified | Eligibility Gate |
| technical_verification | mark_disputed | SUP | disputed | 이견수량 명시 |
| disputed | resolve_measurement | 권한자/협의 | verified | 합의·결정근거 |

검증수량은 원 청구수량을 덮어쓰지 않는다.

---

## 7. Measurement Basis

물량검증은 계약상 Measurement Rule과 승인된 도면·현장상태를 기준으로 한다.

가능한 근거:

- Contract BOQ / Measurement Rule
- 승인도면
- 승인 Shop Drawing
- As-built 측정
- Inspection Record
- Test Result
- Material Delivery / Material Lot
- Survey Record
- Daily Record
- Photo / Video Evidence
- Change / Variation Approval

단순 Schedule Progress %를 수량으로 환산하지 않는다.

---

## 8. Payment Eligibility Gate

paymentEligible = true의 기본조건:

- QuantityMeasurement verified
- exact ContractBOQ version 존재
- BOQ Item 또는 승인 Variation에 매핑
- 적용 Inspection 요건 충족
- 적용 Test 요건 충족
- 필요한 Material Approval/Receiving 요건 충족
- Blocking NCR/Issue 없음
- 중복기성 아님
- 이전 누계와 논리적으로 정합
- 계약상 해당기간 지급가능 항목
- 필요한 Change/Variation 승인 상태 충족

프로젝트 계약이 특정 공종의 부분지급·자재현장반입 지급을 허용하면 별도 Rule을 설정한다.

---

## 9. Blocking Reasons

최소 사유:

- QUANTITY_NOT_VERIFIED
- INSPECTION_NOT_ACCEPTED
- TEST_PENDING
- TEST_FAILED
- MATERIAL_NOT_ACCEPTED
- BLOCKING_NCR
- DUPLICATE_CLAIM
- BOQ_ITEM_NOT_FOUND
- BOQ_VERSION_STALE
- UNAPPROVED_VARIATION
- EXCEEDS_CONTRACT_QUANTITY
- EVIDENCE_INCOMPLETE
- UNIT_MISMATCH
- CONTRACT_RULE_NOT_MET
- DISPUTED_QUANTITY

Blocked Item은 삭제하지 않고 Claim에서 금액을 분리한다.

---

## 10. Contract Quantity 초과

누계 검증수량이 Contract Quantity를 초과하면 자동 승인하지 않는다.

처리:

1. 초과량 식별
2. Measurement Rule 확인
3. Re-measurement Contract 여부 확인
4. 승인 Variation/Change 확인
5. 신규단가 또는 기존단가 적용조건 확인
6. 필요 시 Owner Decision / Contract Track 연결
7. 승인된 근거 없이는 지급추천에서 제외

BOQ 수량 초과 자체가 항상 Variation이라는 뜻은 아니다. 계약형식에 따라 판단한다.

---

## 11. Variation Quantity

Variation은 다음 상태를 구분한다.

- proposed
- technically_verified
- commercially_assessed
- owner_decision_pending
- approved
- rejected
- disputed

기성신청에 Variation 물량이 포함될 수 있으나 approved가 아닌 항목은 기본적으로 Contract Amount와 분리하여 표시한다.

프로젝트 계약이 Interim Payment에서 provisional certification을 허용하는 경우만 별도 승인규칙을 적용한다.

---

## 12. Material on Site

현장반입자재 지급은 계약이 허용하는 경우에만 처리한다.

필요조건 예:

- Material Approval 유효
- Material Lot 식별
- Receiving Inspection 합격
- 보관상태 적합
- 소유권/보험/위험부담 조건 충족
- 중복청구 방지
- 이미 설치수량으로 기성된 항목과 이중계상 없음
- 계약상 지급비율 적용

자재 반입검사 합격만으로 자동 지급대상으로 만들지 않는다.

---

## 13. Payment Claim State

Product 상태:

| 상태 | 의미 |
|---|---|
| draft | 시공사 작성 |
| submitted | 공식 기성신청 |
| completeness_review | 제출완전성 확인 |
| quantity_review | 물량검증 |
| valuation_review | 단가·Variation·공제 평가 |
| adjustment_required | 보완/조정 필요 |
| recommendation_pending | 감리 최종추천 준비 |
| recommended | 감리 지급추천 발행 |
| owner_review | 발주처 검토 |
| owner_approved | 발주처 지급승인 |
| owner_adjusted | 발주처 조정승인 |
| rejected | 지급거절 |
| payment_recorded | 실제 지급사실 기록 |
| closed | 누계·후속사항 정리 |
| withdrawn | 시공사 철회 |
| superseded | 정정 Claim으로 대체 |

---

## 14. Payment Claim Command

| From | Command | Actor | To | 핵심 Gate |
|---|---|---|---|---|
| draft | submit_payment_claim | CON | submitted | 기간·BOQ·Line Items |
| submitted | receive_payment_claim | SUP/ADM | completeness_review | 공식 접수 |
| completeness_review | return_incomplete | SUP | adjustment_required | 누락사유 |
| completeness_review | start_quantity_review | SUP | quantity_review | Measurement refs |
| quantity_review | start_valuation_review | SUP/QS | valuation_review | 수량검증 완료 |
| valuation_review | request_adjustment | SUP/QS | adjustment_required | 금액/근거 조정 |
| adjustment_required | resubmit_payment_claim | CON | submitted | 정정 Claim |
| valuation_review | prepare_recommendation | SUP/QS | recommendation_pending | 계산검증 |
| recommendation_pending | recommend_payment | chief_supervisor/권한자 | recommended | 추천 Snapshot |
| recommended | submit_owner_review | SUP | owner_review | Owner 전달 |
| owner_review | approve_payment | OWN | owner_approved | 승인금액·근거 |
| owner_review | adjust_payment | OWN | owner_adjusted | 조정금액·사유 |
| owner_review | reject_payment | OWN | rejected | 거절사유 |
| owner_approved/owner_adjusted | record_payment | OWN/ADM | payment_recorded | 외부 지급 Reference |
| payment_recorded | close_payment_claim | SUP/ADM | closed | 누계정합 |

ADM은 기술수량 검증이나 지급추천 권한을 행사하지 않는다.

---

## 15. Claimed / Verified / Recommended / Approved / Paid

금액은 최소 다음을 별도 표시한다.

- claimedAmount
- verifiedAmount
- recommendedAmount
- ownerApprovedAmount
- paidAmount

관계:

> Claimed ≠ Verified ≠ Recommended ≠ Owner Approved ≠ Paid

어느 단계도 이전 값을 조용히 덮어쓰지 않는다.

---

## 16. Valuation

기본 구성:

- Verified Work Amount
- Approved Variation Amount
- Eligible Material on Site
- Other Contractually Eligible Amount
- Retention
- Advance Payment Recovery
- Other Approved Deduction
- Tax / VAT if applicable
- Previous Certified/Paid Amount
- Current Recommended Amount

정확한 공식은 `calculationRuleRef`가 가리키는 exact versioned Contract Requirement로 관리한다. 앱에서 단일 글로벌 계산식을 강제하지 않으며 UI 산식도 authoritative 계산이 아니다.

서버는 Rule의 Formula ID, Base/Add/Subtract component, Deduction Type 매핑, Rounding Rule/Quantum/Mode를 읽어 canonical Decimal로 재계산한다. `retentionAmount`, `advanceRecoveryAmount`, `otherDeductionAmount`는 `deductionComponents[]`의 해당 Line 합계와 정확히 일치해야 한다.

Recommendation Snapshot에는 Rule exact ref와 함께 base/addition/deduction 합계, 반올림 전·후 금액, Rounding Rule을 계산 Trace로 보존한다.

---

## 17. Retention / Advance / Deduction

각 공제는 별도 Line 또는 Component로 보존한다.

최소:

- type
- basis
- rate
- amount
- currency
- contractClauseRef
- sourceDecisionRef
- period
- cumulativeAmount

Retention Release도 별도 승인/지급절차가 필요하다.

선급금 상계가 완료되면 역사값을 삭제하지 않는다.

---

## 18. Previous Certificate와 누계

Payment Claim은 이전 승인/지급 누계를 참조한다.

검증:

- Previous Certified Amount
- Previous Paid Amount
- Current Period Amount
- Cumulative Certified
- Cumulative Paid
- Remaining Contract Value

중복기성은 BOQ item + measurement scope + period + previous certificate refs로 검증한다.

---

## 19. Payment Recommendation

감리 Recommendation은 다음 내용을 고정한 Snapshot이다.

- Payment Claim exact version
- BOQ exact version
- Measurement exact versions
- Verified Quantity
- Eligible/Blocked Item
- Approved Variation
- Deduction Components
- Recommended Amount
- Currency
- Calculation Rule exact version
- Calculation / Rounding Trace
- Reviewer
- RecommendedAt
- Reservation/Comment

FM-26은 이 Recommendation의 사람이 읽는 DOUL 내부 Snapshot이다.

---

## 20. Owner Approval

발주처는 감리 추천금액과 다른 금액을 승인할 수 있다.

조정 시 최소:

- ownerApprovedAmount
- adjustmentAmount
- adjustmentReason
- decisionRef 또는 approvalRef
- decidedAt
- actor

기술수량 사실 자체를 변경하려면 Payment Approval 값만 고치는 것이 아니라 해당 QuantityMeasurement 또는 Decision 근거와 연결한다.

---

## 21. Actual Payment Record

실제 지급이 외부 ERP/회계/은행에서 발생하는 경우 앱은 PaymentClaim의 append-only `paymentRecords[]`에 지급건별 원본을 보존한다.

각 Actual Payment Record 최소항목:

- recordId
- kind = payment / correction / cancellation
- amount / currency
- paidAt
- paymentReference / externalSystemRef
- evidenceIds
- recordedBy / recordedAt
- supersedesPaymentRecordId / reason — 정정·취소 시

동일 Project에서 `paymentReference`와 유효한 `externalSystemRef`는 재사용할 수 없다. `paidAmount`, `cumulativePaidAmount`, `unpaidBalance`는 현재 유효한 Payment Record에서 서버가 파생하는 Projection이며 새 지급건이 앞 지급건을 덮어쓰지 않는다.

정정·취소는 원기록을 삭제하지 않고 correction/cancellation record를 추가하여 `supersedesPaymentRecordId`로 연결한다. 외부 지급실패나 부분지급은 Owner Approved 상태와 `ownerApprovedAmount`를 소급변경하지 않는다.

---

## 22. Dispute

분쟁가능한 항목:

- quantity
- rate
- variation eligibility
- retention
- deduction
- previous payment
- contract interpretation

분쟁금액은 undisputedAmount와 disputedAmount로 분리한다.

기성검토를 위해 계약상 Claim 권리판단이 필요하면 F-08 Contract Notice / Claim과 연결한다.

---

## 23. Owner Reporting Trigger

다음은 발주처 보고/Decision 대상이다.

- Claim 대비 Recommended 차이가 프로젝트 Threshold 초과
- 미승인 Variation이 큰 비중
- 대규모 초과물량
- 반복 중복청구
- 중요 공종의 지급보류
- 주요 NCR 때문에 금액보류
- Contract Amount 초과 Forecast
- Retention/Advance Recovery 이견
- 공정회복/Acceleration 비용 영향
- Claim/분쟁 전환 가능성

---

## 24. 관리대장 17 Projection

보여줄 것:

- Payment Claim No.
- Period
- Contract / BOQ Version
- Claimed Amount
- Verified Amount
- Recommended Amount
- Owner Approved Amount
- Paid Amount
- Current Status
- Verified Quantity
- Blocked Quantity
- Approved Variation
- Unapproved Variation
- Retention
- Advance Recovery
- Other Deduction
- Disputed Amount
- Cumulative Certified
- Cumulative Paid
- Remaining Contract Value
- Owner Decision / Approval
- Actual Payment Records
- Payment Reference
- Next Due

17번 대장은 조회형 Projection으로 유지한다.

상태변경은 QuantityMeasurement / PaymentClaim Domain Command에서 수행한다.

---

## 25. FM-26 물량·기성 검토·추천서

FM-26은 DOUL 내부 검토·추천 Snapshot이다.

최소 Header:

- Project
- Contract Package
- Claim No.
- Period
- Contract / BOQ Revision
- Currency
- Submitted Amount
- Verified Amount
- Recommended Amount

Line Table:

- BOQ Item
- Description
- Unit
- Contract Qty
- Claimed Qty
- Verified Qty
- Previous Certified Qty
- Cumulative Verified Qty
- Verified Amount
- Variation Ref
- Basis / Note

Summary:

- Approved Variation
- Material on Site
- Retention
- Advance Recovery
- Other Deduction
- Tax if applicable
- Recommended Net Amount
- Blocked / Disputed Amount
- Recommendation Comment

서명/확인:

- Quantity/Cost Reviewer
- Chief Supervisor

발주처 최종 지급승인 서식이나 세금계산서/회계전표를 대체하지 않는다.

---

## 26. Functional Inventory

| ID | Function | Primary Actor | Trigger | 완료조건 |
|---|---|---|---|---|
| F05-01 | BOQ Baseline | OWN/SUP | 계약확정 | exact BOQ version |
| F05-02 | Quantity Submission | CON | 기성기간 | Measurement 제출 |
| F05-03 | Field Measurement | SUP | 제출 | 실제수량 확인 |
| F05-04 | Technical Eligibility | SUP | 수량검증 | 검수·시험·자재 Gate |
| F05-05 | Quantity Verification | SUP | Gate 충족 | verified quantity |
| F05-06 | Payment Claim Submit | CON | 기간마감 | 공식 Claim |
| F05-07 | Claim Completeness | SUP/ADM | 접수 | 검토가능 |
| F05-08 | Valuation Review | SUP/QS | 수량완료 | 단가·공제·Variation 검토 |
| F05-09 | Adjustment | CON/SUP | 차이발생 | 정정/이견표시 |
| F05-10 | Recommendation | SUP/chief | 검토완료 | FM-26 Snapshot |
| F05-11 | Owner Approval | OWN | Recommendation | 승인/조정/거절 |
| F05-12 | Payment Record | OWN/ADM | 외부지급 | 지급 Reference |
| F05-13 | Cumulative Reconciliation | SUP/QS | 지급 후 | 누계정합 |
| F05-14 | Dispute Transfer | SUP/OWN | 계약이견 | F-08 연결 |

---

## 27. Completion Criteria

### Quantity Measurement 완료

- BOQ exact version
- 측정기간/Scope 확정
- claimed/verified 수량 분리
- Measurement basis 보존
- Inspection/Test/Material 적격성 확인
- Variation 상태 확인
- Evidence 보존
- 이견 시 disputed 상태

### Payment Claim 완료

- 모든 Line Item 상태 확정
- Verified/Blocked/Disputed 금액 분리
- 공제/Retention/Advance 계산근거 보존
- 감리 Recommendation Snapshot
- Owner 승인/조정/거절 기록
- 실제 지급 시 외부 Reference
- 누계정합
- Audit 보존

---

## 28. Backend Handoff Contract

Backend는 다음 Product 의미를 변경하지 않는다.

- InformationItem / ContractBOQ
- WorkItem / QuantityMeasurement
- WorkItem / PaymentClaim
- Decimal string monetary/quantity values
- claimed / verified / recommended / approved / paid 분리
- exact BOQ version
- payment eligibility
- blockedReasons
- Variation approval boundary
- cumulative reconciliation
- external payment reference
- immutable Audit

현재 WorkItem.data에 일부 필드를 임시 표현할 수 있으나 의미를 합치지 않는다.

---

## 29. UI Handoff Contract

UI는 최소 다음을 한 화면에서 구분한다.

- Claimed
- Verified
- Blocked
- Recommended
- Owner Approved
- Paid
- Disputed

예:

> 청구 12.50억 / 검증 11.90억 / 추천 11.55억 / 발주처 승인 11.30억 / 지급 10.00억

하나의 승인금액 필드로 합치지 않는다.

Line Item Drill-down에서 다음 근거로 이동할 수 있어야 한다.

- BOQ
- Measurement
- Inspection
- Test
- Material
- Variation
- Evidence
- Decision

---

## 30. Product Validation Scenarios

### Scenario A — 정상기성

BOQ Item → Measurement verified → Claim → Recommendation → Owner Approved → Payment Recorded

기대:
- 단계별 금액 별도 보존
- 누계정상

### Scenario B — 청구수량 과다

Claimed 120 / Verified 100

기대:
- 원 Claim 120 보존
- Verified 100
- 차이 20 사유기록

### Scenario C — Inspection 미합격

실시공량 존재, Inspection failed

기대:
- Quantity 측정 가능
- paymentEligible=false
- 지급추천 제외

### Scenario D — 미승인 Variation

Variation work 50 포함

기대:
- 별도 표시
- 기본 추천금액에서 제외
- Owner Decision/Variation 연결

### Scenario E — 중복청구

이전 Certificate에서 이미 100 지급추천
현재 동일 Scope 20 재청구

기대:
- duplicate 차단
- 누계초과 방지

### Scenario F — Owner 조정

Recommended 1,000
Owner Approved 950

기대:
- Recommendation 1,000 보존
- Owner Adjustment 50 + reason 보존

### Scenario G — 부분지급

Owner Approved 950
Paid 700

기대:
- Approved 상태 유지
- unpaid balance 250 추적

### Scenario H — Decimal 정밀도

Quantity 12.375 × Rate 1,250,000.00

기대:
- Decimal 문자열 기반 계산
- 반올림 규칙 Audit
- binary float 오차 없음

---

## 31. F-05 완료판정

F-05 Product / Functional Design은 다음을 정의했으므로 관리대장 17의 Product 성숙도를 M3로 평가한다.

- Contract BOQ Baseline
- Quantity Measurement
- Measurement Basis
- Payment Eligibility
- Payment Claim
- Valuation
- Retention / Advance / Deduction
- Variation Boundary
- Claimed / Verified / Recommended / Approved / Paid
- Owner Approval
- Actual Payment Record
- Dispute
- FM-26
- Register Projection
- Completion Criteria
- Backend/UI Handoff

다음 Product 상세설계는 F-06 PCCC / Environment Compliance로 진행한다.
