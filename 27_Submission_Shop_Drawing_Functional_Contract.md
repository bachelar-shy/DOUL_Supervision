# 27. 시공사 제출자료 · 시공상세도 Functional Contract v1.0

기준일: 2026-10-06
문서상태: Product / Functional 상세계약 v1.0
Functional ID: F-01
Functional Domain: D2 Document / Design Control, D4 Technical Coordination
대상 관리대장: 04 도면·개정, 05 문서송수신, 06 시공사 제출자료, 07 시공상세도, 필요 시 13 기술질의·14 설계변경
관련 양식: FM-01, FM-02, FM-03

---

## 1. 목적

시공사가 제출하는 시공계획서, 공법서, 시공상세도 및 기타 기술자료를 단순 파일송수신이 아니라 다음의 폐쇄형 업무로 관리한다.

> 제출 준비 → 공식 제출 → 접수 → 완전성 검토 → 기술검토 → 필요 시 협의/질의/변경 → 최종 판정 → 현장 사용 가능 여부 확정 → 배포 → 개정·대체 이력 보존

본 계약은 다음 혼동을 방지한다.

1. 파일 업로드와 공식 제출은 다르다.
2. 공식 제출과 접수는 다르다.
3. 접수와 검토 개시는 다르다.
4. 검토 완료와 승인은 다르다.
5. 승인과 설계변경 승인은 다르다.
6. 발주처 수령과 발주처 결정은 다르다.
7. 승인된 Revision과 현장 사용 중인 Revision은 버전으로 추적해야 한다.
8. 재제출은 이전 Revision을 덮어쓰지 않는다.

---

## 2. 적용범위

### 2.1 F-01에서 직접 관리하는 자료

- 시공계획서
- 공법서
- 시공상세도
- 제작도·설치도 중 Shop Drawing 성격의 자료
- 공종별 작업계획
- 품질계획·검측계획 중 일반 제출자료 성격의 자료
- 기술검토가 필요한 시공사 작성 도서
- 프로젝트별 Submittal Schedule에 등록된 일반 기술제출자료

### 2.2 다른 Functional Contract로 분리하는 자료

- 자재승인: F-02
- 시험·계측 요청과 결과: F-02
- 안전작업허가: F-03
- 공정표·Recovery Plan: F-04
- 기성·Payment Claim: F-05
- RFI: 기존 RFI Workflow
- 설계변경: 기존 Change Workflow
- 발주처 의사결정: 기존 Decision Workflow
- 법정 인허가 제출: F-09

하나의 제출 Package에 위 자료가 포함될 수는 있으나 각 업무의 공식 판정은 해당 Functional Contract를 따른다.

---

## 3. 핵심 Product Object Model

F-01은 다음 세 계층을 분리한다.

### 3.1 Submission Case — 제출 건

기능상 기준 객체는 WorkItem / ContractorSubmission이다.

Submission Case는 제출 목적, 검토경로, 기한, 책임자, Review Class를 관리한다.

같은 제출주제의 Revision들은 안정적인 Submission Series로 연결한다.

### 3.2 Submitted Information — 실제 제출 문서

실제 도면·문서 Revision은 InformationItem으로 관리한다.

대표 유형:

- Drawing
- MethodStatement
- Specification
- ChecklistTemplate
- GeneralDocument

InformationItem은 문서 자체와 Revision을 나타내며, 이미 제출·검토된 Revision을 새 파일로 덮어쓰지 않는다.

### 3.3 Approval — 특정 Revision에 대한 공식 승인

Approval은 특정 DomainRef의 정확한 버전에 대한 승인이다.

원칙:

- 승인대상 버전을 고정한다.
- 승인 이후 대상 Revision이 변경되면 기존 승인은 새 Revision에 자동 승계되지 않는다.
- 승인과 승인대상 문서의 관계를 Audit 가능한 상태로 보존한다.
- 설계변경이 필요한 경우 단순 Approval로 종료하지 않는다.

---

## 4. Submission Series와 Revision 원칙

### 4.1 Stable Series

동일한 제출주제는 submissionSeriesId로 연결한다.

예:

    SUB-ARCH-012
      ├─ Rev.0
      ├─ Rev.1
      └─ Rev.2

Series는 업무주제를 식별하고 Revision은 실제 제출·검토 단위를 식별한다.

### 4.2 Revision 불변성

공식 제출 후 해당 Revision의 파일·참조기준·제출목적을 조용히 교체하지 않는다.

수정이 필요하면:

> 기존 Revision 보존 → 새 Revision 생성 → supersedes 관계 연결 → 재제출

로 처리한다.

### 4.3 동일 Revision 충돌

같은 Submission No. + Revision으로 내용이 다른 파일이 다시 들어오면 정상 업데이트로 처리하지 않는다.

- 공식 제출 전: 작성중 Draft 교체 가능
- 공식 제출 후: Revision Conflict
- 변경파일은 새 Revision 또는 명시적 취소·재발행 절차로 처리

---

## 5. Review Class

모든 제출자료는 프로젝트 착수 시 Review Class를 지정한다.

| Review Class | 의미 | 공식 Approval | 현장 사용권한 |
|---|---|---:|---:|
| approval_required | 다음 단계 진행 또는 현장 사용 전 공식 승인 필요 | 필요 | 승인결과에 따름 |
| review_only | 기술검토는 필요하나 별도 사용승인 대상은 아님 | 원칙적으로 불필요 | 자료 성격에 따름 |
| information_only | 정보제공·기록 목적 | 불필요 | 사용승인 의미 없음 |

Review Class는 시공사가 임의 변경하지 않는다.

프로젝트 계약, 법령, 감리계획, 승인매트릭스에 따라 SUP가 확정하며 발주처 승인사항이면 OWN 조건을 반영한다.

---

## 6. Actor와 Decision Right

| 업무행위 | 기본 Actor | 비고 |
|---|---|---|
| 자료 작성 | CON | 시공사 책임 |
| 시공사 내부검토 | CON technical/quality | 감리가 대신 수행하지 않음 |
| 공식 제출 | CON | 유효한 제출권한 필요 |
| 행정 접수·등록 | ADM 또는 지정 문서관리 역할 | 기술판정 불가 |
| 완전성 검토 | SUP discipline_supervisor | 필수자료 존재와 기술검토 가능성 판단 |
| 분야 기술검토 | SUP discipline_supervisor | 본인 분야 |
| 다분야 교차검토 | 관련 SUP | 필요분야만 |
| 설계의도 확인 | DES | 설계자 권한 범위 |
| 최종 기술승인 | SUP chief_supervisor 기본 | 프로젝트 승인매트릭스가 우선 |
| 발주처 승인/결정 | OWN | 계약 또는 변경·비용·공기 등 발주처 권한사항 |
| 현장배포 | 지정 문서관리 | 승인결과를 변경할 수 없음 |

중요 원칙:

- ADM은 접수·배포를 수행할 수 있으나 기술승인을 할 수 없다.
- DES의 설계의도 확인은 DOUL 감리 기술승인과 동일한 행위가 아니다.
- OWN의 수령은 승인이나 결정과 동일하지 않다.
- 작성자와 최종 승인자는 동일인이 되지 않는 것을 원칙으로 한다.

---

## 7. Submission Revision State

Submission Revision 단위의 Product 상태는 다음을 기준으로 한다.

| 상태 | 의미 |
|---|---|
| draft | 시공사 작성 중 |
| submitted | 공식 제출 완료, 아직 접수검토 전 |
| completeness_review | 완전성 검토 중 |
| technical_review | 분야 기술검토 중 |
| coordination_review | 다분야 또는 설계자 협의 중 |
| blocked | RFI, Change, Owner Decision 등 선행결정 대기 |
| decision_pending | 필수 검토 완료, 최종 판정 대기 |
| accepted | 해당 Revision 검토 종료 및 허용결과 확정 |
| returned | 보완·재제출 필요 |
| rejected | 제출목적 또는 기술내용이 수용 불가 |
| withdrawn | 제출자가 공식 철회 |
| superseded | 더 최신의 유효 Revision으로 대체됨 |

accepted는 무조건 현장 사용허용을 의미하지 않는다. 최종 Disposition과 Review Class를 함께 본다.

---

## 8. 상태전이

| From | Command | Actor | To | 핵심 Gate |
|---|---|---|---|---|
| draft | submit | CON | submitted | 제출 Package 완전, 제출권한, Revision 유일 |
| submitted | receive | ADM/SUP | completeness_review | 공식 제출채널, 접수시각 기록 |
| completeness_review | return_incomplete | SUP | returned | 누락사유 명시 |
| completeness_review | accept_for_review | SUP | technical_review | 필수자료·기준참조 확인 |
| technical_review | request_coordination | SUP | coordination_review | 다분야/설계자 검토 필요 |
| technical_review | block_for_rfi | SUP | blocked | 기술질의 필요 |
| technical_review | block_for_change | SUP | blocked | 설계변경 검토 필요 |
| coordination_review | block_for_rfi/change | SUP | blocked | 선행결정 필요 |
| blocked | resume_review | SUP | technical_review 또는 coordination_review | 관련 RFI/Change/Decision이 유효하게 해결됨 |
| technical_review | request_final_decision | SUP | decision_pending | 필수 분야검토 완료 |
| coordination_review | request_final_decision | SUP | decision_pending | 필수 협의 완료 |
| decision_pending | accept | 권한자 | accepted | Review Class별 승인조건 충족 |
| decision_pending | return_for_revision | 권한자 | returned | 보완사유·Blocking Comment 존재 |
| decision_pending | reject | 권한자 | rejected | 거절사유 명시 |
| draft/submitted | withdraw | CON | withdrawn | 철회사유 기록 |
| accepted | supersede | SYSTEM/SUP | superseded | 대체 Revision이 유효하게 Accepted/Released |

returned 또는 rejected Revision은 내용을 덮어써 재사용하지 않는다. 재제출은 새 Revision을 만든다.

---

## 9. 공식 제출 Gate

submit 전에 최소 다음 조건을 만족한다.

### 9.1 공통

- Submission No.
- Submission Series
- Revision
- Submission Type
- Review Class
- Package
- Location
- Discipline
- Responsible Contractor Organization
- 제출 담당자
- Required By
- 제출목적
- 제출 문서의 정확한 Version Ref
- 적용 Requirement Ref
- 적용 승인도면 Base Ref
- 시공사 내부검토 완료
- 필요한 첨부파일

### 9.2 Shop Drawing 추가조건

- 기준 승인설계도면 번호와 Revision
- 관련 시방/요구사항
- 해당 위치·공종
- 주요 치수·Level
- 재료·장비 참조
- Interface 대상 공종
- 시공성 자체검토
- 간섭 자체검토
- 변경사항 표시
- 이전 Revision 대비 변경요약

---

## 10. 완전성 검토

완전성 검토는 기술승인이 아니다.

확인대상:

1. 제출번호·Revision 정합
2. 대상 공종·위치 명확성
3. 필수 첨부
4. 승인설계도면 Reference
5. Requirement Reference
6. 이전 Review Comment 반영표
7. 시공사 내부검토 흔적
8. 필요한 계산서·상세·견본·시험자료
9. 제출기한과 Required By
10. 다분야 Review 필요 여부

완전하지 않은 자료는 기술검토를 시작한 것으로 처리하지 않는다.

### 시간기준

다음 시각을 분리한다.

- submittedAt: 시공사가 공식 제출한 시각
- receivedAt: 시스템/문서관리자가 공식 접수한 시각
- acceptedForReviewAt: 완전성 검토를 통과한 시각
- reviewDueAt: 검토 회신기한

계약상 회신기한 계산은 계약조건을 우선한다.

계약·법정기한이 별도로 없을 경우 DOUL 내부 목표는 기존 기준을 유지한다.

- 일반자료: 3근무일
- 주요 공법·복합 상세도: 5근무일
- 긴급 기술자료: 1근무일

기한초과는 자동승인으로 처리하지 않는다.

---

## 11. 기술검토 Checklist

### 11.1 공통

- 계약·시방 적합
- 최신 Requirement 사용
- 최신 승인도면 기준
- 공법 적정성
- 품질관리방법
- 안전조건
- 시험·검측 연결
- 공정영향
- 타 공종 Interface
- 인허가/PCCC 영향
- 현장 실행가능성

### 11.2 Shop Drawing

FM-03의 기존 항목을 기준으로 최소 다음을 확인한다.

- Design Intent
- Dimension
- Clash
- Constructability
- Change Required

추가 Functional Rule:

- 최신 승인설계도면과 직접 비교
- 다분야 간섭이 있는 경우 필수 Reviewer를 명시
- 구조·PCCC·주요 MEP Interface는 해당 분야 Review 없이 최종 승인 금지
- 설계자의 설계의도 확인이 필요한 경우 DES Referral을 완료하기 전 최종판정 금지

---

## 12. Review Comment

Review Comment는 단순 자유메모가 아니라 추적 가능한 검토항목으로 관리한다.

최소 필드:

- commentId
- 작성자
- 작성분야
- 작성시각
- 대상 Document Ref
- Page / Detail / Location
- Category
- Blocking 여부
- Comment
- Contractor Response
- Status
- Resolved By
- Resolved At

Comment Category 기본값:

- design_intent
- code_requirement
- dimension
- coordination
- constructability
- quality
- safety
- schedule
- document_control
- other

Blocking Comment가 남아 있으면 승인 또는 현장 사용허용을 할 수 없다.

---

## 13. 최종 Disposition

프로젝트마다 외부 코드명은 달라질 수 있으므로 시스템은 의미를 Canonical Disposition으로 고정한다.

| Canonical | 의미 | useAuthorized | 재제출 |
|---|---|---:|---:|
| approved | 승인 | Yes | 불필요 |
| approved_with_comments | 비차단 의견조건 승인 | Yes | 원칙적으로 불필요 |
| revise_and_resubmit | 수정 후 재제출 | No | 필요 |
| rejected | 수용 불가 | No | 새로운 기술근거 또는 재작성 필요 |
| received_for_information | 정보수령 | No | 불필요 |

프로젝트별 A/B/C/D, Approved/Approved as Noted 등의 코드는 위 Canonical 값에 Mapping한다.

### approved_with_comments 제한

다음 사항을 포함하면 approved_with_comments로 처리하지 않는다.

- 설계의도 변경
- 구조·성능기준 변경
- 법령·인허가 영향
- PCCC 영향
- 계약금액 영향
- 공기 영향
- 주요 품질기준 변경
- 현장 시공 전 반드시 도면을 다시 수정해야 하는 Blocking 사항

이 경우 revise_and_resubmit 또는 Change/Decision 절차로 전환한다.

---

## 14. Approval과 현장 사용권한

useAuthorized는 다음 조건을 모두 만족할 때만 True가 된다.

### approval_required

- Submission Revision 상태 accepted
- Canonical Disposition = approved 또는 approved_with_comments
- 해당 정확한 Revision을 가리키는 Approval = approved
- 필수 Review 완료
- Blocking Comment = 0
- 관련 RFI / Change / Decision의 Blocking 상태 없음
- 승인대상 Base Drawing / Requirement가 Current
- Approval이 expired/revoked/superseded가 아님

### review_only

Review 완료가 필요하나 별도 사용승인을 의미하지 않는다. 현장사용 가능 여부는 자료유형의 별도 Gate를 따른다.

### information_only

accepted는 수령·기록 완료만 의미하며 현장 사용승인 효과가 없다.

---

## 15. 설계의도 확인과 RFI 분기

다음은 일반 Review Comment만으로 처리하지 않는다.

- 설계도면 간 상충
- 시방과 도면의 상충
- 설계의도 불명확
- 치수·기준레벨 불일치
- 누락된 상세
- 여러 설계대안 중 선택 필요

이 경우:

> Submission → blocked → RFI → 공식 답변 → 감리 검토 → Submission Review 재개

RFI 답변이 설계변경을 유발하면 Change로 추가 전환한다.

---

## 16. Change / Owner Decision 분기

다음 조건 중 하나라도 해당하면 시공상세도 Review만으로 승인하지 않는다.

- 승인설계 내용 변경
- 구조성능 변경
- 주요 재료·장비 성능 변경
- 품질기준 변경
- 계약금액 영향
- 공기 영향
- 인허가 영향
- PCCC 영향
- 발주처 지정사항 변경
- 계약상 발주처 승인 필요

Flow:

> Submission Review → ChangeRequest → 영향검토 → Owner Decision 필요 여부 판단 → 승인된 개정정보 발행 → Submission Review 재개 또는 새 Revision 제출

중요:

- 시공상세도 승인이 Change 승인 역할을 대신하지 않는다.
- 현장지시가 필요한 Change 승인절차를 대체하지 않는다.
- 발주처 수령이 발주처 결정으로 간주되지 않는다.

---

## 17. 다분야 Coordination Review

다분야 검토가 필요한 Submission은 requiredReviewers를 제출 시점 또는 완전성 검토 시 확정한다.

예:

- 건축 + 구조
- 건축 + MEP
- 기계 + 전기 + 제어
- 건축 + PCCC
- 구조 + 설비 매립
- 공정 Utility + Building MEP

최종판정 Gate:

- 모든 Mandatory Reviewer 완료
- 각 Review Result 보존
- 미해결 Blocking Comment 없음
- 의견 상충 시 감리단장 또는 지정 책임자가 조정
- 조정결과가 설계변경이면 Change로 전환

다수 Reviewer가 있다는 이유로 여러 개의 서로 다른 최신본을 허용하지 않는다.

---

## 18. 현장배포와 Current Released Revision

각 Submission Series 및 적용 Scope에는 Current Released Revision을 하나로 관리하는 것을 원칙으로 한다.

현장배포 시:

- Submission No.
- Revision
- 승인상태
- 승인일
- Approval Ref
- 유효 Scope
- 배포대상
- 배포시각
- 대체된 이전 Revision

을 기록한다.

새 Revision이 Released 되면 이전 Revision은 superseded로 표시한다.

현장 사용자는 기본적으로 Current Released Revision을 우선 보게 한다.

Obsolete Revision을 현장에서 사용하는 것이 확인되면:

- 작업영향 평가
- 필요 시 Issue 발행
- 재검측 또는 재시공 필요성 판단
- 중대한 영향은 즉시보고

로 연결한다.

---

## 19. Base Drawing 변경 중 Review 처리

Review 중 기준 승인도면이 변경되면 기존 Review가 자동으로 유효하다고 가정하지 않는다.

다음 절차를 따른다.

1. Base Drawing 변경 감지
2. 영향범위 판단
3. 영향 없음이 명확하면 근거를 Audit에 기록하고 계속 Review
4. 영향이 있거나 불명확하면 Submission을 blocked
5. CON이 새 Base Drawing 기준으로 Revision 제출
6. 기존 Revision과 Review Comment는 보존

승인대상 버전과 기준도면 버전은 모두 명시적으로 고정한다.

---

## 20. 재제출

returned 또는 rejected 이후 재제출은 새 Submission Revision으로 생성한다.

새 Revision은 최소 다음을 가진다.

- same submissionSeriesId
- new revision
- supersedesSubmissionRef
- revised documentRefs
- previousReviewCommentRefs
- commentResponseMatrix
- 변경요약

재제출 시 이전 Comment를 삭제하지 않는다.

각 Comment는:

- resolved
- accepted_with_explanation
- still_open
- superseded

중 하나로 추적한다.

---

## 21. 철회·취소

### CON 철회

시공사는 잘못 제출한 자료를 철회할 수 있으나 공식 제출 후 기록 자체를 삭제하지 않는다.

- withdraw reason 필수
- 관련자 통보
- 이미 현장 사용된 Revision이면 단순 철회 금지
- 대체 Revision 또는 정식 Change 필요

### SUP/OWN 취소

기술·계약상 더 이상 유효하지 않은 Submission은 취소할 수 있으나 기존 승인·검토·배포 이력은 보존한다.

---

## 22. Owner Reporting Trigger

다음은 F-01 내부에서만 처리하지 않고 Owner Governance로 연결한다.

- Critical Path에 영향을 주는 제출지연
- 주요 공법 승인 지연
- 주요 Shop Drawing 장기 미결
- 반복 재제출
- 주요 설계오류 발견
- 승인설계 변경 필요
- 계약금액 영향
- 공기 영향
- 인허가/PCCC 영향
- 발주처 지정사항 또는 승인사항
- 무승인 도면 시공으로 중대한 영향 발생

Owner Report 또는 Decision 생성 이후에도 원 Submission과 양방향 참조를 유지한다.

---

## 23. Notification / SLA

최소 알림:

- Submission received
- Completeness review due
- Technical review due
- Reviewer overdue
- Returned / rejected
- Owner/Designer referral overdue
- RFI/Change blocker resolved
- Approval issued
- Revision superseded
- Required By 임박
- 현장배포 필요

알림은 업무상태를 바꾸지 않는다.

기한초과는 자동 승인, 자동 반려, 자동 종결로 연결하지 않는다.

---

## 24. Audit Requirement

다음 사건은 공식 Audit Event로 남긴다.

- Submit
- Receive
- Completeness Accept/Return
- Reviewer Assignment
- Review Comment 발행·해결
- Designer Referral
- RFI/Change Routing
- Final Disposition
- Approval
- Owner Decision 연결
- Release for Use
- Distribution
- Withdrawal
- Supersede

각 Audit은 최소:

- Actor
- Role
- At
- Object Ref / Version
- Command
- Before / After
- Reason
- 관련 Evidence / Ref

를 보존한다.

---

## 25. Register Projection

### 04 도면·개정

보여줄 것:

- Drawing No.
- Revision
- Status
- Current Released Revision
- Superseded Revision
- Approval Ref
- Change Ref
- Distribution

04는 도면 자체의 Version Control이 중심이며 Submission Workflow의 상태원장이 아니다.

### 05 문서송수신

보여줄 것:

- Official Transmittal
- Sender / Recipient
- Sent At / Received At
- Document Refs
- Receipt Evidence

F-01에서는 공식 제출·접수시각의 출처로 사용한다. 문서송수신 전체 Functional 상세는 F-14에서 별도 정의한다.

### 06 시공사 제출자료

보여줄 것:

- Submission Series / Revision
- Type
- Review Class
- Status
- Submitted / Received / Accepted for Review
- Review Due
- Current Reviewer
- Final Disposition
- Approval Ref
- Required By
- Blocker
- Latest Valid Revision

### 07 시공상세도

보여줄 것:

- Shop Drawing No. / Revision
- Base Design Drawing Ref
- Current Review State
- Coordination Review
- Design Intent Referral
- Change Required
- Final Disposition
- useAuthorized
- Current Released Revision
- Superseded By

Register에서 독자적인 상태를 만들지 않고 Domain/Workflow를 Projection한다.

---

## 26. Form Mapping

### FM-01 시공사 제출자료 표지

역할:
- Submission Package 식별
- 포함문서 목록
- 제출/필요일
- Review 상태의 공식 출력

추가로 Functional 수준에서 필요한 필드:

- submissionSeriesId
- revision
- reviewClass
- receivedAt
- acceptedForReviewAt
- finalDisposition
- blockerRefs
- supersedesSubmissionRef

### FM-02 시공계획 검토서

기존 Review Dimension:

- Design
- Method
- Quality
- Safety
- Schedule

추가 원칙:

- Review Conclusion은 Canonical Disposition에 Mapping
- 승인조건이 Blocking인지 Non-blocking인지 구분
- 주요 안전조건이 있으면 F-03과 연결
- 설계변경이면 F-01에서 직접 승인하지 않음

### FM-03 시공상세도 검토서

기존 Review Dimension:

- Intent
- Dimension
- Clash
- Constructability
- Change Required

추가 Functional 필드:

- exact baseDrawingRefs
- mandatoryReviewerResults
- designerReferralRef
- rfiRefs
- changeRefs
- canonicalDisposition
- approvalRef
- useAuthorized
- releasedAt
- supersededByRef

양식은 상태원장이 아니라 확정된 Domain Data의 Snapshot이다.

---

## 27. Functional Inventory

| ID | Function | Primary Actor | Trigger | 완료조건 |
|---|---|---|---|---|
| F01-01 | Submission Series 생성 | CON | 제출계획 발생 | Series ID와 Review Class 확정 |
| F01-02 | Revision 작성·제출 | CON | 제출자료 준비 완료 | submitted + 정확한 Document Ref |
| F01-03 | 공식 접수 | ADM/SUP | 제출 도착 | receivedAt 기록 |
| F01-04 | 완전성 검토 | SUP | 공식 접수 | accept_for_review 또는 returned |
| F01-05 | 분야 기술검토 | SUP | 완전성 통과 | Review Result와 Comment 확정 |
| F01-06 | 다분야/설계자 협의 | SUP/DES | Coordination 필요 | Mandatory Review 완료 |
| F01-07 | RFI / Change Routing | SUP | 불명확·변경 필요 | 관련 Workflow 생성 및 blocker 연결 |
| F01-08 | 최종 판정 | 권한자 | 필수 Review 완료 | Canonical Disposition 확정 |
| F01-09 | 공식 Approval | SUP/OWN | approval_required | 정확한 Revision Approval 확정 |
| F01-10 | 현장 사용 Release | SUP/문서관리 | 사용허용조건 충족 | Current Released Revision 확정·배포 |
| F01-11 | 재제출 | CON | returned/rejected | 새 Revision 생성 및 이전이력 연결 |
| F01-12 | Supersede | SYSTEM/SUP | 새 Released Revision 발생 | 구 Revision 사용차단 및 이력 유지 |

---

## 28. Completion Criteria

하나의 Submission Revision은 다음 중 하나일 때 완료된다.

### Accepted Completion

- 필수 검토 완료
- Canonical Disposition 확정
- 승인대상이면 Approval 완료
- 모든 Blocking Comment 해결
- RFI / Change / Decision Blocking 없음
- 정확한 대상 Revision 기록
- 필요한 Document Snapshot 생성

### Returned / Rejected Completion

- 반환/거절 사유 기록
- Comment 기록
- 현장 사용 불가 명시
- 필요 시 재제출 요구
- 이전 Review 결과 보존

### Series Completion

Submission Series 자체는 다음 조건에서 종결 가능하다.

- 더 이상 제출이 필요하지 않음
- 최신 필요한 Revision이 Accepted
- 사용승인 대상이면 Current Released Revision 존재
- 미해결 Blocking Comment 없음
- 관련 Change/RFI가 종결 또는 적법하게 이관됨
- 준공기록 대상이면 최종 Revision이 Handover 자료에 연결됨

---

## 29. Backend Handoff Contract

Backend는 F-01을 구현할 때 업무의 의미를 변경하지 않는다.

최소 지원해야 할 개념:

- ContractorSubmission
- submissionSeriesId
- immutable submitted Revision
- exact documentRefs
- Review Class
- requiredReviewer roles
- Review Comment
- Canonical Disposition
- Approval target version
- blockerRefs
- RFI / Change / Decision linkage
- useAuthorized
- Current Released Revision
- supersedes / supersededBy
- SLA timestamps
- Audit

현재 generic WorkItem.data로 임시 표현할 수 있더라도 Product 계약상 필드 의미는 고정한다.

State Machine 또는 Schema 변경이 필요하면 Backend에서 임의로 축약하지 않고 Product / Functional 변경요청으로 올린다.

---

## 30. UI Handoff Contract

UI는 다음을 사용자에게 명확히 구분해 보여야 한다.

- 작성 중
- 공식 제출됨
- 완전성 검토 중
- 기술검토 중
- 협의 중
- 선행결정 대기
- 최종판정 대기
- 승인됨
- 승인됨 + 비차단 의견
- 수정 후 재제출
- 반려
- 현장 사용가능
- 대체됨

특히 색상이나 Badge만으로 Approval과 useAuthorized를 같은 의미로 표현하지 않는다.

현장 사용자는 Current Released Revision을 가장 우선적으로 확인할 수 있어야 한다.

---

## 31. Product Validation Scenarios

### Scenario A — 정상 시공상세도

CON 제출 → 완전성 통과 → 분야검토 → 간섭검토 → Approval → Release → 현장 사용

기대:
- 제출 Revision과 승인 Revision 일치
- Current Released Revision 1개
- 이전 Revision 사용불가

### Scenario B — 누락자료

CON 제출 → 완전성 검토 → returned

기대:
- 기술검토 시작 전 반환
- 반환사유 기록
- 새 Revision으로 재제출

### Scenario C — 설계의도 불명확

Submission Review → RFI → 답변 → Review 재개

기대:
- RFI 답변 전 사용승인 금지
- 답변 Version 보존

### Scenario D — 설계변경 필요

Shop Drawing Review → ChangeRequest → 영향검토 → Owner Decision → 개정설계 → 새 Shop Drawing Revision

기대:
- 기존 Shop Drawing을 임시 승인해 Change를 우회하지 않음

### Scenario E — Review 중 Base Drawing 변경

Review 진행 → Base Drawing 새 Revision 발행 → 영향 있음 → blocked → 새 Revision 제출

기대:
- 이전 Review 흔적 보존
- 구 기준도면에 대한 Approval을 새 Revision에 승계하지 않음

### Scenario F — Approved with Comments

비차단 Comment만 존재 → approved_with_comments → Release

기대:
- 설계변경·법규·비용·공기 영향을 B 조건으로 숨기지 않음

### Scenario G — 무승인 도면 사용

현장에서 obsolete/unreleased Revision 발견

기대:
- 영향평가
- 필요 시 Issue/재검측
- 중대 시 Owner Immediate Report

---

## 32. F-01 완료판정

F-01 Product / Functional Design은 다음을 정의했으므로 M3로 평가한다.

- Actor
- Trigger
- State
- Command
- Gate
- Review Class
- Approval 기준
- Revision 불변성
- RFI/Change/Decision 분기
- 다분야 Review
- SLA
- Evidence / Audit
- Register Projection
- Form Mapping
- Completion Criteria
- Backend/UI Handoff

다음 Product 상세설계는 F-02 자재승인 / 반입 / 시험 연계로 진행한다.
