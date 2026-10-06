# 37. Site Instruction Functional Contract v1.0

기준일: 2026-10-06
Functional ID: F-10
대상 관리대장: 15 현장지시
관련 양식: FM-14

## 1. 목적
현장지시를 발행→수령→질의/이의→이행→검증→종결로 관리한다.

핵심 원칙:
- 현장지시 ≠ 설계변경 승인.
- 현장지시 ≠ Variation/비용승인.
- 긴급 구두지시는 사후 공식화한다.
- Contractor acknowledgement ≠ 동의/완료.
- 지시 완료는 SUP 검증 후 종결한다.

## 2. Object
기존 WorkItem / SiteInstruction을 상세화한다.

필드: instructionNo, issuedBy, issuedAt, targetParty, location, discipline, instructionText, basisRefs, dueAt, acknowledgementAt, clarificationRefs, objectionRefs, actionRefs, changeRequired, variationPotential, completionEvidence, verificationRef.

## 3. State
draft → issued → acknowledged → clarification_or_objection / in_execution → completion_submitted → verification → closed / rework_required / superseded / withdrawn

## 4. Gate
발행권한, 근거, Scope, due, safety/quality impact, design change 여부, contract impact 여부를 확인한다.

## 5. Change Branch
설계의도/계약범위/비용/공기에 영향하면 RFI/Change/Variation/Owner Decision으로 분기한다. SiteInstruction 자체가 이를 대체하지 않는다.

## 6. Emergency Instruction
즉시 안전·품질 위험은 현장구두지시 가능. observedAt/effectiveAt/actor/scope를 기록하고 공식 FM-14로 전환한다.

## 7. Register 15
issued/acknowledged/due/execution/clarification/change/variation/completion/verification/overdue.

## 8. Validation
- acknowledged → completed 아님
- contractor completion submit → closed 아님
- design-changing instruction → Change ref 없이 close 금지

## 9. 완료판정
관리대장 15는 M3.

## 10. Actor / Decision Right

| 행위 | Actor | 경계 |
|---|---|---|
| Draft 작성 | SUP | 자격/Scope 내 |
| 공식 발행 | authorized SUP/chief | 프로젝트 Authority Matrix에 따름 |
| 수령확인 | CON | 수령 사실만 확인 |
| 질의/이의 | CON | 지시 무효화 아님 |
| 설계기술 확인 | DES | 설계권한 범위 |
| 비용/공기 결정 | OWN | SiteInstruction이 대체하지 않음 |
| 완료 검증/Close | SUP | 이행 Evidence 확인 |

## 11. Command Contract

| From | Command | Actor | To | Gate |
|---|---|---|---|---|
| draft | issue_instruction | authorized SUP | issued | instruction/basis/scope/due |
| issued | acknowledge_instruction | CON | acknowledged | receipt timestamp |
| acknowledged | request_clarification | CON | clarification_or_objection | question/evidence |
| acknowledged | raise_objection | CON | clarification_or_objection | basis/impact |
| clarification_or_objection | resolve_clarification | SUP/DES/OWN as applicable | acknowledged/in_execution | response/decision refs |
| acknowledged | start_execution | CON | in_execution | applicable prerequisites |
| in_execution | submit_completion | CON | completion_submitted | completion evidence |
| completion_submitted | start_verification | SUP | verification | field check possible |
| verification | verify_completion | SUP | closed | verified evidence |
| verification | require_rework | SUP | rework_required | failure reason |
| rework_required | resubmit_completion | CON | completion_submitted | corrected evidence |
| any active | supersede_instruction | authorized SUP | superseded | successor instruction ref |
| draft/issued | withdraw_instruction | issuer/chief | withdrawn | reason + impact review |

## 12. Exception / SLA

- immediate safety/quality hazard: oral instruction effective first, formal record due per project rule
- design ambiguity: RFI/Change branch
- potential commercial impact: Variation/Owner Decision branch
- contradictory instructions: latest valid official instruction/decision governs; conflict escalated
- overdue execution: owner/responsible party escalation, not automatic close

## 13. Evidence / Completion

Close requires:
- official instruction exact version
- acknowledged recipient
- clarification/objection resolved or formally transferred
- required Change/Variation refs when applicable
- completion evidence
- SUP verification
- Audit trail

## 14. Backend / UI Handoff

UI must expose instruction status, acknowledgement, clarification, Change/Variation branch, completion and verification separately. Contractor cannot set `closed` directly.
