# 44. Daily Record / Evidence Functional Contract v1.0

기준일: 2026-10-06
Functional ID: F-17
대상 관리대장: 23 일일기록·사진증빙
관련 양식: FM-18

## 1. 목적
일일 감리기록을 Evidence collection→review→sign/freeze→revision 방식으로 관리한다.

## 2. Object
InformationItem / DailyRecord.

필드: recordDate, shift, weather, workforce/equipment summary, workActivities, inspectionRefs, issueRefs, safetyRefs, delayRefs, visitor/meetingRefs, evidenceRefs, analysisRunRefs, preparedBy, reviewedBy, signedAt, sourceVersion.

## 3. State
draft → evidence_collecting → submitted → review → signed → frozen → corrected_by_revision / superseded.

## 4. Gate
- recordDate/shift
- responsible author
- required work/location coverage
- referenced Inspection/Issue consistency
- media original availability
- missing evidence 표시
- signature/review

## 5. AI/Media Boundary
AI Observation/Transcript는 후보정보다. SUP 검토 없이 일일기록의 공식 기술판정으로 승격하지 않는다. 원본/파생 Evidence와 grounding을 유지한다.

## 6. Correction
frozen DailyRecord는 직접수정하지 않고 새 revision + correction reason으로 정정한다.

## 7. FM-18
DailyRecord의 사람이 읽는 Snapshot. 원본 Evidence와 exact refs를 보존한다.

## 8. 완료판정
관리대장 23은 M3.

## 9. Actor / Decision Right

- field SUP: daily record preparation
- discipline/chief SUP: review/sign according to project rule
- CON/DES/OWN: source data provider or acknowledgement only when required
- AI: extraction/candidate summary only
- ADM: document control after freeze

## 10. Command Contract

| From | Command | Actor | To | Gate |
|---|---|---|---|---|
| draft | start_evidence_collection | SUP | evidence_collecting | date/shift/author |
| evidence_collecting | attach_daily_evidence | SUP/INTEGRATION | evidence_collecting | source metadata/original preserved |
| evidence_collecting | submit_daily_record | SUP | submitted | required coverage/missing fields declared |
| submitted | start_daily_review | reviewer | review | source refs available |
| review | return_daily_record | reviewer | evidence_collecting | correction request |
| review | sign_daily_record | authorized reviewer | signed | reviewed content/source version |
| signed | freeze_daily_record | SYSTEM/ADM | frozen | signature/snapshot complete |
| frozen | create_corrected_revision | SUP | corrected_by_revision | correction reason + predecessor ref |
| corrected_by_revision | submit_daily_record | SUP | submitted | new immutable revision |
| frozen | supersede_daily_record | authorized reviewer | superseded | replacement revision ref |

## 11. Coverage / Missing-data Gate

Required sections are project-configured. Missing information must be explicit (`null`/unavailable + reason) rather than inferred. Media coverage gaps, unknown weather/workforce quantities, or unconfirmed AI observations must not be silently converted into facts.

## 12. Exception / SLA

- daily record due/missed → overdue alert
- late evidence → attach to corrected revision, not mutate frozen snapshot
- conflicting source facts → reviewer resolution or explicit unresolved note
- media processing failure → original evidence remains usable and AnalysisRun failure recorded
- signature unavailable → record cannot freeze as final unless project fallback rule exists

## 13. Completion Criteria

- date/shift/project scope fixed
- required sections completed or explicitly unavailable
- source Evidence and domain refs linked
- AI-derived facts human-reviewed when used
- reviewer/signature complete
- frozen snapshot/source version preserved

## 14. Backend / UI Handoff

Backend prevents mutation of frozen DailyRecord and preserves revision chain. UI distinguishes raw Evidence, AI Candidate, reviewed DailyRecord content and signed/frozen status.
