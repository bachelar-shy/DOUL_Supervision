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

구현:
- SafetyPermit command/state
- SafetyStopOrder command/state
- workAuthorized 계산
- Equipment Readiness
- Resume Gate

Acceptance:
- Issue close가 Stop lift를 자동발생시키지 않음
- Permit 승인만으로 workAuthorized=true가 되지 않음
- CON self-resume 불가

### B-P3. Schedule / Delay / Recovery

구현:
- Schedule immutable version/snapshot
- Data Date
- DelayEvent state/command
- RecoveryPlan state/command
- Baseline/Forecast 분리

Acceptance:
- Progress Update가 Baseline을 덮어쓰지 않음
- DelayEvent가 EOT를 자동승인하지 않음

### B-P4. Measurement / Payment

구현:
- ContractBOQ exact version
- QuantityMeasurement workflow
- PaymentClaim detailed workflow
- Decimal string 계산 adapter
- cumulative reconciliation / duplicate check

Acceptance:
- claimed/verified/recommended/ownerApproved/paid 분리
- unapproved Variation 기본 지급추천 제외

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

구현:
- Notice deadline engine with versioned contract rule
- Claim / EOTRequest workflow
- F-04/F-05 source refs

Acceptance:
- deadline overrun = risk flag, 자동 권리상실 판정 금지
- EOT decision 후에만 Baseline revision trigger

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

구현 중 다음이 발견되면 Product Baseline v1.x 변경요청으로 전환한다.

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
- Backend/UI/Platform backlog separated
- Business semantic changes routed back to Product

이 문서를 기준으로 Product / Functional은 v1.0 설계를 완료하고 구현축으로 인계한다.
