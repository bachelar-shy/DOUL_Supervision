# 39. Insurance / Guarantee Functional Contract v1.0

기준일: 2026-10-06
Functional ID: F-12
대상 관리대장: 27 보험·보증
관련 양식: FM-32

## 1. 목적
보험·보증 요구조건을 제출→적합성확인→유효성→갱신→해지/반환까지 관리한다.

## 2. Object
기존 WorkItem / InsuranceGuarantee + InformationItem / Certificate.

필드: type, issuer, beneficiary, policyOrGuaranteeNo, amount, currency, coverageScope, validFrom, validTo, renewalLeadDays, contractClauseRef, originalDocumentRef, verificationResult, releaseCondition, callEventRefs.

## 3. State
required → submission_pending → submitted → verification → accepted / returned → active → renewal_due → renewed / expired → release_review → released / called / closed.

## 4. Gate
- issuer/beneficiary
- amount/currency
- coverage/scope
- validity dates
- wording/contract clause
- original authenticity evidence
- renewal lead time
- release prerequisites

## 5. Expiry
만료 전 알림은 갱신이 아니다. expired 상태에서 관련 계약 Gate가 차단될 수 있으나 차단범위는 프로젝트 계약설정으로 정한다.

## 6. Release / Call
보증 반환·해지·청구는 Owner/계약상 권한자의 명시적 결정이 필요하다. ADM이 자동 처리하지 않는다.

## 7. FM-32
보험·보증 적합성 검토서. 원본증권/보증서를 대체하지 않는다.

## 8. 완료판정
관리대장 27은 M3.

## 9. Actor / Decision Right

- CON/contract party: policy/guarantee 제출·갱신자료 제공
- ADM: 등록·만료알림·원본보관
- SUP/QS/contract reviewer: 계약요건 적합성 검토
- OWN/contract authority: acceptance, waiver if contractually allowed, release, call decision
- SYSTEM: due/expiry warning only

## 10. Command Contract

| From | Command | Actor | To | Gate |
|---|---|---|---|---|
| required | request_submission | SUP/ADM | submission_pending | requirement/clause/due |
| submission_pending | submit_instrument | CON | submitted | original/ref/details |
| submitted | start_verification | SUP/QS | verification | authenticity/terms available |
| verification | accept_instrument | authorized reviewer | accepted | amount/scope/wording/validity |
| verification | return_instrument | SUP/QS | returned | deficiency reason |
| returned | resubmit_instrument | CON | submitted | corrected version |
| accepted | activate_instrument | SUP/ADM | active | validFrom reached/current |
| active | flag_renewal_due | SYSTEM | renewal_due | warning threshold |
| renewal_due | submit_renewal | CON | submitted | renewal instrument |
| active/renewal_due | record_expiry | SYSTEM | expired | validTo elapsed |
| active | start_release_review | OWN/SUP | release_review | release prerequisites |
| release_review | approve_release | OWN | released | explicit decision |
| active/release_review | approve_call | OWN | called | contractual basis/decision |
| released/called/expired | close_instrument | SUP/ADM | closed | downstream refs complete |

## 11. Exception / SLA

- insurer/issuer authenticity unresolved → verification blocked
- value/currency mismatch → return
- expiry threatens contract gate → Owner immediate escalation
- replacement/renewal overlaps → both instruments preserved with effective periods
- waiver/alternative security → explicit Owner Decision; never inferred

## 12. Completion Criteria / Handoff

Complete only after release/call/expiry outcome is documented and financial/contract follow-up is linked. UI separates accepted, active, renewal due, expired, released and called. Backend keeps exact original document refs and validity periods.
