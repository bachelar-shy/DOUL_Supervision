# 42. Personnel Qualification / Deployment Functional Contract v1.0

기준일: 2026-10-06
Functional ID: F-15
대상 관리대장: 03 인력·자격
관련 양식: FM-35

## 1. 목적
인력배치를 단순 명단이 아니라 요청→자격검증→승인→배치→만료/대체→철수로 관리한다.

## 2. Objects
Party, RoleAssignment, Qualification + WorkItem / PersonnelDeployment.

필드: role, party, organization, qualificationRefs, requiredExperience, requestedFrom/To, workScope, approvalRef, deployedAt, suspendedAt, replacementRef, demobilizedAt.

## 3. State
requested → qualification_review → availability_review → approval_pending → approved → deployed → suspended / replacement_required → replaced / demobilized → closed / rejected / expired.

## 4. Gate
- 요구 Role/자격
- 자격 유효기간
- 경력/교육 요구
- 조직소속
- 동시배치 제한 if applicable
- project approval
- replacement handover

## 5. Expiry
Qualification 만료 시 해당 RoleAssignment/Permit/Inspection authority를 재평가한다. 과거 서명은 소급무효화하지 않는다.

## 6. FM-35
인력·자격 배치 검토서.

## 7. 완료판정
관리대장 03은 M3.

## 8. Actor / Decision Right

- CON/SUP organization manager: deployment request
- ADM/HR support: identity/document registration only
- SUP/chief/OWN depending on contract: qualification/deployment approval
- individual: evidence of qualification/training
- SYSTEM: expiry/availability warning only

Technical authority becomes active only when approved RoleAssignment/Qualification/Project Scope are all current.

## 9. Command Contract

| From | Command | Actor | To | Gate |
|---|---|---|---|---|
| - | request_deployment | organization | requested | person/role/scope/period |
| requested | start_qualification_review | SUP/ADM | qualification_review | qualification documents |
| qualification_review | confirm_qualification | authorized reviewer | availability_review | validity/scope/experience |
| qualification_review | reject_qualification | authorized reviewer | rejected | reason |
| availability_review | request_deployment_approval | SUP | approval_pending | conflict/availability checked |
| approval_pending | approve_deployment | authorized approver | approved | exact role/scope/period |
| approved | start_deployment | SUP/ADM | deployed | start date/role assignment active |
| deployed | suspend_deployment | authorized SUP/chief | suspended | reason/effective time |
| deployed | require_replacement | SUP/chief | replacement_required | expiry/absence/performance/contract rule |
| replacement_required | approve_replacement | authorized approver | replaced | successor ref/handover |
| deployed/replaced | demobilize | organization/SUP | demobilized | end date/handover |
| demobilized/replaced | close_deployment | SUP/ADM | closed | authority removed/audit complete |
| any active | record_qualification_expiry | SYSTEM | expired/suspended | qualification validTo |

## 10. Exception / SLA

- qualification document unverified → deployment blocked
- certificate expires during active assignment → future authority suspended/reassessed
- emergency replacement → temporary assignment only if project/legal rule explicitly permits
- duplicate/conflicting assignment → availability review failure
- replacement without handover → close blocked for critical role

## 11. Completion Criteria

- identity/organization/role/scope fixed
- qualifications verified and versioned
- approval decision retained
- deployed period captured
- replacement/demobilization and handover complete
- active technical permissions removed at end

## 12. Backend / UI Handoff

Authorization checks must resolve live RoleAssignment + Qualification + project scope, not only cached UI role labels. Historical actions retain the authority context that existed at signing time.
