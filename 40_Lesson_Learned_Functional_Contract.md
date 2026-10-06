# 40. Lesson Learned Functional Contract v1.0

기준일: 2026-10-06
Functional ID: F-13
대상 관리대장: 29 경험·교훈
관련 양식: FM-33

## 1. 목적
경험을 메모로 끝내지 않고 검토→채택→표준/체크리스트 반영→효과검증으로 연결한다.

## 2. Object
기존 WorkItem / Lesson.
필드: sourceRefs, problemOrOpportunity, context, rootCause, lessonStatement, applicability, proposedStandardChange, decisionRef, implementationRefs, effectivenessMetric, reviewDate.

## 3. State
candidate → review → validated → decision_pending → adopted / rejected → implementation_pending → implemented → effectiveness_review → closed / revise_required.

## 4. Gate
- Evidence/source traceability
- 프로젝트 특수조건과 일반화 가능한 교훈 분리
- 개인 추정과 검증사실 분리
- 채택 권한
- 표준/Requirement/Checklist 변경 exact version
- 효과측정

## 5. Standard Change
Lesson 채택 ≠ 표준 즉시 변경. Requirement/Checklist/Template 변경은 별도 승인과 versioning을 거친다.

## 6. FM-33
경험·교훈 검토서: source, context, lesson, applicability, standard change, decision, effectiveness.

## 7. 완료판정
관리대장 29는 M3.

## 8. Actor / Decision Right

- candidate: SUP/CON/OWN/DES/ADM/AI candidate source possible
- validation: SUP/QA/subject-matter reviewer
- adoption decision: designated DOUL/Product/Project governance authority
- standard change approval: owner of affected Requirement/Checklist/Template
- effectiveness review: independent or responsible reviewer defined by change governance

AI may suggest a Lesson candidate but cannot adopt or change a standard.

## 9. Command Contract

| From | Command | Actor | To | Gate |
|---|---|---|---|---|
| - | create_lesson_candidate | human/AI candidate | candidate | source/context |
| candidate | start_lesson_review | SUP/QA | review | reviewer assigned |
| review | validate_lesson | reviewer | validated | evidence/root cause/applicability |
| validated | request_adoption_decision | SUP/QA | decision_pending | proposed change/benefit |
| decision_pending | adopt_lesson | authorized authority | adopted | Decision ref |
| decision_pending | reject_lesson | authorized authority | rejected | reason |
| adopted | start_implementation | owner | implementation_pending | target standards/actions |
| implementation_pending | record_implementation | owner | implemented | exact changed versions |
| implemented | start_effectiveness_review | reviewer | effectiveness_review | metric/review period |
| effectiveness_review | confirm_effective | reviewer | closed | result evidence |
| effectiveness_review | require_revision | reviewer | revise_required | gap/next action |
| revise_required | revise_lesson | owner | review | revised candidate |

## 10. Exception / SLA

- project-specific fact cannot be generalized → retain as project lesson, no corporate standard change
- conflicting lessons → decision comparison required
- standard owner rejects proposed change → Lesson can close as documented but not “implemented”
- no measurable effectiveness available → qualitative review method must be declared

## 11. Completion Criteria / Handoff

Close requires Decision outcome, exact implementation refs if adopted, and effectiveness assessment. UI distinguishes candidate, adopted and implemented; Backend never mutates Requirement/Template merely because Lesson status changes.
