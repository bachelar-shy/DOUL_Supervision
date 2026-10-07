# 35. Contract Notice / Claim / EOT Functional Contract v1.0

기준일: 2026-10-06
Functional ID: F-08
Domain: D6 Schedule / Commercial / Contract
대상 관리대장: 26 계약통지·클레임·공기연장
관련 양식: FM-29

## 1. 목적

계약상 사건을 지연/변경 업무와 구분하여 Notice 기한, 근거, 영향, 결정까지 추적한다.

> Event → Notice Trigger → Notice → Ongoing Records → Claim/EOT Submission → Completeness → Entitlement Assessment → Time/Cost Assessment → Decision/Negotiation → Baseline/Payment 반영 → Close

핵심 원칙:
1. Delay Event ≠ EOT entitlement.
2. Change 승인 ≠ 비용/공기 Claim 자동승인.
3. Notice 수령 ≠ Claim 인정.
4. 감리 기술검토 ≠ 발주처 계약결정.
5. EOT 승인 ≠ 비용 Claim 승인.
6. Claim 종료 ≠ 관련 Delay Event 삭제.
7. 계약별 기한/절차를 Project Contract Requirement로 구성한다.

## 2. Product Objects

기존 ContractNotice를 상세화하고 다음 subtype을 추가한다.
- WorkItem / Claim
- WorkItem / EOTRequest

ContractNotice 최소:
- noticeNo/eventRef/clauseRef
- awareAt/eventAt
- noticeDueAt/submittedAt
- sender/recipient
- subject/reliefReserved
- acknowledgementRef
- followupDue

Claim 최소:
- claimNo
- noticeRefs/eventRefs
- clauseRefs
- claimType
- entitlementBasis
- chronology
- evidenceRefs
- timeImpactRef
- costImpactRef
- amount/currency
- disputedItems
- decisionRefs

EOTRequest 최소:
- eotNo
- delayEventRefs
- noticeRefs
- baselineScheduleRef
- impactAnalysisRefs
- daysClaimed/daysAssessed/daysApproved
- concurrentDelayAssessment
- decisionRef
- revisedCompletionDate

## 3. Notice State

identified → notice_due → submitted → acknowledged → followup_required → preserved → closed / time_bar_risk

시스템 알림은 Notice 제출 자체가 아니다.

## 4. Claim State

draft → submitted → completeness_review → substantiation → entitlement_review → quantum_review → decision_pending → approved / partially_approved / rejected / disputed → settled → closed

## 5. EOT State

draft → submitted → completeness_review → time_impact_review → entitlement_review → decision_pending → approved / partially_approved / rejected / disputed → baseline_update_pending → closed

## 6. Notice Gate

- triggering event
- actual/constructive knowledge date if contract requires
- clause/requirement
- due date rule
- sender/recipient
- exact event scope
- reservation of time/cost rights as applicable
- submission evidence

계약별 legal interpretation은 외부 법률검토가 필요한 경우 별도 표시한다.

## 7. Entitlement Assessment

사실과 계약판단을 분리한다.
- event occurred?
- cause/responsibility facts
- notice compliance
- clause applicability
- causation
- mitigation
- concurrency
- records adequacy
- requested relief

감리 의견과 Owner Decision은 별도 객체로 보존한다.

## 8. Time Assessment

F-04의 exact Baseline/Progress/DelayEvent/Impact Analysis를 참조한다.
- claimed days
- assessed days
- approved days
- completion date before/after

EOT 승인 후에만 contractual baseline revision workflow로 전달한다.

## 9. Cost Assessment

F-05의 BOQ/Variation/Payment refs와 연결한다.
- direct cost
- time-related cost
- acceleration
- disruption/productivity if applicable
- deduction/setoff
- tax/currency rules

Claim 금액을 일반 기성금액에 자동 합산하지 않는다.

## 10. Decision Right

SUP:
- 사실/기술/공정/수량 검토
- 권고안 작성

OWN/계약상 권한자:
- entitlement/금액/공기 최종 결정

ADM:
- 접수·기한·문서 기록
- 계약결정 불가

## 11. Owner Reporting

- Notice deadline 임박
- 잠재적 큰 금액/공기 영향
- time-bar risk
- disputed entitlement
- settlement/decision 필요
- baseline/payment 영향

## 12. 관리대장 26 Projection

- event/notice/claim/eot identifiers
- notice due/submitted/acknowledged
- claim status
- amount claimed/assessed/approved
- days claimed/assessed/approved
- entitlement status
- decision due
- dispute
- linked Delay/Variation/Payment
- baseline update status

## 13. FM-29

계약통지·Claim/EOT 검토서:
- Event/Clause/Notice chronology
- deadline compliance
- evidence list
- entitlement assessment
- time impact
- cost impact
- recommendation
- Owner decision status

DOUL 내부 검토서이며 계약상 공식 Notice 원문을 대체하지 않는다.

## 14. Validation Scenarios

1. DelayEvent 존재, Notice 미제출 → EOT 자동 생성 금지
2. Notice submitted → Claim 인정 상태로 바뀌지 않음
3. EOT +10일 승인 → F-04 Baseline update trigger
4. 비용 reject, EOT approve → 상태 분리
5. Claim partially approved → original claimed amount 보존
6. Notice deadline 초과 → time_bar_risk, 자동권리상실 단정 금지

## 15. 완료판정

관리대장 26은 Notice/Claim/EOT lifecycle과 F-04/F-05 경계가 정의되었으므로 M3로 평가한다.

## 16. Command Contract — Notice

`time_bar_risk`는 Notice lifecycle 상태가 아니라 병렬 위험표시이다. 기한 초과 사실을 기록해도 `submitted / acknowledged / followup_required / preserved` 상태를 덮어쓰지 않으며 자동 권리상실을 의미하지 않는다. 시스템 계산은 advisory이고 공식 `noticeDueAt` 확정은 기존 인간 권한으로 수행한다.

| From | Command | Actor | To | Gate |
|---|---|---|---|---|
| create | identify_notice_trigger | SUP/CON/OWN | identified | exact event/clause/contract-rule version + awareness/event date |
| identified | calculate_notice_due | SUP/ADM human review | notice_due | exact contract rule/version + human-confirmed due date |
| notice_due | submit_notice | authorized sender | submitted | exact content/recipient/current command evidence |
| submitted | record_acknowledgement | ADM/SUP | acknowledged | exact acknowledgement ref + receipt evidence |
| acknowledged | require_followup | SUP | followup_required | explicit follow-up due date |
| followup_required | preserve_rights_record | authorized sender | preserved | continuing-record refs + evidence |
| any preclose | flag_time_bar_risk | SUP | same lifecycle state | elapsed confirmed due date + evidence; risk flag only |
| acknowledged/preserved | close_notice | SUP | closed | downstream case refs explicitly recorded |

## 17. Command Contract — Claim

Owner 결과는 하나의 동적 `record_claim_decision` 명령으로 상태를 추정하지 않는다. 승인·부분승인·거절·분쟁 명령을 분리해 command 자체가 목표 상태를 결정한다. `amountClaimed`와 원 제출 근거는 제출 후 직접 수정하지 않고 assessed/approved 값을 별도로 보존한다.

| From | Command | Actor | To | Gate |
|---|---|---|---|---|
| create | create claim draft | CON/authorized claimant | draft | claim identity |
| draft | submit_claim | CON/authorized claimant | submitted | submitted Notice/event/clause/relief/evidence |
| submitted | receive_claim | SUP/ADM | completeness_review | current receipt evidence |
| completeness_review | request_substantiation | SUP | substantiation | explicit missing/required records |
| completeness_review/substantiation | start_entitlement_review | SUP | entitlement_review | entitlement assessment + evidence |
| entitlement_review | start_quantum_review | SUP | quantum_review | assessed amount where applicable + recommendation |
| quantum_review | request_claim_decision | chief_supervisor | decision_pending | recommendation/time/cost assessment |
| decision_pending | approve_claim | OWN | approved | exact Owner Decision = approved |
| decision_pending | partially_approve_claim | OWN | partially_approved | exact Owner Decision = approved + approved amount/disputed items |
| decision_pending | reject_claim | OWN | rejected | exact Owner Decision = rejected |
| decision_pending | dispute_claim | OWN | disputed | exact Owner Decision = returned/unresolved + disputed items |
| disputed | record_claim_settlement | OWN | settled | exact settlement ref + evidence |
| approved/partially_approved/rejected/settled | close_claim | OWN/SUP | closed | implementation refs explicitly recorded |

## 18. Command Contract — EOT

EOT Owner 결과도 명령을 분리한다. `approved / partially_approved`가 된 EOT만 Baseline revision을 요청할 수 있다. `request_baseline_update` 시점의 승인된 EOT **정확한 버전**을 서버가 `baselineRevisionBasisRef`로 보존한다. 이후 새 Baseline의 `revisionBasisRef`가 그 과거 승인 버전을 정확히 참조하고 새 Baseline이 `effective`가 된 뒤에만 EOT를 닫는다. 기존 effective Baseline을 EOT 명령이 직접 수정하지 않는다.

| From | Command | Actor | To | Gate |
|---|---|---|---|---|
| create | create EOT draft | CON/authorized claimant | draft | EOT identity |
| draft | submit_eot | CON/authorized claimant | submitted | exact DelayEvent + submitted Notice + effective Baseline + impact refs + days claimed |
| submitted | receive_eot | SUP/ADM | completeness_review | receipt evidence |
| completeness_review | start_time_impact_review | SUP | time_impact_review | time-impact assessment + assessed days/date |
| time_impact_review | start_eot_entitlement_review | SUP | entitlement_review | entitlement assessment |
| entitlement_review | request_eot_decision | chief_supervisor | decision_pending | recommendation |
| decision_pending | approve_eot | OWN | approved | exact Owner Decision = approved + full approved days/date |
| decision_pending | partially_approve_eot | OWN | partially_approved | exact Owner Decision = approved + partial approved days/date |
| decision_pending | reject_eot | OWN | rejected | exact Owner Decision = rejected |
| decision_pending | dispute_eot | OWN | disputed | exact Owner Decision = returned/unresolved + dispute reason |
| disputed | resolve_eot_dispute_approved / partially_approved / rejected | OWN | approved / partially_approved / rejected | new exact Owner Decision |
| approved/partially_approved | request_baseline_update | SUP | baseline_update_pending | server preserves exact approved EOT version as revision basis |
| baseline_update_pending | confirm_baseline_update | SUP | closed | new effective F-04 Baseline ref + exact EOT revisionBasisRef + approved completion date |
| rejected | close_eot | SUP | closed | rejected decision preserved; no Baseline change |

## 19. Exception / SLA

Project contract configuration must define:
- notice calculation rule and timezone/calendar
- follow-up/interim/final claim due dates
- claim response/decision due dates
- EOT review/decision due dates
- continuing records requirement

System-calculated deadlines are advisory until the applicable contract rule/version and awareness/event date are human-confirmed.

Exception paths:
- ambiguous clause → legal/contract review flag
- incomplete contemporaneous records → substantiation gap
- concurrency dispute → disputed, never auto-resolved
- withdrawn claim → preserve history and downstream references
- settlement without admission → preserve settlement wording/version

## 20. Completion Criteria

Notice complete when submission/receipt/follow-up obligations and downstream case refs are fixed.
Claim complete when entitlement/time/cost decision or settlement is recorded and implementation refs exist.
EOT complete when decision is recorded and any approved contractual completion change has been transferred to F-04 baseline revision.

## 21. Backend / UI Handoff

Do not derive legal entitlement from a generic status field. Backend stores exact contract rule, dates, versions and Decision refs. UI must show `claim submitted`, `assessed`, `owner decided`, `implemented` separately.
