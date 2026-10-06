# 43. Drawing Revision / Field Distribution Functional Contract v1.0

기준일: 2026-10-06
Functional ID: F-16
대상 관리대장: 04 도면·개정
관련 양식: FM-03, FM-36

## 1. 목적
도면 Revision을 review와 현장 사용통제로 분리하여 현재본·폐기도면·배포를 추적한다.

## 2. Objects
InformationItem / Drawing + Approval + DocumentTransmittal.

필드: drawingNo, revision, discipline, status, issuedFor, approvalRef, releaseAt, supersedesRef, fieldDistributionRefs, obsoleteAt, affectedLocations, changeRef.

## 3. Drawing State
draft → submitted → review → approved / returned / rejected → released_for_use → superseded / withdrawn.

## 4. currentForConstruction Gate
- exact revision approved
- issuedFor permits construction use
- not superseded/withdrawn
- required Change/Approval current
- field distribution completed to required parties

## 5. Supersede
새 Revision release 시 이전본은 superseded로 표시한다. 현장 사본 회수/표시 상태를 추적하며 과거본은 삭제하지 않는다.

## 6. Field Distribution
누가 어떤 Revision을 언제 수령했는지 DocumentTransmittal로 보존한다. 단순 업로드는 배포완료가 아니다.

## 7. FM-36
도면 Revision·현장배포 확인서.

## 8. Validation
- approved but not released → currentForConstruction=false
- superseded drawing used on inspection → issue candidate
- new revision received by one contractor only → 전체배포 완료 아님

## 9. 완료판정
관리대장 04는 M3.

## 10. Actor / Decision Right

- DES/authorized originator: drawing creation/revision
- SUP: review and construction-use verification according to authority matrix
- OWN: approval when contract requires
- ADM/document control: numbering/distribution/obsolete-copy tracking
- CON: receipt/field-use acknowledgement; cannot approve own drawing unless explicit contractual role

## 11. Command Contract

| From | Command | Actor | To | Gate |
|---|---|---|---|---|
| draft | submit_drawing_revision | originator | submitted | drawingNo/revision/source file |
| submitted | start_drawing_review | SUP | review | complete submission/current references |
| review | approve_drawing | authorized approver | approved | exact revision + review basis |
| review | return_drawing | SUP | returned | comments |
| review | reject_drawing | authorized approver | rejected | reason |
| returned | resubmit_revision | originator | submitted | new immutable revision |
| approved | release_for_field_use | SUP/ADM | released_for_use | approval current/issuedFor valid |
| released_for_use | distribute_revision | ADM | released_for_use | DocumentTransmittal refs |
| released_for_use | supersede_revision | SUP/ADM | superseded | successor released revision |
| draft/submitted/approved | withdraw_revision | originator/authorized party | withdrawn | reason/impact |

## 12. Distribution Gate

fieldDistributionComplete=true only when required recipients/scopes have a delivered/received transmittal according to project rule. Distribution status does not change drawing approval status.

## 13. Exception / SLA

- superseded revision found in field use → Observation/Issue candidate
- emergency sketch/instruction → temporary source must link to SiteInstruction/RFI/Change and cannot silently become IFC drawing
- revision numbering conflict → release blocked
- approval current but linked Change revoked/superseded → construction-use readiness recalculated
- distribution overdue → notification/escalation

## 14. Completion Criteria

A revision lifecycle is complete when review disposition, field-release status, required distribution, successor/supersede relationship and audit evidence are all captured.

## 15. Backend / UI Handoff

UI separately displays Review Status, Field Release, Current Revision and Distribution. Backend calculates `currentForConstruction`; clients cannot set it directly.
