# 28. 자재승인 · 반입검사 · 시험 Functional Contract v1.0

기준일: 2026-10-06
문서상태: Product / Functional 상세계약 v1.0
Functional ID: F-02
Functional Domain: D2 Document / Design Control, D3 Field Quality Control
대상 관리대장: 08 자재승인, 09 자재반입검사, 10 시험·계측
관련 양식: FM-04, FM-05, FM-06

---

## 1. 목적

자재를 단순히 “승인됨/미승인”으로 관리하지 않고 다음 세 단계를 분리하여 추적한다.

> 자재 사양 승인 → 실제 반입 Lot 확인 → 필수 시험/검증 → 사용 Release

핵심 원칙은 다음과 같다.

1. 자재승인은 제품 사양과 승인조건에 대한 판정이다.
2. 자재승인만으로 모든 반입 Lot의 사용이 자동 허용되지 않는다.
3. 반입검사는 승인된 제품과 실제 반입품이 일치하는지 확인하는 별도 업무다.
4. 시험성적서·인증서는 Evidence이며 감리의 공식 판정 자체가 아니다.
5. 제조사 성적서와 현장/독립 시험은 동일한 의미가 아니다.
6. 필수 시험은 ITP와 Requirement가 정한 시점과 빈도를 따른다.
7. 재시험 합격은 최초 불합격 기록을 삭제하거나 무효화하지 않는다.
8. 시험기관은 결과의 Source Party이며 감리의 공식 기술판정 권한을 갖지 않는다.
9. 사용 가능 여부는 Material Approval, Material Lot Inspection, Test Gate, Issue 상태를 함께 계산한다.

---

## 2. 적용범위

### 2.1 자재·제품

- 철근, 강재, 콘크리트 구성재
- 방수·단열재
- 마감재
- 창호·커튼월 구성품
- 소방자재
- 배관·덕트·밸브
- 전선·케이블·트레이
- 기계·전기 장비 중 자재승인 대상
- 기타 계약·시방·법령·ITP가 사전승인을 요구하는 재료·제품

### 2.2 F-02의 직접 범위

- Material Submittal
- 제품·제조사·모델·규격 검토
- 인증·시험성적·견본·Mock-up
- 동등성/대체품 검토
- 자재 Approval
- 반입 Lot 식별
- 반입검사
- Sampling
- Test Request
- 시험기관·장비·방법 확인
- 시험결과
- Retest
- Material Issue / NCR 연결
- 사용 Release

### 2.3 별도 기능과 연결

- 일반 제출자료: F-01
- 현장 작업 검측: Inspection Workflow
- 부적합·시정: Issue + Action + Reinspection
- 설계변경/대체품: Change Workflow
- 발주처 결정: Decision Workflow
- 안전장비 사용허가: F-03
- PCCC 법정시험: F-06
- 준공 성능시험: F-07

---

## 3. Product Object Model

### 3.1 Material Master

기능상 기준 객체는 Asset / Material이다.

Material Master는 “무엇이 승인대상인가”를 식별한다.

최소 식별정보:

- materialId
- materialName
- discipline
- specificationRef
- requirementRefs
- intendedUse
- intendedLocations
- criticality
- approvalRequired
- requiredTestPlanRefs

Material Master는 실제 반입 Lot과 동일한 객체가 아니다.

### 3.2 Material Submittal

WorkItem / MaterialSubmittal은 승인 요청 업무를 관리한다.

최소 정보:

- materialSubmittalNo
- revision
- materialRef
- manufacturer
- brand
- model/type
- country/origin if required
- technicalSpecification
- performanceData
- certificateRefs
- testReportRefs
- sampleRefs
- mockupRefs
- proposedLocations
- equivalenceClaim
- substitutionReason
- requestedApprovalScope
- submittedAt
- requiredBy

### 3.3 Material Approval

Approval은 정확한 Material Submittal Revision 또는 Material Ref의 Version을 대상으로 한다.

승인은 다음을 고정한다.

- 승인 제조사
- 승인 브랜드/모델
- 승인 규격/등급
- 승인 성능
- 승인 색상/마감/견본
- 승인 적용 Scope
- 승인 조건
- 유효기간 또는 인증 유효조건
- 승인된 Revision
- 관련 Requirement Version

새 Revision, 제조사 변경, 모델 변경, 성능 변경은 기존 승인에 자동 포함되지 않는다.

### 3.4 Material Lot

Asset / MaterialLot은 실제 현장에 반입된 물량 단위다.

Lot은 최소 다음을 식별한다.

- materialLotId
- materialRef
- materialApprovalRef
- manufacturer
- supplier
- brand/model
- batch/heat/lot/serial
- productionDate if applicable
- expiryDate if applicable
- quantity/unit
- deliveryDate
- deliveryNoteRef
- certificateRefs
- storageLocation
- intendedUseLocation
- receivingEvidenceIds

Lot은 승인된 Material Master와 별도로 추적한다.

### 3.5 Sample

Sample은 시험대상 시료의 추적 단위다.

기능상 별도 Sample ID를 가진다.

최소 정보:

- sampleId
- sourceMaterialLotRef
- sourceLocation
- sampledAt
- sampledBy
- witnessPartyIds
- sampleQuantity
- samplingMethod
- testRequirementRef
- seal/tag
- chainOfCustody
- destinationLab

### 3.6 Test Request / Test Result

WorkItem / TestRequest는 시험 업무 요청·추적 단위다.

시험보고서 원본은 Evidence 또는 InformationItem / Certificate로 보존한다.

---

## 4. 전체 Functional Flow

~~~text
Material Requirement
        ↓
Material Submittal
        ↓
Completeness Review
        ↓
Technical Review
        ↓
Sample / Mock-up / Pre-approval Test if required
        ↓
Material Approval
        ↓
Delivery / Material Lot
        ↓
Receiving Inspection
        ↓
Sampling / Test if required
        ↓
Test Result Review
        ↓
 ┌─────────────┬───────────────┐
 PASS        PENDING          FAIL
  │             │               │
Release      Hold/Quarantine   Material Issue/NCR
  │             │               ↓
  │             │          Corrective Action
  │             │               ↓
  │             │        Retest if legitimately allowed
  │             │               ↓
  └─────────────┴────────→ Technical Verification
                              ↓
                         Release / Reject
~~~

---

## 5. Material Approval State

Material Submittal의 Product 상태는 다음을 기준으로 한다.

| 상태 | 의미 |
|---|---|
| draft | 시공사 작성 중 |
| submitted | 공식 승인요청 제출 |
| completeness_review | 필수자료 확인 중 |
| technical_review | 기술검토 중 |
| sample_pending | 견본·Mock-up 확인 대기 |
| test_pending | 승인 전 시험결과 대기 |
| coordination_review | 설계자/타분야/발주처 검토 중 |
| decision_pending | 최종 승인판정 대기 |
| approved | 해당 Revision 승인 |
| approved_with_conditions | 비차단 조건부 승인 |
| returned | 보완·재제출 필요 |
| rejected | 수용 불가 |
| withdrawn | 철회 |
| superseded | 새 승인으로 대체 |
| revoked | 기존 승인 취소 |
| expired | 유효조건 만료 |

Approval Domain 상태와 Material Submittal Product 상태를 혼동하지 않는다.

---

## 6. 자재승인 제출 Gate

자재승인 요청 전에 최소 다음을 확인한다.

### 공통

- Material Name
- Manufacturer
- Brand / Model / Grade
- Technical Specification
- 적용 시방·Requirement
- 적용 위치/공종
- 제출 Revision
- 제출자와 책임 시공사
- Required By
- 제품 Data Sheet

### 필요 시

- Certificate of Conformity
- Certificate of Origin / Quality
- Type Test
- Factory Test
- 인증서
- 시험성적서
- Sample
- Color / Finish Sample
- Mock-up
- 설치방법
- 유지관리자료
- Warranty
- 동등성 비교표
- 대체사유
- 관련 승인도면

필수자료가 없으면 기술검토를 시작하지 않고 returned 처리한다.

---

## 7. 자재 기술검토

FM-04 기존 Review Dimension을 기준으로 최소 다음을 검토한다.

- Specification 적합
- Certificate 유효성
- Sample 적합
- Equivalence 적합

추가 확인:

- 성능기준
- 제조사와 모델
- 시험기준
- 법정인증
- 품질관리체계
- 설치조건
- 시방 상 지정사항
- 타 시스템 Interface
- 유지관리 요구
- Warranty
- PCCC/인허가 영향
- 발주처 지정자재 여부

---

## 8. Sample / Mock-up

Sample 또는 Mock-up이 승인조건이면 사진만으로 대체하지 않는다.

승인 Sample은 최소 다음을 가진다.

- sampleId
- materialSubmittalRef
- 실제 샘플 식별 Tag
- 사진 Evidence
- 색상/마감/질감
- 승인자
- 승인일
- 적용 Scope
- 보관위치 또는 반환상태

향후 반입검사와 설치검수에서 Approved Sample을 Benchmark로 사용한다.

Sample 변경은 기존 승인에 자동 포함되지 않는다.

---

## 9. 동등품·대체품

“동등품” 주장은 자동 승인근거가 아니다.

최소 비교대상:

- 규격
- 성능
- 내구성
- 인증
- 제조사
- 품질관리
- 설치조건
- 유지관리
- Warranty
- 디자인/색상/마감
- 비용
- 공기
- 인허가/PCCC 영향

다음은 Change / Owner Decision으로 전환한다.

- 지정자재 변경
- 성능기준 변경
- 설계의도 변경
- 계약금액 영향
- 공기 영향
- 인허가/PCCC 영향
- 발주처 승인사항 변경

Material Approval로 설계변경 또는 계약변경을 우회하지 않는다.

---

## 10. Material Approval 결과

Canonical Disposition:

| 결과 | 의미 | 반입 허용 | 사용 허용 |
|---|---|---:|---:|
| approved | 사양 승인 | Yes | 별도 Lot Gate 필요 |
| approved_with_conditions | 비차단 조건 포함 승인 | 조건에 따라 | 별도 Lot Gate 필요 |
| revise_and_resubmit | 수정 후 재제출 | No | No |
| rejected | 수용 불가 | No | No |

Material Approval은 “반입 가능 여부”의 선행조건이며 최종 사용허용이 아니다.

---

## 11. Approved Material Identity

현장 반입 시 최소 다음 항목이 승인정보와 일치해야 한다.

- Material
- Manufacturer
- Brand
- Model / Type
- Grade
- Size
- Performance Class
- Color / Finish where applicable
- Country/Factory if contractually controlled
- Certificate applicability
- Approval Revision
- Scope / Location restrictions

승인 범위를 벗어나면 approvalMatch = false다.

---

## 12. Material Lot 생성

각 반입 Lot은 가능한 한 실제 공급·제조 추적단위와 일치하도록 생성한다.

서로 다른 Batch / Heat / Manufacturing Lot을 근거 없이 하나의 Lot으로 합치지 않는다.

반입 시 최소 Evidence:

- Delivery Note
- Packing List if applicable
- Manufacturer Label
- Batch / Heat / Lot / Serial
- Quantity
- 사진
- 인증서/성적서
- 보관상태
- 손상 여부

중요자재는 현장검사 완료 전 기본 상태를 Quarantine으로 취급한다.

---

## 13. Receiving Inspection

자재반입검사는 기존 Inspection Workflow를 재사용한다.

### 검사 항목

FM-05 기존 Check Dimension:

- Model
- Quantity / Specification
- Certificate
- Condition
- Storage

추가 Functional Gate:

- approvalMatch
- lotIdentityComplete
- certificateApplicable
- shelfLifeValid if applicable
- sampleMatch if applicable
- requiredPreUseTestStatus
- physicalDamage
- contamination
- storageRequirement
- intendedLocation

### 판정

기존 Inspection 결과를 사용한다.

- pass
- conditional
- fail
- hold

Inspection pass와 useAuthorized는 동일하지 않다.

필수 시험이 남아 있으면 반입검사 pass 후에도 useAuthorized=false일 수 있다.

---

## 14. Quarantine / Hold

다음 조건이면 Lot을 사용대상에서 제외한다.

- Material Approval 없음
- 승인과 제품 불일치
- 승인 Revision 불일치
- 필수 인증 누락
- Certificate 유효성 확인 불가
- 필수 Pre-use Test 미완료
- Test Failed
- 반입검사 Hold/Fail
- 물리적 손상
- 보관조건 위반
- 관련 Material Issue Open

Quarantine 해제는 공식 Gate를 충족한 후에만 가능하다.

---

## 15. Test Requirement

시험 필요 여부, 빈도, 시점은 Requirement / ITP에 의해 정해진다.

각 Test Requirement는 최소 다음을 정의한다.

- testType
- material/work scope
- standard
- method
- acceptanceCriteria
- frequency
- samplingBasis
- sampleQuantity
- requiredWitness
- allowedLabCriteria
- equipment/calibration requirement
- timingClass
- retestPolicy

---

## 16. Test Timing Class

모든 시험을 “사용 전 완료”로 강제하지 않는다.

### pre_use

사용·설치 전 합격이 필요한 시험.

예:
- 특정 재료 성능확인
- 사용 전 장비 검사
- 인증 확인

미완료이면 useAuthorized=false.

### in_process

작업 과정에서 수행하는 시험.

예:
- Concrete Slump
- 현장 Torque / Welding Test 일부
- 시공 중 계측

해당 작업의 Hold Point와 연결한다.

### post_use_acceptance

시공 또는 설치 후 결과가 나오는 시험.

예:
- Concrete 28-day Strength
- 장기 성능시험

초기 시공 자체를 반드시 차단하는 것은 아니지만 최종 Acceptance / 다음 관련 Gate / 완료검수에 반영한다.

Timing Class는 ITP와 계약기준으로 결정하며 임의 변경하지 않는다.

---

## 17. Sample Chain of Custody

시험 결과는 어떤 Lot에서 어떤 Sample을 채취했는지가 추적되어야 한다.

필수 Chain:

> Material Lot → Sample → Test Request → Lab → Test Report → Review → Acceptance / Issue

Sample 기록:

- sourceMaterialLotRef
- samplingLocation
- sampledAt
- sampler
- witness
- seal/tag
- sampleQuantity
- samplingMethod
- storage/transport condition
- handover timestamps
- lab receipt

Chain이 끊기면 시험결과를 해당 Lot의 공식 Acceptance 근거로 사용할 수 없다.

---

## 18. Test Lab

TEST_LAB은 Party로 기록한다.

최소 확인:

- 기관명
- 시험범위
- 자격/인정 필요 여부
- 인정서 유효기간
- 시험방법 수행능력
- 관련 장비
- 장비 Calibration
- 시험 Report 발행자

시험기관은 시험결과의 Source이며 감리 공식 승인 Actor가 아니다.

Lab가 “Pass”를 표기하더라도 SUP가 Requirement와 Acceptance Criteria에 따라 최종 검토한다.

---

## 19. Test Request Flow

Test Request Product 상태:

| 상태 | 의미 |
|---|---|
| draft | 시험요청 작성 |
| requested | 공식 시험요청 |
| completeness_review | 시험조건 검토 |
| scheduled | 시험 일정·입회 확정 |
| sampling | 시료 채취 중 |
| lab_testing | 시험기관 시험 중 |
| result_received | 시험보고서 수령 |
| technical_review | 결과 기술검토 |
| passed | 기준 충족 |
| failed | 기준 미충족 |
| inconclusive | 결과 불충분/무효 |
| cancelled | 취소 |
| superseded | 잘못된 시험요청 대체 |

이는 Product 계약이며 Backend 구현 시 기존 Generic WorkItem을 사용할 수 있으나 상태 의미를 유지해야 한다.

---

## 20. Test Result

시험결과는 최소 다음을 가진다.

- testRequestRef
- testRequirementRef
- sampleId
- sourceMaterialLotRef
- testDate
- labRef
- testMethod
- testStandard
- equipment
- calibrationRef
- acceptanceCriteria
- rawResult
- unit
- resultInterpretation
- testReportEvidenceRef
- reviewedBy
- reviewedAt
- supervisionDecision

rawResult와 supervisionDecision을 분리한다.

시험기관 보고서를 수정하지 않고 원본 Evidence로 보존한다.

---

## 21. Certificate와 Test Result 구분

다음은 구분한다.

### Certificate

- 제품 인증
- 제조사 품질증명
- Factory Certificate
- Calibration Certificate
- Certificate of Conformity

### Test Result

- 특정 Sample / Lot / Work에 대해 수행한 시험 결과

Certificate가 있다고 해서 프로젝트가 요구하는 Lot별 시험을 자동 면제하지 않는다.

시험 면제는 Requirement / ITP 또는 공식 승인근거가 있을 때만 가능하다.

---

## 22. Failed Test

시험 불합격 시 최소 조치는 다음이다.

1. failed 결과 확정
2. 관련 Material Lot 또는 Work Scope 식별
3. 사용/후속작업 Hold 여부 판단
4. 이미 사용된 범위 확인
5. Material Issue / NCR 생성
6. 원인·영향평가
7. 처리방안 결정
8. 허용되는 경우 Retest
9. 감리 재검증
10. Issue 종결 후 Release 여부 결정

중대 품질 또는 구조안전 영향이 있으면 Owner Immediate Report로 연결한다.

---

## 23. Retest 원칙

Retest는 “합격할 때까지 반복시험” 기능이 아니다.

Retest 허용조건:

- 적용 기준 또는 계약이 허용
- 최초시험 무효 사유가 객관적으로 확인됨
- 시정 후 재시험이 요구됨
- 통계적 Sampling Plan이 허용

Retest 시:

- 최초 Test Result 보존
- 최초 실패 Lot/Sample 연결
- Retest 사유 기록
- 새 Sample ID 사용
- 새 Test Request 생성
- 기존 Material Issue와 연결
- 동일 Sample 결과를 덮어쓰지 않음

Retest 합격은 최초 Failure Audit를 삭제하지 않는다.

---

## 24. 이미 설치된 자재의 Failure

시험결과가 설치 후에 Fail이면 단순 Lot Reject로 끝나지 않는다.

추적:

> Material Lot → 사용/설치 위치 → 관련 Inspection → 영향 작업 → Issue

평가:

- Removal / Replacement 필요
- Engineering Assessment 필요
- 추가시험 필요
- 범위확대 Sampling 필요
- 설계자 검토 필요
- Owner Decision 필요

설계기준 완화 또는 현상유지는 정식 Change/Decision 없이 승인하지 않는다.

---

## 25. Material Use Readiness

Material Lot의 사용가능 여부는 별도 계산값으로 둔다.

### useAuthorized = true 조건

해당 Lot에 요구되는 Gate를 모두 만족해야 한다.

- materialApprovalValid = true
- approvalMatch = true
- receivingInspectionReleased = true
- requiredPreUseTestsPassed = true
- certificatesValid = true
- quarantine = false
- openBlockingMaterialIssue = false
- storageConditionAcceptable = true
- applicableChangeApproved = true

### blockedReasons 예

- MATERIAL_APPROVAL_REQUIRED
- MATERIAL_APPROVAL_EXPIRED
- APPROVAL_MISMATCH
- RECEIVING_INSPECTION_REQUIRED
- RECEIVING_INSPECTION_FAILED
- PRE_USE_TEST_REQUIRED
- PRE_USE_TEST_FAILED
- CERTIFICATE_INVALID
- MATERIAL_QUARANTINED
- MATERIAL_ISSUE_OPEN
- STORAGE_NONCONFORMING
- CHANGE_APPROVAL_REQUIRED

---

## 26. 설치·시공 검측과 연결

일반 시공검측의 precheck.material은 단순 Boolean 수기체크가 아니라 가능한 경우 해당 Material Lot readiness를 근거로 한다.

검측 요청 시:

- 사용 Material Lot Ref
- Material Approval Ref
- Receiving Inspection Ref
- Test Result Ref

를 연결한다.

필수 자재 Gate가 충족되지 않으면 정상 검측 접수를 차단하거나 Hold 사유로 표시한다.

---

## 27. Material Approval 변경·만료

다음 이벤트는 기존 승인 효력을 재검토한다.

- Manufacturer 변경
- Model 변경
- Grade 변경
- Specification 변경
- Certificate 만료
- 법정 인증 변경
- Requirement 변경
- Approved Sample 변경
- Change 승인
- Product 단종

새 승인으로 대체된 경우 기존 Approval은 superseded 처리한다.

기존 승인으로 이미 적법하게 반입·설치된 범위까지 자동 무효화할지는 사유와 영향평가에 따라 결정한다.

---

## 28. Storage Control

반입 당시 합격해도 보관 중 품질이 손상될 수 있다.

다음 자재는 필요 시 Storage Condition을 추적한다.

- 습기 민감재
- 유효기간 자재
- 화학제품
- 전기/전자장비
- 방수·실란트
- 특수 마감재
- 제조사 보관조건이 명확한 자재

Storage 위반이 확인되면 useAuthorized를 재평가한다.

---

## 29. Owner Reporting Trigger

다음은 Owner Governance로 연결한다.

- 주요 지정자재 변경
- Critical Material 승인 지연
- 반복된 자재 부적합
- 주요 시험 불합격
- 구조안전/성능 영향
- 승인되지 않은 자재 사용
- 대규모 철거·재시공 가능성
- 비용·공정 영향
- 인허가/PCCC 영향
- 장기 Lead Item 승인 문제

Issue 종결과 Owner Report 종결은 별개로 추적한다.

---

## 30. Register Projection

### 08 자재승인

보여줄 것:

- Material
- Material Submittal No./Revision
- Manufacturer / Brand / Model
- Approval Scope
- Approval Status
- Approved Revision
- Conditions
- Certificate Status
- Approved Sample
- Superseded By
- Expiry / Validity
- Required Tests

### 09 자재반입검사

보여줄 것:

- Material Lot
- Delivery Date
- Batch / Heat / Lot / Serial
- Quantity
- Approval Ref
- approvalMatch
- Receiving Inspection
- Result
- Quarantine
- Required Test Status
- useAuthorized
- Material Issue Ref

### 10 시험·계측

보여줄 것:

- Test Request
- Test Requirement
- Material Lot / Work Scope
- Sample ID
- Lab
- Method / Standard
- Test Date
- Raw Result
- Acceptance Criteria
- Supervision Decision
- Test Report
- Retest Ref
- Related Issue
- Retest Due

대장은 Domain 상태를 Projection하며 별도 독립상태를 만들지 않는다.

---

## 31. Form Mapping

### FM-04 자재승인 요청·검토서

기존 Review Dimension:

- spec
- cert
- sample
- equivalence

추가 Functional 정보:

- materialSubmittalRevision
- manufacturer
- brand/model/grade
- exact requirementRefs
- certificateRefs
- approvedSampleRef
- approvalScope
- canonicalDisposition
- approvalRef
- validity
- requiredTestRefs
- substitution/changeRef

### FM-05 자재반입 검사기록

기존 Check Dimension:

- model
- qty_spec
- cert
- condition
- storage

추가 Functional 정보:

- materialLotId
- batch/heat/lot/serial
- materialApprovalRef
- approvalMatch
- quarantine
- requiredPreUseTestStatus
- useAuthorized
- relatedIssueRef

NCR 번호는 모든 반입검사에서 필수가 아니다.

- pass: NCR 불필요
- hold: 사유에 따라 Issue/NCR 미생성 가능
- fail로 공식 Material Issue/NCR을 발행한 경우: NCR/Issue Ref 필수

### FM-06 시험·검사 요청·결과기록

기존 필드와 함께 다음을 명시한다.

- testRequestRef
- testRequirementRef
- sourceMaterialLotRef
- sampleId
- chainOfCustody
- testReportEvidenceRef
- rawResult
- supervisionDecision
- retestOfRef
- relatedIssueRef

---

## 32. Functional Inventory

| ID | Function | Primary Actor | Trigger | 완료조건 |
|---|---|---|---|---|
| F02-01 | Material Master 정의 | SUP/ADM | 승인대상 식별 | Requirement/ITP 연결 |
| F02-02 | Material Submittal 제출 | CON | 제품 선정 | 공식 Revision 제출 |
| F02-03 | 자재 완전성 검토 | SUP | 제출 접수 | 검토가능 또는 반환 |
| F02-04 | 자재 기술검토 | SUP | 완전성 통과 | 기술의견 확정 |
| F02-05 | Sample/Mock-up 검토 | SUP/DES | 승인조건 | Benchmark 확정 |
| F02-06 | 자재 Approval | 권한자 | 필수 검토 완료 | 정확한 Revision 승인 |
| F02-07 | Material Lot 등록 | CON | 현장 반입 | Lot 식별·Evidence 연결 |
| F02-08 | 반입검사 | SUP | Lot 도착 | pass/hold/fail 및 release 상태 |
| F02-09 | Sampling | CON/SUP witness | Test Requirement | Sample Chain 확정 |
| F02-10 | Test Request | CON/SUP | 시험시점 도달 | 일정·Lab·방법 확정 |
| F02-11 | Test Result 수령 | TEST_LAB source | 시험 완료 | 원본 보고서 보존 |
| F02-12 | 시험결과 판정 | SUP | Result 수령 | pass/fail/inconclusive |
| F02-13 | Material Issue 생성 | SUP | 반입/시험 Fail | 공식 Issue와 Lot 연결 |
| F02-14 | Retest | CON/SUP | 허용된 재시험 | 새 Sample/Test 결과 |
| F02-15 | Material Release | SUP | 모든 Pre-use Gate 충족 | useAuthorized=true |
| F02-16 | 설치 위치 추적 | CON/SUP | 자재 사용 | Lot→Location/Inspection 연결 |

---

## 33. Completion Criteria

### Material Approval 완료

- 정확한 Material Submittal Revision
- 필수 기술검토 완료
- Sample/Mock-up 필요 시 완료
- Pre-approval Test 필요 시 완료
- Canonical Disposition 확정
- Approval Ref 존재
- 조건과 Scope 명시

### Material Lot 완료

- Lot 식별
- Approval Match 확인
- 반입검사 완료
- 필수 Pre-use Test 완료
- Open Blocking Issue 없음
- 사용 또는 Reject/Return 처분 기록

### Test 완료

- Test Requirement 연결
- Sample Chain 완전
- Lab/Method/Standard 확인
- 원본 Report Evidence 존재
- Raw Result 보존
- SUP 판정 완료
- Fail이면 Material Issue 연결

### F-02 업무종결

자재가 설치·사용 대상이면 해당 Lot의 사용 이력까지 연결되고, 불합격 Lot은 사용되지 않았거나 시정·제거·재검증이 완료되어야 한다.

---

## 34. Backend Handoff Contract

Backend 구현은 최소 다음 개념을 보존한다.

- Material
- MaterialSubmittal
- exact approval target version
- approved identity
- MaterialLot
- materialApprovalRef
- approvalMatch
- Sample ID
- TestRequirement
- TestRequest
- chainOfCustody
- TEST_LAB source Party
- raw test result
- supervisionDecision
- retestOfRef
- materialUseReadiness
- useAuthorized
- blockedReasons
- Lot→Inspection→Installed Location linkage
- Issue linkage
- Audit

Generic WorkItem.data를 임시 사용하더라도 필드 의미를 바꾸지 않는다.

---

## 35. UI Handoff Contract

UI는 최소 다음을 별도로 보여야 한다.

- 자재 승인상태
- 실제 반입 Lot 상태
- 시험 진행상태
- 사용 가능 여부

예:

> 승인됨 / 반입검사 합격 / Pre-use Test 대기 / 사용불가

처럼 하나의 “Approved” Badge로 축약하지 않는다.

현장 사용자는 Material Lot을 조회했을 때 즉시 다음을 확인할 수 있어야 한다.

- 승인제품과 일치하는가
- 반입검사를 통과했는가
- 필요한 시험이 끝났는가
- 현재 사용 가능한가
- 차단 사유가 무엇인가

---

## 36. Product Validation Scenarios

### Scenario A — 정상 승인·반입

Material 승인 → 동일 제품 Lot 반입 → 반입검사 Pass → 시험 불필요 → Release

기대:
- useAuthorized=true
- 승인 Revision과 Lot 연결

### Scenario B — 승인 제품과 다른 제조사

승인 A사 → B사 제품 반입

기대:
- approvalMatch=false
- Quarantine
- 사용불가
- 필요 시 새 Material Submittal

### Scenario C — Pre-use Test 대기

반입검사 Pass → 필수 시험 Pending

기대:
- Inspection pass와 별개로 useAuthorized=false

### Scenario D — 시험 불합격

Lot 반입 → Sample → Test Fail

기대:
- Material Issue
- Lot Hold
- 이미 사용된 위치 추적
- 최초 Fail 결과 보존

### Scenario E — 재시험 합격

Test Fail → 허용된 Retest → Pass

기대:
- 최초 Fail 삭제 안 함
- Issue는 Retest Pass만으로 자동 Close 안 함
- SUP가 전체 조치 검증 후 Release

### Scenario F — Concrete 28-day Test

Concrete 타설 → In-process Test 완료 → 시공 진행 → 28-day Test 후속

기대:
- Post-use Acceptance Test를 이유로 타설 전부터 무조건 사용금지하지 않음
- 28-day Fail이면 이미 시공된 범위까지 영향평가

### Scenario G — Certificate 존재하지만 Lot Test 필수

Manufacturer Certificate 제출 → 계약상 현장시험 요구

기대:
- Certificate만으로 Test Gate 면제 안 함

### Scenario H — 보관상태 훼손

반입검사 Pass → 장기 보관 중 수분/유효기간 문제

기대:
- useAuthorized 재평가
- 필요 시 Hold/Test/Issue

---

## 37. F-02 완료판정

F-02 Product / Functional Design은 다음을 정의했으므로 08·09·10을 M3로 평가한다.

- Material Approval
- Approved Material Identity
- Material Lot
- Receiving Inspection
- Quarantine
- Test Requirement
- Test Timing Class
- Sampling Chain
- Test Lab
- Test Request
- Raw Result / Supervision Decision 분리
- Failed Test
- Retest
- Installed Material 영향추적
- Material Use Readiness
- Register / Form Mapping
- Completion Criteria
- Backend/UI Handoff

다음 Product 상세설계는 F-03 Safety Permit / Stop / Resume로 진행한다.
