# 41. Document Transmittal Functional Contract v1.0

기준일: 2026-10-06
Functional ID: F-14
대상 관리대장: 05 문서송수신
관련 양식: FM-34

## 1. 목적
공식 문서전달을 일반 Notification과 구분하여 송신·전달·수령·회신기한·증빙을 추적한다.

## 2. Object
WorkItem / DocumentTransmittal.

필드: transmittalNo, sender, recipients, purpose, informationItemRefs, exactVersions, issuedAt, deliveryChannel, deliveryEvidence, receiptRequired, receiptAt, responseRequired, responseDueAt, responseRefs, confidentiality, supersedesRef.

## 3. State
draft → issued → delivery_pending → delivered → receipt_pending → receipt_acknowledged → response_due → responded → closed / delivery_failed / superseded.

## 4. 원칙
- Notification 발송 ≠ 공식 Transmittal.
- email sent ≠ 수령확인.
- receipt ≠ approval.
- 회신 없음을 승인으로 간주하지 않는다 unless contract rule explicitly says so.
- 전달된 문서 exact version을 고정한다.

## 5. Failure/Resend
Delivery failure는 새 시도/evidence를 남긴다. 원 Transmittal을 삭제하지 않는다.

## 6. FM-34
문서송수신표지: transmittal no, sender/recipient, purpose, item list, revision, receipt/response due.

## 7. Register 05
sent/delivered/receipt/response due/overdue/item versions/status.

## 8. 완료판정
관리대장 05는 M3.

## 9. Actor / Decision Right

- sender: authorized SUP/CON/DES/OWN/ADM according to document type
- document control/ADM: numbering, dispatch administration, receipt logging
- recipient: receipt acknowledgement only; receipt does not imply approval
- technical reviewer/approver: separate downstream workflow authority
- SYSTEM: delivery/response reminder only

## 10. Command Contract

| From | Command | Actor | To | Gate |
|---|---|---|---|---|
| draft | issue_transmittal | authorized sender | issued | item exact versions/recipients/purpose |
| issued | dispatch_transmittal | ADM/SYSTEM integration | delivery_pending | approved channel/delivery metadata |
| delivery_pending | record_delivery | ADM/INTEGRATION evidence | delivered | delivery evidence |
| delivery_pending | record_delivery_failure | ADM/INTEGRATION | delivery_failed | failure evidence |
| delivery_failed | resend_transmittal | ADM/sender | delivery_pending | new attempt ref |
| delivered | request_receipt | SYSTEM/ADM | receipt_pending | receipt required |
| receipt_pending | acknowledge_receipt | recipient | receipt_acknowledged | actor/time |
| receipt_acknowledged | start_response_clock | SYSTEM | response_due | response required + due rule |
| response_due | record_response | ADM/sender | responded | exact response ref |
| delivered/receipt_acknowledged/responded | close_transmittal | sender/ADM | closed | required receipt/response complete |
| any active | supersede_transmittal | sender | superseded | successor ref/reason |

INTEGRATION은 delivery evidence를 기록할 수 있으나 approval/receipt의 인간 의미를 임의 생성하지 않는다.

## 11. Exception / SLA

- invalid recipient/address → delivery_failed
- partial delivery to multi-recipient list → recipient별 상태 보존
- recipient refuses receipt → refusal evidence + escalation
- response overdue → overdue flag/notification; silence ≠ approval
- confidential/restricted documents → access-policy enforcement required

## 12. Completion Criteria

- exact transmitted item/version list fixed
- delivery evidence per required recipient
- receipt evidence where required
- response captured or formally transferred/waived by authorized rule
- retries/failures preserved
- audit trail complete

## 13. Backend / UI Handoff

Backend stores recipient-level delivery/receipt status and exact information item versions. UI distinguishes `issued`, `delivered`, `received`, `responded`, and downstream `approved` status.
