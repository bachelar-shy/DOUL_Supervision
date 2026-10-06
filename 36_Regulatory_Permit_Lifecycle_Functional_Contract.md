# 36. Regulatory Permit Lifecycle Functional Contract v1.0

기준일: 2026-10-06
Functional ID: F-09
대상 관리대장: 01 법령·인허가
관련 양식: FM-30

## 1. 목적
Requirement 기반으로 적용성→제출→보완→승인→조건관리→변경/갱신→종결을 추적한다.

핵심 원칙:
- 적용성 판단 근거와 법령/계약 version을 보존한다.
- 제출 ≠ 승인, 승인 ≠ 영구유효.
- 승인 Scope 밖 변경은 재검토한다.
- statutory original은 원형 보존한다.
- not_applicable은 근거와 결정권자가 필요하다.

## 2. Object
WorkItem / RegulatoryPermit

최소 데이터: permitNo, authority, requirementRefs, basisVersion, scope, location, submissionRefs, responseRefs, conditions, validFrom, validTo, modificationTriggerRefs, renewalDueAt, approvalRef, ownerReportRefs.

## 3. State
applicability_review → planned → preparing → submitted → authority_review → supplement_required → approved → effective → modification_required / renewal_due → renewed / superseded → expired / closed / not_applicable

## 4. Gate
- exact Requirement/basis
- authority/jurisdiction
- submission package completeness
- official receipt evidence
- supplement deadline
- approval exact scope/version
- conditions and validity
- change impact
- renewal requirement

## 5. Change Impact
설계·용도·면적·시스템·공정조건 등 변경이 Permit Scope에 영향을 줄 수 있으면 modification_required 후보를 생성한다. 시스템이 임의로 “변경신고만으로 가능” 등 법적 결론을 내리지 않는다.

## 6. Owner Reporting
Critical permit delay, approval condition, rejection, expiry, major design/schedule impact는 Owner Report/Decision에 연결한다.

## 7. Register 01
applicability, current stage, submission/response, approval, conditions, expiry, renewal, change impact, owner decision, blockedReasons를 표시한다.

## 8. FM-30
인허가 적용성·상태 검토서. 법정 신청서를 대체하지 않는다.

## 9. Validation
- submission only → approved 아님
- expired approval → effective 아님
- change impact 발견 → 기존 승인 자동유지 금지
- not_applicable → 근거 필수

## 10. 완료판정
관리대장 01은 M3.

## 11. Actor / Decision Right

| 행위 | Actor | 권한경계 |
|---|---|---|
| 적용 Requirement 후보등록 | ADM/SUP | ADM은 등록만, SUP가 업무적 적용성 검토 |
| 적용성 확인 | SUP/chief_supervisor | 법적 최종해석이 필요한 경우 AUTHORITY/법률검토 우선 |
| 제출자료 작성 | CON/DES/OWN according to requirement | 제출주체는 Requirement가 결정 |
| 공식 제출 | authorized submitting party | 제출권한과 수신기관 확인 |
| 보완 대응 | responsible party + SUP coordination | 원 요구/response version 유지 |
| 승인·허가 결과 등록 | ADM/SUP | 외부 결정을 기록하는 것이며 내부가 승인 생성하지 않음 |
| 변경/갱신 필요판정 | SUP | 변경내용과 기존 approval scope 비교 |
| 주요 일정/비용 결정 | OWN | 보고/Decision workflow 사용 |

## 12. Command Contract

| From | Command | Actor | To | Gate |
|---|---|---|---|---|
| applicability_review | confirm_applicable | SUP | planned | basis/scope/authority |
| applicability_review | mark_not_applicable | chief_supervisor | not_applicable | reason + reviewed basis |
| planned | start_preparation | responsible party | preparing | package owner/due |
| preparing | submit_permit | authorized party | submitted | exact submission package |
| submitted | record_authority_receipt | SUP/ADM | authority_review | receipt/date/ref |
| authority_review | record_supplement_request | SUP/ADM | supplement_required | official request/due |
| supplement_required | submit_supplement | authorized party | authority_review | exact supplement version |
| authority_review | record_approval | SUP/ADM | approved | official approval evidence/scope |
| approved | activate_permit | SUP | effective | validity/conditions current |
| effective | require_modification | SUP | modification_required | change impact evidence |
| effective | require_renewal | SYSTEM/SUP | renewal_due | validity threshold |
| modification_required | submit_modification | authorized party | authority_review | modified package |
| renewal_due | submit_renewal | authorized party | authority_review | renewal package |
| effective | record_expiry | SYSTEM | expired | validTo elapsed |
| effective/renewed | close_permit_case | SUP | closed | no remaining obligation |

## 13. Exception / SLA

기한 항목:
- preparation due
- authority response follow-up
- supplement due
- approval condition due
- renewal warning/due

예외:
- authority jurisdiction unclear → `authority_confirmation_required`
- inconsistent legal/contract requirements → `basis_conflict`
- approval condition incompatible with design → Change/Owner Decision
- work proceeds outside permit scope → Compliance Issue + immediate escalation

SLA 초과는 법정 결과를 자동 추론하지 않는다.

## 14. Evidence / Audit

모든 단계는 exact Requirement version, submitted package hash/version, authority response original, actor/time을 남긴다. 공식 원본을 수정하지 않는다.

## 15. Completion Criteria

- applicability resolved
- submission/approval history complete
- current conditions/validity captured
- modification/renewal obligations resolved or transferred
- critical Owner follow-up closed
- final source versions preserved

## 16. Backend / UI Handoff

UI는 `submitted / authority review / approved / effective / expired`를 별도 표시한다. Backend는 client가 status를 직접 patch하지 못하게 하고 command + expectedVersion으로만 전이시킨다.
