# 30. Safety Permit / Stop / Resume Functional Contract v1.0

기준일: 2026-10-06
문서상태: Product / Functional 상세계약 v1.0
Functional ID: F-03
Functional Domain: D5 Safety / Compliance
대상 관리대장: 18 안전·고위험작업, 19 안전검사 장비·기계
관련 양식: FM-02, FM-17

---

## 1. 목적

고위험작업을 단순 안전체크리스트가 아니라 다음의 폐쇄형 업무로 관리한다.

> 작업계획·위험성 검토 → 작업허가 요청 → 현장 사전확인 → 작업허가 → 작업수행 → 위험 발생 시 즉시 중지 → 시정·검증 → 명시적 재개승인 → 작업완료

핵심 원칙:

1. 승인된 시공계획서와 Safety Permit은 동일한 문서가 아니다.
2. Safety Permit 발행과 실제 작업 가능상태는 동일하지 않다.
3. Permit은 작업종류·위치·시간·책임자·장비·통제조건에 묶인 유효범위를 가진다.
4. 위험조건이 바뀌면 기존 Permit을 조용히 수정하지 않고 재검토 또는 새 Permit으로 처리한다.
5. 즉시 위험이 있으면 정식 문서 작성 전에 작업을 먼저 정지시킬 수 있어야 하며, 이후 공식 기록으로 전환한다.
6. Safety Issue가 종결되어도 작업중지가 자동 해제되지 않는다.
7. Owner Report 수령확인은 작업재개 승인과 동일하지 않다.
8. 장비 검사증·교정·점검이 유효하지 않으면 관련 작업 Permit이 있어도 작업할 수 없다.
9. AI는 위험 후보를 제시할 수 있으나 공식 작업중지·재개 권한을 갖지 않는다.
10. 법정 작업중지·재개 권한은 적용 법령·계약·개인자격을 우선하며 본 계약은 이를 확장하지 않는다.

---

## 2. 적용범위

프로젝트 위험분류 Baseline이 지정한 작업에 적용한다.

기본 범주:

- 굴착·흙막이
- 크레인·양중
- 철골·고소작업
- 화기작업
- 밀폐공간
- 임시전기 및 전기 위험작업
- 안전검사 대상장비 사용
- 프로젝트가 별도로 지정한 고위험작업

프로젝트별 Risk Register, 계약, 법령, 발주처 요구에 따라 범위를 추가할 수 있다.

---

## 3. Product Object Model

### 3.1 Safety Permit

기준 객체:

> WorkItem / SafetyPermit

Safety Permit은 특정 작업범위의 일시적 작업허가다.

최소 데이터:

- permitNo
- workType
- packageId
- locationId
- discipline
- responsibleOrganizationId
- contractorResponsiblePartyId
- safetyResponsiblePartyId
- supervisingPartyIds
- methodStatementRef
- riskAssessmentRef
- requirementRefs
- equipmentRefs
- personnelQualificationRefs
- validFrom
- validTo
- shiftOrWorkWindow
- weatherOrEnvironmentLimits
- controlMeasures
- emergencyPlanRef
- evidenceIds
- stopOrderRefs
- issueRefs

### 3.2 Safety Stop Order

F-03은 다음 Product subtype을 도입한다.

> WorkItem / SafetyStopOrder

Stop Order는 Permit 자체가 아니라 어떤 작업범위를 중지시켰는가를 관리한다.

하나의 Stop Order는 필요 시 여러 Permit, 작업위치, 장비 또는 시공사 Scope에 영향을 줄 수 있다.

최소 데이터:

- stopOrderNo
- stopScopeType
- affectedPermitRefs
- affectedEquipmentRefs
- affectedLocationRefs
- affectedOrganizationRefs
- hazardCategory
- severity
- observedAt
- effectiveAt
- issuedBy
- immediateControls
- issueRefs
- correctiveActionRefs
- resumeRequestAt
- resumeVerificationRefs
- liftedAt
- liftedBy
- ownerReportRef

### 3.3 Safety Equipment Readiness

기준 객체 조합:

- Asset / Equipment
- WorkItem / SafetyEquipmentInspection
- InformationItem / Certificate
- 필요 시 Qualification

Equipment 자체와 검사·인증·교정 기록을 분리한다.

---

## 4. Actor와 Decision Right

| 업무행위 | 기본 Actor | 원칙 |
|---|---|---|
| 작업계획·위험성평가 작성 | CON | 시공사 책임 |
| Permit 요청 | CON | 책임자 지정 필수 |
| 완전성검토 | SUP 안전/분야감리 | 기술승인 아님 |
| 현장 Pre-start 확인 | SUP 안전/분야감리 | 실제 상태 확인 |
| 일반 Permit 승인 | 프로젝트 권한매트릭스상 SUP | 계약·법령 우선 |
| 고위험 A등급 Permit 최종승인 | chief_supervisor 기본 | 프로젝트 승인매트릭스 우선 |
| 시공사 자율 작업중지 | CON | 자기 작업을 즉시 중지 가능 |
| 즉시 위험 현장 Stop | 권한 있는 SUP | 생명·중대위험 우선 |
| 공식 주요 작업중지 확인 | chief_supervisor | 법정/계약권한 범위 |
| Resume 요청 | CON | 시정완료 근거 포함 |
| Resume 현장검증 | SUP 안전/분야감리 | 위험제거 확인 |
| Resume 최종승인 | Stop 발행권한 이상 | Self-resume 금지 |
| 주요 공사중지 의사결정 | OWN 필요 시 | 비용·공기·계약 영향 |
| 행정등록·통보 | ADM | 기술판정 불가 |

ADM, AI, SYSTEM, INTEGRATION은 공식 안전판정 또는 작업재개 권한을 행사하지 않는다.

---

## 5. Safety Permit State

Product 상태:

| 상태 | 의미 |
|---|---|
| draft | 시공사 작성 중 |
| submitted | 공식 Permit 요청 |
| completeness_review | 필수자료 확인 |
| safety_review | 위험통제·자격·장비 검토 |
| prestart_verification | 현장 실제조건 확인 |
| authorization_pending | 최종 승인 대기 |
| authorized | 승인됐으나 작업 시작 전 |
| active | 현재 유효하고 작업 가능조건 충족 |
| suspended | Stop Order 또는 유효조건 상실로 정지 |
| resume_review | 재개 요청 검토 |
| completed | 허가된 작업범위 완료 |
| expired | 유효기간 만료 |
| rejected | 승인 불가 |
| withdrawn | 시공사 철회 |
| cancelled | 허가권자가 취소 |
| superseded | 새 Permit으로 대체 |

authorized와 active를 구분한다.

---

## 6. Safety Permit Command

| From | Command | Actor | To | 핵심 Gate |
|---|---|---|---|---|
| draft | submit_permit | CON | submitted | 필수자료·책임자 |
| submitted | receive_permit | SUP/ADM | completeness_review | 공식 접수 |
| completeness_review | return_incomplete | SUP | draft | 누락사유 |
| completeness_review | accept_for_safety_review | SUP | safety_review | 검토 가능 |
| safety_review | request_prestart_verification | SUP | prestart_verification | 문서검토 통과 |
| prestart_verification | request_authorization | SUP | authorization_pending | 현장 Gate 충족 |
| authorization_pending | authorize | 권한자 | authorized | 승인권한·유효기간 |
| authorization_pending | reject_permit | 권한자 | rejected | 반려사유 |
| authorized | activate | SUP | active | 작업시작 직전 조건 재확인 |
| authorized/active | suspend | SUP | suspended | Stop 또는 유효조건 상실 |
| active | self_suspend | CON | suspended | 시공사 자체 작업중지·사유 |
| suspended | request_resume | CON | resume_review | 시정완료 근거 |
| resume_review | approve_resume | chief_supervisor 기본 | active | Resume Gate 전부 충족 |
| resume_review | return_resume | SUP | suspended | 미충족 사유 |
| active | complete_work | SUP | completed | 시공사 완료근거 + 감리 확인 |
| authorized/active/suspended/resume_review | expire | SYSTEM derived | expired | validTo 초과 |
| nonterminal | cancel | 권한자 | cancelled | 취소사유 |
| draft/submitted | withdraw | CON | withdrawn | 철회사유 |
| authorized/active/suspended/resume_review | supersede | 권한자 | superseded | 대체 Permit 명시 |

기한초과나 알림만으로 승인·재개되지 않는다. `SYSTEM`의 만료 처리는 `official=false`인 파생 상태전이이며 Permit 승인·Stop 해제·Resume 승인은 반드시 사람의 공식 권한으로 수행한다.

---

## 7. Permit 제출 Gate

최소 필요자료:

- 작업종류
- 작업위치
- 작업기간/Shift
- 책임 시공사
- 현장 책임자
- 안전 책임자
- 승인된 Method Statement
- 작업별 Risk Assessment / JSA
- 작업인원
- 필요한 자격·교육
- 사용 장비 목록
- 장비 검사/인증 상태
- PPE
- 접근통제
- 비상대응
- 통신수단
- 작업 전 점검계획

작업별 추가 Gate는 ITP SAF-01~SAF-08 기준을 사용한다.

---

## 8. Pre-start Verification

문서승인만으로 active가 되지 않는다.

작업 시작 직전 실제 현장을 확인한다.

공통 확인:

- Permit Scope와 실제 위치 일치
- 책임자 현장 배치
- Toolbox Meeting/작업 전 교육
- 작업자 자격·교육 유효
- 장비 Readiness
- 안전시설 실제 설치
- 출입통제
- 비상동선/구조계획
- 가시설 상태
- 환경·기상 조건
- 인접공종 간섭
- 당일 변경사항

확인 Evidence는 시간과 위치를 가진다.

---

## 9. Permit Validity

Permit 유효성은 다음 범위에 묶인다.

- 작업종류
- 위치
- 시공사
- 책임자
- 주요 장비
- 작업방법
- 통제조치
- 유효시간
- Shift
- 환경조건

다음 변화가 있으면 재검토한다.

- 작업위치 변경
- 작업방법 변경
- 책임자 변경
- 주요 장비 변경
- 위험등급 변경
- 설계/시공조건 변경
- 기상·환경조건이 허용한계를 벗어남
- Permit 유효기간 만료
- Stop Order 발행
- 필요한 Certificate/Qualification 만료

단순 validTo 수정으로 연장하지 않는다. 연장은 재검토 이력을 남긴다.

---

## 10. workAuthorized 계산 Gate

실제 작업가능 여부는 별도 계산값으로 둔다.

workAuthorized = true 최소조건:

- permitState = active
- 현재시각이 validFrom/validTo 안에 있음
- prestartVerified = true
- openSafetyStopOrder = false
- requiredEquipmentReady = true
- requiredPersonnelQualified = true
- controlMeasuresCurrent = true
- requiredMethodStatementCurrent = true
- riskAssessmentCurrent = true
- emergencyPlanAvailable = true
- environmentalLimitsSatisfied = true
- blockingSafetyIssue = false

Permit이 authorized여도 workAuthorized=false일 수 있다.

---

## 11. Safety Stop Trigger

다음은 작업중지 Trigger가 될 수 있다.

- 즉시 사고 위험
- 추락·붕괴·감전·화재·폭발 등 중대위험
- Permit 없는 고위험작업
- Permit Scope 이탈
- 핵심 안전시설 미설치/해체
- 안전검사 장비의 Certificate 만료
- 장비 결함
- 무자격 작업자
- 밀폐공간 가스조건 부적합
- 양중계획 위반
- 안전계측 임계치 초과
- 사고 또는 중대한 Near Miss
- 반복된 동일 안전부적합
- 법정/발주처/감리 권한에 따른 중지지시

Stop은 위험범위를 명시한다.

불필요하게 전체 현장을 중지하지 않되, 위험범위가 불명확하면 보수적으로 Scope를 설정한다.

---

## 12. Emergency Stop

생명·중대사고 위험이 임박한 경우 기록완료를 기다리지 않고 우선 작업을 중지한다.

Product 처리:

1. 현장 Stop
2. observedAt / effectiveAt 기록
3. Evidence 확보
4. 영향 Scope 지정
5. SafetyStopOrder 공식화
6. chief_supervisor 및 관계자 통보
7. 중대사항이면 Owner Immediate Report
8. Safety Issue / Corrective Action 연결

구두·무전·현장신호로 Stop한 경우 시스템 기록으로 사후 전환한다.

AI 위험감지는 경고 Candidate만 생성하며 Stop 권한을 행사하지 않는다.

---

## 13. Safety Stop Order State

| 상태 | 의미 |
|---|---|
| issued | 작업중지 즉시 효력 |
| acknowledged | 시공사 수령확인 |
| corrective_action | 시정 진행 |
| resume_requested | 시공사 재개 요청 |
| verification | 현장 재검증 |
| lifted | 중지 해제 승인 |
| closed | 후속 기록까지 완료 |
| superseded | 다른 Stop Order로 대체 |
| cancelled | 오발행 등 정당한 취소 |

수령확인하지 않았다고 Stop 효력이 지연되지 않는다.

---

## 14. Stop / Resume Command

| From | Command | Actor | To | 핵심 Gate |
|---|---|---|---|---|
| 생성(create / issue_stop) | issue_stop | 권한 있는 SUP | issued | 위험·Scope·Evidence |
| issued | acknowledge_stop | CON | acknowledged | 수령시각 |
| issued/acknowledged | start_correction | CON | corrective_action | 책임자 |
| corrective_action | request_resume | CON | resume_requested | 시정증빙 |
| resume_requested | start_resume_verification | SUP | verification | 현장확인 가능 |
| verification | return_resume | SUP | corrective_action | 미해결 위험 |
| verification | lift_stop | 권한자 | lifted | Resume Gate 충족 |
| lifted | close_stop | SUP | closed | 통보·Audit 완료 |

`SafetyStopOrder`는 즉시위험 작업중지를 지연시키지 않기 위해 생성과 동시에 `issued` 상태가 되는 원자적 `issue_stop`으로 취급한다. Draft를 거쳐야만 효력이 생기는 구조로 만들지 않는다.

CON은 SUP가 발행한 Stop Order를 스스로 해제할 수 없다.

---

## 15. Resume Gate

작업재개는 다음을 모두 확인한다.

1. Stop 원인이 명확히 식별됨
2. 시정조치 완료
3. 시정 Evidence 존재
4. 필요한 Safety Issue / Action 검증 완료
5. 필요한 재검측/재점검 합격
6. Permit이 아직 유효하거나 재승인됨
7. Method Statement와 Risk Assessment가 Current
8. 장비 Readiness 유효
9. 작업자 자격·교육 유효
10. 통제시설 재설치·확인
11. 환경조건 정상
12. 필요한 즉시보고/의사결정 연계
13. 권한 있는 사람이 명시적으로 lift_stop

중요:

- Issue Close ≠ Stop Lift
- Report Acknowledge ≠ Resume Approval
- Permit Expiry 후 Stop Lift ≠ Permit 자동부활
- Safety Issue 시정완료 ≠ Work Authorized

---

## 16. 주요 공사중지와 Owner Governance

다음은 Owner Governance로 즉시 연결한다.

- 중대사고
- 사망·중상 가능성이 높은 즉시위험
- 주요 공종 장시간 중지
- 여러 공종/구역에 영향
- Critical Path 영향
- 계약상 Notice 필요
- 비용영향
- 법정기관 보고 가능성
- 언론·민원·인접시설 영향

Owner Report는 안전기술판정의 대체물이 아니다.

발주처 결정이 필요한 계약·공정사항이 있어도 위험이 제거되기 전 작업을 재개하지 않는다.

---

## 17. Equipment Readiness

안전검사 대상장비의 사용가능 여부는 별도 계산한다.

equipmentAvailable = true 최소조건:

- Equipment Asset 식별 완료
- 해당 장비에 요구되는 법정/계약상 검사 완료
- Certificate 유효
- 필요한 Calibration 유효
- 정기점검 유효
- 현장 Pre-use Check 완료
- 결함 미해결 없음
- Out-of-service 상태 아님
- 관련 Safety Issue가 Blocking 상태가 아님

필요한 장비가 하나라도 준비되지 않으면 관련 Permit의 workAuthorized=false다.

---

## 18. Safety Equipment Inspection State

Product 상태:

| 상태 | 의미 |
|---|---|
| due | 검사/점검 필요 |
| requested | 검사 요청 |
| scheduled | 검사일정 확정 |
| inspecting | 점검 중 |
| result_pending | 결과 정리 중 |
| passed | 합격 |
| failed | 사용불가 |
| restricted | 조건부 사용제한 |
| reinspection_due | 시정 후 재검사 필요 |
| expired | 검사/인증 유효기간 만료 |
| cancelled | 취소 |

재검사 합격 전 최초 Fail 기록을 삭제하지 않는다.

---

## 19. Certificate / Calibration

Certificate는 원본 InformationItem로 보존한다.

최소 필드:

- certificateType
- issuer
- equipmentRef
- certificateNo
- issuedAt
- validFrom
- validTo
- scope
- evidenceRef

만료 알림은 상태를 자동 합격으로 바꾸지 않는다.

Certificate 만료 시 해당 Equipment Readiness를 즉시 재평가한다.

---

## 20. Personnel Qualification

Permit에 요구되는 인력자격은 Project RoleAssignment / Qualification과 연결한다.

예:

- 장비 운전원
- 신호수
- 용접/화기작업자
- 전기작업자
- 밀폐공간 감시자
- 안전책임자

자격 만료·철회·인원교체 시 Permit 유효성을 재평가한다.

---

## 21. Safety Issue와의 관계

SafetyStopOrder와 Issue는 다른 객체다.

- Stop Order = 작업을 멈추는 운영통제
- Safety Issue = 위험/부적합의 시정·검증 추적

중대한 위험은 일반적으로 둘 다 연결될 수 있다.

Stop Order 없이 Issue만 발행하는 경우도 있고, 즉시위험에서는 Stop을 먼저 하고 Issue를 뒤따라 생성할 수 있다.

---

## 22. Evidence / Audit

Permit 최소 Evidence:

- Method Statement
- Risk Assessment/JSA
- 작업 전 교육
- 작업자 자격
- 장비 인증
- Pre-start 현장사진/측정
- 통제시설
- 비상대응 준비

Stop 최소 Evidence:

- 위험상태
- 위치
- 발생시각
- 영향 Scope
- 즉시조치

Resume 최소 Evidence:

- 시정 후 상태
- 재점검/재측정
- 관련 Issue/Action 검증
- 재개 승인

모든 승인·중지·재개는 Actor, Role, timestamp, exact target version을 Audit한다.

---

## 23. Notification / SLA

최소 알림:

- Permit 제출
- Permit 검토기한
- Permit 승인/반려
- Permit 만료 임박
- 작업 시작 전 확인 미완료
- 장비 Certificate 만료 임박
- 장비 사용불가
- Stop 발행 즉시
- Stop 수령 미확인
- Resume 요청
- Resume 검증대기
- 장기 작업중지
- Owner Immediate Report 필요

알림은 승인·중지해제·Permit 연장을 자동 수행하지 않는다.

---

## 24. 관리대장 18 Projection

보여줄 것:

- Permit No.
- Work Type
- Location
- Contractor
- Responsible Person
- Permit State
- Valid From / To
- Pre-start Verification
- workAuthorized
- blockedReasons
- Stop Order
- Stop Scope
- Stop Reason
- Resume Status
- Safety Issue
- Owner Report
- Current Equipment Readiness

18번 대장은 WorkItem / SafetyPermit, WorkItem / SafetyStopOrder, Inspection, Issue를 Projection한다.

---

## 25. 관리대장 19 Projection

보여줄 것:

- Equipment ID
- Equipment Type
- Owner/Supplier
- Inspection Status
- Certificate No.
- Certificate Expiry
- Calibration Expiry
- Latest Pre-use Check
- Open Safety Issue
- equipmentAvailable
- blockedReasons
- Related Permit

19번 대장은 조회형으로 유지할 수 있다.

조회형이라는 이유로 업무기능이 불완전한 것은 아니다. 실제 검사·재검사 Workflow는 SafetyEquipmentInspection 객체에서 수행하고 대장은 그 결과를 Projection한다.

---

## 26. FM-17 Mapping

FM-17은 Safety Permit / High-risk Work Verification의 공식 DOUL 내부 Snapshot이다.

기존 항목:

- work_type
- datetime
- supervisor
- permission
- conditions
- method
- risk_assessment
- training
- equipment
- controls
- emergency

추가 Product 정보:

- permitNo
- permitState
- validFrom
- validTo
- contractorResponsibleParty
- safetyResponsibleParty
- equipmentRefs
- personnelQualificationRefs
- prestartVerifiedAt
- workAuthorized
- stopOrderRefs
- resumeApprovalRef
- sourceVersion

서명원칙:

- CON 작업책임자/안전책임자
- SUP 안전 또는 담당감리
- 고위험 A등급 및 주요 중지·재개는 chief_supervisor 확인
- 법정 서명요건은 프로젝트별 적용법령·계약기준 우선

FM-17은 실시간 상태원장이 아니라 확정된 Domain Data의 Snapshot이다.

---

## 27. Functional Inventory

| ID | Function | Primary Actor | Trigger | 완료조건 |
|---|---|---|---|---|
| F03-01 | 고위험작업 분류 | SUP/ADM baseline | 프로젝트 착수 | Permit 대상 기준 확정 |
| F03-02 | Permit 작성·요청 | CON | 작업계획 | 공식 요청 |
| F03-03 | 완전성검토 | SUP | Permit 접수 | 검토가능/반환 |
| F03-04 | Safety Review | SUP | 완전성 통과 | Risk Control 검토 |
| F03-05 | Pre-start Verification | SUP | 작업 직전 | 실제 조건 확인 |
| F03-06 | Permit Authorization | 권한자 | Gate 충족 | authorized |
| F03-07 | Work Activation | SUP | 작업개시 | active + workAuthorized |
| F03-08 | Equipment Readiness | SUP/CON | 장비투입 | equipmentAvailable 판정 |
| F03-09 | Emergency Stop | SUP/CON self-stop | 즉시위험 | 위험작업 중지 |
| F03-10 | Formal Stop Order | SUP | Stop 필요 | 영향 Scope와 사유 기록 |
| F03-11 | Safety Correction | CON | Stop/Issue | 시정완료 |
| F03-12 | Resume Request | CON | 시정완료 | 공식 재개요청 |
| F03-13 | Resume Verification | SUP | 재개요청 | 위험제거 검증 |
| F03-14 | Stop Lift / Resume | 권한자 | Resume Gate 충족 | 명시적 재개승인 |
| F03-15 | Permit Completion | CON/SUP | 작업종료 | 작업범위 완료 |
| F03-16 | Expiry/Revalidation | SYSTEM/SUP | 유효조건 변경 | 재승인 또는 만료 |

---

## 28. Completion Criteria

### Permit 완료

- 허가 Scope 작업 완료
- 미결 Safety Stop 없음
- 필요한 Safety Issue가 적법하게 종결 또는 별도 이관됨
- 작업종료 시 위험요소 정리
- Permit Snapshot 보존

### Stop Order 완료

- 위험원인 확인
- 시정조치 검증
- Resume Gate 검증
- 권한 있는 사람이 Stop Lift
- 관계자 통보
- 필요한 Owner Report/Decision 연결
- Audit 보존

### Equipment Inspection 완료

- 검사결과 확정
- Certificate/Calibration 연결
- 실패 시 사용차단
- 재검사 필요 시 추적
- 최종 Equipment Readiness 반영

---

## 29. Backend Handoff Contract

Backend는 다음 Product 의미를 변경하지 않는다.

- SafetyPermit
- SafetyStopOrder
- SafetyEquipmentInspection
- Permit state와 workAuthorized 분리
- Stop Order와 Safety Issue 분리
- time/scope bound permit validity
- explicit stop/lift commands
- equipment readiness
- personnel qualification linkage
- blockedReasons
- Owner Reporting trigger
- immutable Audit

Product 실행계약은 다음 기계계약으로 확정한다.

- `app/schema/domain_schemas_v2.json`: `SafetyPermitData`, `SafetyStopOrderData`, `SafetyEquipmentInspectionData`, `SafetyReadiness`, `SafetyResumeGate`
- `app/schema/state_machines_v1.json`: `safety_permit`, `safety_stop_order`, `safety_equipment_inspection`
- `app/schema/authority_matrix_v1.json`: `safety.*` 권한정책
- `app/schema/safety_execution_contract_v1.json`: 서버파생 필드·서버시각·원자적 `issue_stop`·Resume 순서·장비 readiness 경계
- `app/reference/machine_bindings_v1.json`: Safety API collection / create authority binding
- 관리대장 18·19의 command projection

Backend는 위 계약을 구현하며 별도 상태·권한·필드 의미를 재정의하지 않는다. `workAuthorized`와 `equipmentAvailable`은 사용자 입력값이 아니라 Gate 결과로 계산되는 파생값이다. `issue_stop`은 Stop Order 생성, affected Permit 연결, 해당 Permit의 작업중지·`workAuthorized=false` 반영을 하나의 트랜잭션으로 처리하고 중간 실패 시 전체를 rollback해야 한다.

---

## 30. UI Handoff Contract

UI는 최소 다음 상태를 별도로 보여야 한다.

- Permit 승인 여부
- 현재 Permit 유효성
- 실제 작업가능 여부
- Stop Order 존재
- Equipment Readiness
- Resume 승인 여부

예:

> Permit 승인 / 장비 검사증 만료 / 작업불가

또는

> Permit 활성 / Stop Order 발행 / 재개검증 대기

처럼 보여야 한다.

Approved, Safe, Work Authorized를 하나의 Badge로 합치지 않는다.

---

## 31. Product Validation Scenarios

### Scenario A — 정상 고위험작업

CON Permit 요청 → Safety Review → Pre-start → 승인 → Active

기대:
- workAuthorized=true
- Permit Scope와 작업위치 일치

### Scenario B — Permit 승인됐지만 장비 Certificate 만료

Permit authorized → Crane Certificate expired

기대:
- equipmentAvailable=false
- workAuthorized=false
- Permit 상태와 작업가능상태를 동일시하지 않음

### Scenario C — 작업 중 즉시위험 발견

Active Permit → SUP 현장 Stop → SafetyStopOrder issued

기대:
- 즉시 작업중지
- Permit suspended
- Owner Immediate Report 조건 평가

### Scenario D — Issue만 종결

Stop Order → Safety Issue → 시정 → Issue closed

기대:
- Stop Order는 자동 lifted 되지 않음
- 작업재개 불가

### Scenario E — Resume

시정완료 → CON Resume 요청 → SUP 현장검증 → 권한자 lift_stop

기대:
- Permit 유효성 재확인
- Stop lifted 후 workAuthorized 재계산

### Scenario F — Permit 만료 중 Stop

Permit suspended 중 validTo 경과 → Stop lifted

기대:
- Permit expired 유지
- 새 Permit 또는 재승인 없이는 작업불가

### Scenario G — 시공사 Self-stop

CON이 위험 발견 → 자기 작업 즉시 중지 → SUP 통보

기대:
- Self-stop은 허용
- SUP Stop Order가 있는 경우 CON이 임의 재개하지 못함

### Scenario H — AI 위험 Candidate

Video 분석 → AI 고위험 Candidate

기대:
- SUP 알림/검토
- AI가 직접 Stop Order 발행하지 않음

---

## 32. F-03 완료판정

F-03 Product / Functional Design은 다음을 정의했으므로 관리대장 18·19의 Product 성숙도를 M3로 평가한다.

- Permit Actor/State/Command
- Pre-start Gate
- time/scope bound validity
- workAuthorized
- SafetyStopOrder
- Emergency Stop
- Resume Gate
- Equipment Readiness
- Equipment Inspection
- Certificate / Calibration
- Personnel Qualification
- Safety Issue 관계
- Owner Reporting
- Evidence / Audit
- Register Projection
- FM-17 Mapping
- Completion Criteria
- Backend/UI Handoff

다음 Product 상세설계는 F-04 Schedule / Delay / Recovery로 진행한다.
