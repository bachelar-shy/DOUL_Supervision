# 45. Role End-to-End Journeys v1.0

기준일: 2026-10-06
목적: Product Functional Contract를 역할별 실제 업무흐름으로 검증한다.

## 1. 공통 원칙

- actor 권한은 RoleAssignment + Qualification + Project scope를 따른다.
- 화면에 버튼이 보여도 Domain Gate를 우회하지 않는다.
- 수령/열람/검토/승인/판정/종결을 서로 구분한다.
- 모든 공식 결정은 actor/time/target version/evidence를 남긴다.
- AI/SYSTEM/INTEGRATION은 인간 기술권한을 행사하지 않는다.

## 2. SUP 감리자 Journey

Today / Queue
→ 제출자료 검토
→ 자재·시험 승인조건 확인
→ 현장 Pre-start / Inspection
→ Observation 검토
→ Issue / SiteInstruction
→ 시정·재검측
→ 공정/지연 영향 확인
→ 기성 수량·적격성 검토
→ 안전/PCCC/환경 Compliance
→ Risk/Audit
→ Owner Report / Decision Request
→ Commissioning / Handover
→ Lesson Learned

SUP 핵심 Gate:
- 최신 도면/Requirement
- qualification/current authority
- Evidence sufficiency
- no self-approval conflict
- Owner decision boundary

## 3. CON 시공사 Journey

Contract / Baseline 확인
→ Submission / Shop Drawing / Material Submittal
→ Safety Permit
→ Work execution
→ Self-check / Inspection Request
→ Test / Measurement
→ Issue corrective action
→ Reinspection request
→ Progress Update
→ Quantity Measurement / Payment Claim
→ Recovery / Contract Notice if applicable
→ Commissioning documents
→ Handover / Warranty remedy

CON은 공식 Issue close, SUP Stop lift, technical approval, Owner payment decision을 수행하지 않는다.

## 4. OWN 발주처 Journey

Dashboard
→ 주요 Report 수령
→ Decision Queue
→ Change/Cost/Time option review
→ Contract/Payment approval
→ Major Risk/Compliance decision
→ Handover acceptance
→ Follow-up verification
→ Report closure

OWN receipt ≠ technical approval.
OWN decision은 exact source version과 alternatives를 참조한다.

## 5. DES 설계자 Journey

RFI / Design Query
→ technical response
→ drawing/spec revision
→ Change impact coordination
→ fire/environment/permit design support
→ commissioning technical support
→ as-built/design intent confirmation if required

DES 답변만으로 Change/Commercial Approval을 대체하지 않는다.

## 6. ADM Journey

Project setup
→ Party/Organization
→ Role/Qualification administration
→ Contract/Requirement baseline registration
→ Document receipt/transmittal administration
→ due-date/notification
→ snapshot/distribution support
→ audit/access administration

ADM은 기술판정·Issue close·Permit authorize·Payment recommendation을 하지 않는다.

## 7. AI / SYSTEM Journey

Upload/Event
→ AnalysisRun
→ candidate observation / extraction / due detection
→ human review queue
→ confirm/reject
→ confirmed result only then Domain action candidate

자동화 가능:
- deadline calculation
- missing field detection
- version mismatch warning
- threshold warning
- candidate classification

자동화 금지:
- official technical pass/fail
- Owner decision
- contractual entitlement
- work resume authority
- Issue final close

## 8. 핵심 Cross-role Closed Loops

### Quality
CON request → SUP inspect → FAIL → Issue → CON action → SUP reinspection → closure evidence → close

### Owner Governance
SUP report → OWN receipt → decision/action → verification → report close

### Safety
CON permit → SUP verification/authorization → work → stop → CON correction → SUP verification → authorized lift → resume

### Schedule/Claim
CON update → SUP verify → DelayEvent → Recovery → Notice/Claim/EOT → OWN decision → Baseline update

### Payment
CON measurement/claim → SUP verify/recommend → OWN approve/adjust → payment record → cumulative reconcile

### Handover
CON completion package → SUP commissioning/readiness → OWN acceptance → WarrantyClaim → remedy/reinspection → close

## 9. Journey Validation

각 Journey는 다음 질문에 모두 답해야 한다.
- 누가 시작하는가?
- 누가 판정하는가?
- 누가 승인하는가?
- 무엇이 완료조건인가?
- 실패하면 어디로 돌아가는가?
- Owner 보고가 필요한가?
- 어떤 Evidence/version이 남는가?

모든 질문에 답이 없는 Function은 Product Baseline 완료로 간주하지 않는다.
