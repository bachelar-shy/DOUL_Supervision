# 38. Risk / Assurance / Audit Functional Contract v1.0

기준일: 2026-10-06
Functional ID: F-11
대상 관리대장: 25 위험·기회, 28 내부감사·준수점검
관련 양식: FM-31

## 1. 목적
Risk/Opportunity와 독립 Assurance/Audit를 구분하면서 대응→검증→학습으로 연결한다.

## 2. Risk Object
기존 WorkItem / Risk.
필드: category, cause, event, consequence, likelihood, impact, inherentRating, owner, responseStrategy, actionRefs, residualRating, reviewDue, decisionRefs.

State: candidate → assessed → response_planned → active → monitoring → residual_review → accepted / escalated / closed.

Opportunity도 동일 구조를 쓰되 benefit/realization 지표를 별도 둔다.

## 3. Risk Gate
- 원인/사건/영향 분리
- 평가기준 version
- owner/response/due
- residual risk
- acceptance authority
- critical risk Owner Reporting

## 4. ComplianceAudit Object
기존 WorkItem / ComplianceAudit.

State: planned → scope_approved → in_progress → findings_review → corrective_action → independent_verification → closed / followup_required.

## 5. Independence
Audit 수행자와 Finding 시정 책임자를 분리한다. 자기 시정조치를 자기 자신이 독립검증한 것으로 처리하지 않는다.

## 6. Finding
Finding은 필요 시 Issue + Action으로 전환한다. Observation/Opportunity는 곧바로 NCR로 강제하지 않는다.

## 7. FM-31
Risk/Assurance/Audit 검토서: scope, criteria, findings, response, residual risk, independence, verification.

## 8. Register 25 / 28
25: inherent/residual risk, owner, response, due, decision, trend.
28: audit scope, independence, findings, corrective action, verification, close status.

## 9. Validation
- Action complete, independent verification 없음 → audit close 불가
- high residual risk → 권한자 acceptance 필요
- Opportunity rejected → Risk처럼 adverse issue 생성 금지

## 10. 완료판정
관리대장 25·28은 M3.

## 11. Actor / Decision Right

Risk:
- 누구나 후보를 제안할 수 있으나 SUP/PM이 공식 Risk를 확인한다.
- Risk Owner는 response 실행책임을 가진다.
- High/Critical residual risk acceptance는 프로젝트 지정 권한자/OWN에 한정한다.

Audit:
- Audit Lead가 Scope/Criteria를 확정하고 수행한다.
- Auditee가 시정조치를 수행한다.
- independent verifier는 자신이 수행한 시정조치를 독립검증할 수 없다.
- Audit close 권한은 독립검증 결과를 볼 수 있는 SUP/QA 권한자에게 둔다.

## 12. Risk Command Contract

| From | Command | Actor | To | Gate |
|---|---|---|---|---|
| - | create_risk_candidate | SUP/CON/OWN/DES | candidate | cause/event/consequence |
| candidate | assess_risk | SUP/PM | assessed | criteria/version/likelihood/impact |
| assessed | plan_response | Risk Owner/SUP | response_planned | strategy/actions/due |
| response_planned | activate_response | Risk Owner | active | actions assigned |
| active | start_monitoring | SUP | monitoring | response underway |
| monitoring | assess_residual_risk | SUP | residual_review | current evidence |
| residual_review | accept_residual_risk | authorized approver | accepted | acceptance authority |
| residual_review | escalate_risk | SUP | escalated | threshold/owner report |
| accepted/escalated | close_risk | SUP | closed | residual/decision/followup complete |

## 13. Audit Command Contract

| From | Command | Actor | To | Gate |
|---|---|---|---|---|
| planned | approve_audit_scope | Audit Lead | scope_approved | scope/criteria/independence |
| scope_approved | start_audit | Auditor | in_progress | evidence access |
| in_progress | submit_findings | Auditor | findings_review | finding evidence/classification |
| findings_review | require_corrective_action | Audit Lead | corrective_action | action owner/due |
| corrective_action | submit_audit_correction | Auditee | independent_verification | correction evidence |
| independent_verification | verify_finding | Independent Verifier | closed | findings resolved |
| independent_verification | require_followup | Independent Verifier | followup_required | unresolved basis |
| followup_required | resubmit_correction | Auditee | independent_verification | new evidence |

## 14. Exception / SLA

- critical finding → immediate escalation/Owner report according to threshold
- overdue action → Audit remains open
- conflict of interest → verifier reassignment required
- repeated finding → systemic Risk/Lesson candidate
- accepted residual risk does not delete original risk history

## 15. Completion Criteria

Risk close: response completed + residual rating + acceptance/escalation decision + evidence.
Audit close: all blocking findings independently verified + outstanding nonblocking items explicitly transferred + audit report snapshot.

## 16. Backend / UI Handoff

Backend must validate verifier independence where identity data permits. UI must distinguish inherent risk, residual risk, response status, and acceptance; Audit Finding status must not be collapsed into generic Issue status.
