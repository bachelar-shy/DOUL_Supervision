# DOUL 감리체계 v2.1 구현계약

## 실행 가능한 개발 골격 (2026-10-05)

PR #2 병합 커밋 `d13e744`의 계약·검증 엔진을 재사용한 반응형 웹, Android/iOS 공통 앱, HTTP/SQLite 개발 어댑터를 추가했다. 운영 인증·법정 서명·영상 AI·DOCX/PDF·실기기 배포는 아직 미구현이다. 실제 현장 데이터 입력과 운영 배포를 금지한다.

- [코드 구조·실행·검증·제약](./23_MVP_Code_Skeleton_and_Stitch.md)
- [Stitch 화면 계획](./design/stitch/screen-plan.json)
- [Stitch 실제 화면 연결](./design/stitch/screens.json)
- [실행 검증 결과](./design/verification/mvp-results.json)

## 문서목록

1. [한·베 감리 법령 요구사항 매트릭스](./01_Regulatory_Requirement_Matrix.md)
2. [DOUL 감리인력 배치 및 자격기준](./02_Supervision_Staffing_Matrix.md)
3. [DOUL 감리 조직·책임·승인체계](./03_Roles_Responsibilities_Approval_Matrix.md)
4. [DOUL 감리 표준 업무절차](./04_Supervision_Workflow.md)
5. [베트남 필수 문서·법정 서식 대장](./04A_Vietnam_Mandatory_Documents_Forms.md)
6. [DOUL 감리 관리대장 및 데이터 구조](./05_Registers_Data_Model.md)
7. [DOUL 공종별 검측·시험계획](./06_Inspection_Test_Plan.md)
8. [DOUL 표준서식 및 문서체계](./07_Forms_Document_Control.md)
9. [DOUL 발주처 보고 및 의사결정 체계](./08_Owner_Reporting_Decision_Process.md)
10. [DOUL 시운전·준공·인수인계·하자관리](./09_Commissioning_Handover_Defects.md)
11. [베트남 현장 운영특성 및 DOUL 적용원칙](./10_Vietnam_Site_Operating_Principles.md)
12. [DOUL Construction Supervision Standard](./11_DOUL_Supervision_Standard.md)
13. [DOUL 디지털 감리시스템 요구사항](./12_Digital_System_Requirements.md)
14. [DOUL 감리체계 도입·운영·성과관리](./13_Implementation_Governance_KPI.md)
15. [DOUL 감리체계 최종 누락검증](./14_Final_Completeness_Audit.md)
16. [DOUL 프로젝트 감리 착수 체크리스트](./15_Project_Startup_Checklist.md)
17. [DOUL 감리 앱 구현 및 A4 양식 엔진](./16_App_Implementation_Form_Engine.md)
18. [A4 양식·배포팩 생성물 매니페스트](./artifacts/README.md)
19. [Domain · State · Authority Model v2](./17_Domain_State_Authority_Model.md)
20. [Mobile · Tablet · Web 제품구조](./18_Mobile_Web_Product_Architecture.md)
21. [MVP Vertical Slice](./19_MVP_Vertical_Slice.md)
22. [사진·영상·발화 분석 상세정의](./20_Media_Analysis_Detailed_Definition.md)
23. [발주처 보고·조치 종결 상세계약](./21_Owner_Report_Closure_Contract.md)
24. [이슈 #1 해결 근거와 검증](./22_Issue_1_Resolution_Validation.md)
25. [UI · 기능 병렬개발 경계](./25_UI_Function_Parallel_Development.md)
26. [Product / Functional Map v1.0](./26_Product_Functional_Map_v1.md)
27. [시공사 제출자료 · 시공상세도 Functional Contract v1.0](./27_Submission_Shop_Drawing_Functional_Contract.md)
28. [자재승인 · 반입검사 · 시험 Functional Contract v1.0](./28_Material_Approval_Receiving_Test_Functional_Contract.md)
29. [Issue 종결증빙 Functional Contract v1.0](./29_Issue_Closure_Evidence_Functional_Contract.md)
30. [Safety Permit / Stop / Resume Functional Contract v1.0](./30_Safety_Permit_Stop_Resume_Functional_Contract.md)
31. [Schedule / Delay / Recovery Functional Contract v1.0](./31_Schedule_Delay_Recovery_Functional_Contract.md)
32. [Progress Measurement / Payment Functional Contract v1.0](./32_Progress_Measurement_Payment_Functional_Contract.md)
33. [Fire / Environment Compliance Functional Contract v1.0](./33_Fire_Environment_Compliance_Functional_Contract.md)
34. [Commissioning / Handover / Warranty Functional Contract v1.0](./34_Commissioning_Handover_Warranty_Functional_Contract.md)
35. [Contract Notice / Claim / EOT Functional Contract v1.0](./35_Contract_Notice_Claim_EOT_Functional_Contract.md)
36. [Regulatory Permit Lifecycle Functional Contract v1.0](./36_Regulatory_Permit_Lifecycle_Functional_Contract.md)
37. [Site Instruction Functional Contract v1.0](./37_Site_Instruction_Functional_Contract.md)
38. [Risk / Assurance / Audit Functional Contract v1.0](./38_Risk_Assurance_Audit_Functional_Contract.md)
39. [Insurance / Guarantee Functional Contract v1.0](./39_Insurance_Guarantee_Functional_Contract.md)
40. [Lesson Learned Functional Contract v1.0](./40_Lesson_Learned_Functional_Contract.md)
41. [Document Transmittal Functional Contract v1.0](./41_Document_Transmittal_Functional_Contract.md)
42. [Personnel Qualification / Deployment Functional Contract v1.0](./42_Personnel_Qualification_Deployment_Functional_Contract.md)
43. [Drawing Revision / Field Distribution Functional Contract v1.0](./43_Drawing_Revision_Field_Distribution_Functional_Contract.md)
44. [Daily Record / Evidence Functional Contract v1.0](./44_Daily_Record_Evidence_Functional_Contract.md)
45. [Role End-to-End Journeys v1.0](./45_Role_End_to_End_Journeys_v1.md)
46. [Product / Functional Baseline v1.0 Validation](./46_Product_Functional_Baseline_v1_Validation.md)
47. [Product Baseline v1.0 — Implementation Handoff Backlog](./47_Product_Implementation_Handoff_Backlog_v1.md)

### 현재 상태

- 체계·법령·현장절차: 기존 기준서 유지, 프로젝트별 적용성·원문 검토 필요
- 구현계약: 10개 상태모델·98개 전이·51개 권한정책·29개 조회 대장
- 사진·영상·발화: 원본·PTS·발화구간·처리범위·사람 확인 상세정의 및 결과 검증
- 36개 A4 양식: 필드·서명·출처 계약 및 HTML 구조 검증. DOCX/PDF 시각 QA는 후속 작업
- 참조 실행 검증: Core 108개 + HTTP/Application 66개 자동시험 PASS
- Mobile · Tablet · Responsive Web: 제품·화면 계약, 실제 앱 배포 전
- Stitch: Presentation / UI Design Source, 업무권한·판정의 원본은 Domain/State/Authority
- Product Baseline: 28개 관리대장 M3 + 계약·업무범위 Reference 1개
- 다음 단계: Backend/UI 구현 backlog → Project-specific configuration pack → 현장 시범운영

검증 방법은 [app README](./app/README.md)를 따른다. 계약과 참조 실행의 완료 범위는 [이슈 #1 검증서](./22_Issue_1_Resolution_Validation.md)에 명시했다.

Context7 리뷰의 7개 결함 수정과 추가 회귀검증은 [리뷰 수정 검증서](./24_Context7_Review_Fixes.md)를 따른다.

---


기준일: 2026-10-04

## 1. 목적

본 문서는 DOUL 고유의 건축감리 체계를 구축하기 위한 1차 연구 기준서다.

목표는 단순한 법정 감리서식이나 체크리스트를 만드는 것이 아니라 다음을 하나의 체계로 연결하는 것이다.

1. 한국·베트남 법령 및 감리기준 준수
2. 시공사 제출자료와 자체검측 관리
3. 감리 검측·검수 및 품질관리
4. 부적합·설계변경·공정·물량 관리
5. 발주처 보고와 의사결정 관리
6. 증빙과 기록의 추적성 확보
7. 프로젝트 경험의 재사용

---

## 2. DOUL 감리 기본원칙

### EXPLAIN
결과만 기록하지 않고 기준, 원인, 영향, 조치의 관계를 설명한다.

### VERIFY
자료 제출만으로 승인하지 않고 승인도면, 기준, 시험결과, 현장상태를 함께 검증한다.

### RECORD
사진이나 문서를 단순 보관하지 않고 문제 → 판단 → 결정 → 조치 → 재검증 → 종결의 이력으로 남긴다.

DOUL 감리의 기본 단위는 다음과 같다.

> 요구사항 → 증빙 → 확인 → 판단 → 조치 → 재검증 → 종결

---

## 3. 한국 감리 법령·기준 체계

### 3.1 일반 건축공사
- 「건축법」 제25조 공사감리
- 「건축법 시행령」 제19조 및 제19조의2
- 「건축법 시행규칙」
- 「건축공사 감리세부기준」 국토교통부고시 제2024-377호

주요 관리대상:
- 공사감리일지
- 건축공사감리 점검표
- 중간감리보고
- 감리완료보고
- 공사추진 및 설계변경
- 품질시험
- 인정자재
- 현장 사진·동영상

### 3.2 공공공사
- 「건설기술진흥법」
- 건설사업관리 관련 업무수행지침

### 3.3 별도 전문분야
- 소방시설공사
- 전력시설공사
- 정보통신공사
- 공동주택 감리

한국 감리체계는 분야별 법정 감리제도가 비교적 세분화되어 있고, 법정 감리인력 배치조건 역시 프로젝트 유형과 규모에 따라 별도로 확인해야 한다.

---

## 4. 베트남 감리 법령·기준 체계

2026년 7월 1일부터 새로운 건설법 체계가 시행되었으므로 과거 「Luật Xây dựng 2014」 및 「Nghị định 06/2021/NĐ-CP」만을 기준으로 사용해서는 안 된다.

### 4.1 핵심 현행 기준
- 「Luật Xây dựng 135/2025/QH15」(건설법)
- 「Nghị định 207/2026/NĐ-CP」(건설품질·시공·유지관리 시행령)
- 「Nghị định 212/2026/NĐ-CP」(건설활동 능력·자격 시행령)
- 「Thông tư 32/2026/TT-BXD」(건설부 세부규정)

### 4.2 주요 법정 개념
- 「Giám sát thi công xây dựng」(건설공사 시공감리)
- 「Giám sát trưởng」(감리단장)
- 「Giám sát viên」(감리원)
- 「Nghiệm thu công việc xây dựng」(시공작업 검수)
- 「Yêu cầu nghiệm thu」(검수요청)
- 「Biên bản nghiệm thu」(검수기록서)
- 「Nhật ký thi công」(시공일지)
- 「Bản vẽ hoàn công」(준공도면)
- 「Hồ sơ quản lý chất lượng」(품질관리 서류)

베트남은 한국처럼 모든 프로젝트에 적용되는 고정 감리인원표보다 공사의 규모·성격·기술조건에 맞는 충분한 감리인력과 해당 업무자격을 요구하는 구조가 중심이다.

---

## 5. 감리 전체 업무분류체계

| 코드 | 관리영역 | 핵심업무 |
|---|---|---|
| 00 | 법령·계약 기준관리 | 법령, 계약, 인허가, 적용기준 |
| 01 | 착수관리 | 감리계획, 조직, 현장 인수 |
| 02 | 시공사 자격·조직관리 | 기술자, 조직, 장비, 품질체계 |
| 03 | 도면관리 | 승인도면, 개정, 배포 |
| 04 | 시공사 제출자료관리 | 시공계획, 공법, 검측계획 |
| 05 | 자재·장비관리 | 자재승인, 견본, 반입검사 |
| 06 | 품질시험관리 | 시험계획, 시험기관, 시험결과 |
| 07 | 시공검측·검수관리 | 자체검측, 검수요청, 감리검측 |
| 08 | 부적합·시정관리 | 시정, 재시공, 재검측, 종결 |
| 09 | 설계·기술질의관리 | 기술질의, 설계오류, 기술검토 |
| 10 | 설계변경관리 | 변경사유, 영향, 승인, 개정도면 |
| 11 | 현장지시관리 | 지시, 기한, 이행확인 |
| 12 | 공정·물량·기성관리 | 지연, 물량, 기성, 변경물량 |
| 13 | 발주처 보고·의사결정 | 정기보고, 즉시보고, 결정요청 |
| 14 | 회의·공문·기록관리 | 회의록, 공문, 사진, 일지 |
| 15 | 안전·환경·소방관리 | 현장안전, 환경, 소방 |
| 16 | 시험운전·완료검수 | 시운전, 연동시험, 성능시험 |
| 17 | 준공·인수인계·하자 | 준공도면, 인수인계, 미완료·하자 |

---

## 6. 표준 업무흐름

시공사 자료 작성  
→ 시공사 내부검토  
→ 감리 제출  
→ 자료 완전성 확인  
→ 감리 기술검토  
→ 승인 / 조건부 승인 / 보완·반려  
→ 시공  
→ 시공사 자체검측  
→ 검측자료 및 「Yêu cầu nghiệm thu」(검수요청) 제출  
→ 감리 사전검토  
→ 현장검측·시험입회  
→ 「Nghiệm thu」(검수)  
→ 적합 / 부적합  
→ 시정·재시공  
→ 재검측  
→ 다음 공정 승인  
→ 준공도면·품질자료 반영

중요 원칙:

> 시공사가 자체검측과 필수 증빙자료를 제출하지 않으면 감리 검측을 정상 접수하지 않는 것을 원칙으로 한다.

---

## 7. 시공사 제출자료

### 7.1 착수자료
- 현장조직도
- 책임기술자 자격
- 장비투입계획
- 품질관리계획
- 안전관리계획
- 공정계획

### 7.2 시공자료
- 시공계획서
- 시공상세도
- 공법서
- 공정표

### 7.3 품질자료
- 검측계획
- 시험계획
- 자재승인자료
- 시험성적서
- 측량·계측자료

### 7.4 검측자료
- 시공사 자체검측표
- 검수요청서
- 관련 승인도면
- 사진
- 시험·측정결과
- 선행공정 승인자료
- 관련 설계변경·기술질의 자료

---

## 8. 감리 검측 중요도

아래 등급은 법정 용어가 아니라 DOUL 내부 관리등급이다.

### A — 필수확인점
감리 확인·승인 전 다음 공정 진행 금지.

대표항목:
- 최종 기초지반
- 주요 철근배근
- 콘크리트 매립물
- 주요 구조접합
- 방수 은폐 전
- 단열 은폐 전
- 천장 폐쇄 전 종합검측
- 배관 은폐 전 시험
- 접지망 매립 전
- 방화구획·관통부 폐쇄 전

### B — 입회확인점
감리 입회가 필요한 초도시공·시험·대표구간.

### C — 일반확인점
시공사 자체검측과 감리 표본·순회검사로 관리.

### 자동 상향조건
다음의 경우 C → B 또는 B → A로 관리강도를 높인다.
- 설계변경
- 신규 공법
- 반복 부적합
- 자재변경
- 시험 불합격
- 은폐 후 확인 불가능
- 구조·방화·안전 영향

---

## 9. 기본 관리대장

1. 법령·인허가 대장
2. 도면·개정 대장
3. 시공사 제출자료 대장
4. 시공상세도 대장
5. 자재승인 대장
6. 시험·검사 대장
7. 검측·검수 대장
8. 부적합·시정 대장
9. 기술질의 대장
10. 설계변경 대장
11. 현장지시 대장
12. 공정·지연 대장
13. 물량·기성 대장
14. 회의 결정사항 대장
15. 미결사항 대장
16. 준공·인수인계 대장
17. 발주처 보고 대장
18. 발주처 의사결정 대장
19. 주요위험·긴급보고 대장

모든 대장은 관련 이슈와 서로 연결하고 변경이력을 삭제하지 않는 것을 원칙으로 한다.

---

## 10. 발주처 보고체계

발주처 보고는 단순 보고서 작성업무가 아니라 의사결정 관리절차로 운영한다.

### 10.1 정기보고
- 주간·월간 현황
- 공정
- 품질
- 안전
- 비용·물량
- 인허가
- 주요 미결사항
- 다음 기간 중점사항

### 10.2 즉시보고
- 중대 품질문제
- 안전사고·중대위험
- 공사중지 필요사항
- 주요 설계오류
- 중대한 시험 불합격
- 주요 공정 지연
- 큰 비용변경 가능성
- 주요 인허가 문제

### 10.3 의사결정 요청 형식
현황 → 문제 → 영향 → 가능한 대안 → 감리 의견 → 발주처 결정사항 → 결정기한

### 10.4 결정 후 추적
보고 → 발주처 결정 → 지시·승인 → 실행 → 감리 확인 → 종결

---

## 11. 감리조직 기본구성

중형 이상 공장 프로젝트의 기본 검토조직은 다음과 같다.

- 감리단장
- 건축감리
- 구조감리
- 토목감리(필요 시)
- 기계감리
- 전기감리
- 소방담당 감리
- 안전담당
- 품질·시험담당
- 문서관리

프로젝트마다 다음 3가지를 구분한다.

1. 법정 최소인원
2. 계약 요구인원
3. DOUL 권장인원

베트남은 일률적인 고정 인원수보다 공사규모, 공사등급, 공정단계, 위험도, 계약조건에 따라 현장 감리인원을 결정하는 방식이 중심이므로 프로젝트 착수 시 별도의 인력배치 검토가 필요하다.

---

## 12. 베트남 감리인력 자격

### 12.1 감리단장
해당 분야 「Chứng chỉ hành nghề giám sát thi công xây dựng」(건설공사 감리업무 자격)을 보유하고 공사등급에 맞는 자격등급이어야 한다.

일반적으로:
- Hạng I(1급): 상위등급 포함 감리단장 수행범위가 가장 넓음
- Hạng II(2급): 2급 이하 공사 감리단장
- Hạng III(3급): 3급 이하 공사 감리단장

실제 배치는 최신 법령상의 공사등급 및 자격범위를 프로젝트별로 재확인한다.

### 12.2 건축·구조·토목
「Giám sát công tác xây dựng công trình」(건설공사 감리) 분야 자격.

DOUL은 법정 분야구분보다 강화해 건축·구조·토목 담당을 실무상 분리한다.

### 12.3 기계·전기
「Giám sát công tác lắp đặt thiết bị công trình」(설비설치 감리) 분야 자격.

DOUL은 기계와 전기를 실무상 분리한다.

---

## 13. 소방담당 감리

2025년 7월 1일 이후 과거의 별도 「Chứng chỉ hành nghề tư vấn PCCC」(소방 컨설팅 업무자격)을 개인에게 요구하는 구조는 폐지되었다.

그러나 이는 소방 시공감리가 무자격 업무라는 뜻이 아니다.

DOUL 내부기준:
- 관련 설비설치 감리자격
- 기계 또는 전기 관련 전공
- 소방 시공·시험·검수 경험
- 현행 소방 관련 법령·기준 숙지

즉 다음과 같이 구분한다.

- 소방 전용 감리자격증: 현행 별도 요구 없음
- 건설감리 자격: 수행업무에 따라 적용
- DOUL 소방 전문경력: 별도 요구

---

## 14. 안전담당

별도의 「건설안전감리 업무자격증」이라는 독립 자격은 확인되지 않는다.

그러나 안전업무 자체에는 별도의 법정 학력·경력·교육요건이 존재한다.

특히 현장에서 직접 안전을 감독하는 담당자는 「Nhóm 2」(2그룹) 산업안전·보건교육 대상에 해당하므로 관련 교육과 증명을 확인해야 한다.

또한 다음을 반드시 구분한다.

> 시공사 안전관리자 ≠ 감리단 안전담당

시공사의 법정 안전관리자를 감리단 안전담당으로 대체하지 않는다.

DOUL은 중대형 공장현장의 경우 별도 안전담당 배치를 기본 검토사항으로 한다.

---

## 15. 외국인 감리자

한국인 등 외국인도 베트남 감리업무 참여가 가능하나 한국의 건축사·기술자 자격이 자동으로 베트남 법정 감리자격으로 인정되는 것은 아니다.

검토항목:
- 외국 자격
- 학력
- 관련 감리경력
- 베트남 자격 인정·전환
- 근로허가
- 체류요건
- 업무기간
- 담당 감리분야

장기간 베트남에서 법정 감리업무를 수행하는 경우 「Chuyển đổi chứng chỉ hành nghề」(업무자격 전환) 여부를 반드시 확인한다.

---

## 16. 역할별 기본 책임

| 업무 | 시공사 | 감리 | 설계자 | 발주처 |
|---|---|---|---|---|
| 시공계획 | 작성 | 검토 | 필요 시 검토 | 승인체계 설정 |
| 시공상세도 | 작성 | 검토 | 설계사항 확인 | 필요 시 승인 |
| 자재자료 | 제출 | 검토·확인 | 필요 시 확인 | 주요사항 결정 |
| 자체검측 | 수행 | 확인 | - | - |
| 검수요청 | 요청 | 접수 | - | - |
| 현장검측 | 참여 | 주관 | 필요 시 참여 | 필요 시 참여 |
| 부적합 시정 | 조치 | 확인 | 필요 시 기술검토 | 중요사항 결정 |
| 설계변경 | 제안 가능 | 검토·제안 | 설계검토 | 최종 결정 |
| 시공물량 | 제출 | 확인 | - | 계약절차 |
| 준공도면 | 작성 | 확인 | 필요 시 확인 | 인수 |

---

## 17. 주요 시스템 원칙

### 17.1 미결사항 중심관리
미결사항 대장은 별도 문서를 만드는 것이 아니라 다른 모든 대장에서 종결되지 않은 항목을 통합해서 보여주는 화면으로 구성한다.

### 17.2 발주처와 감리 화면 분리
감리 화면:
- 오늘 검측
- 제출자료
- 부적합
- 시험
- 기한초과
- 재검측

발주처 화면:
- 전체공정
- 주요 품질문제
- 주요위험
- 비용·설계변경
- 인허가
- 의사결정 필요사항

### 17.3 증빙 추적성
모든 주요 검측은 위치, 날짜, 공종, 도면, 기준, 측정값, 사진, 시험결과, 담당자, 승인자를 연결한다.

---

## 18. 다음 연구과제

1. 한국·베트남 법령 조문별 요구사항 대조표
2. 프로젝트 유형·공사등급별 법정 감리인력 산정표
3. 상주·공정상주·비상주 적용기준
4. 공종별 A/B/C 검측 기준
5. 건축·구조·MEP·소방·안전 세부 체크리스트
6. 시공사 제출자료 표준목록
7. 발주처 보고 및 의사결정 표준서식
8. 19개 관리대장 데이터 구조
9. 베트남 법정 「Nghiệm thu」(검수) 서식과 DOUL 내부서식 통합
10. 준공·인수인계·하자관리 절차

---

## 19. 주요 확인 출처

### 한국
- 국가법령정보센터 「건축공사 감리세부기준」  
  https://www.law.go.kr/LSW/admRulInfoP.do?admRulSeq=2100000244148&chrClsCd=010201

### 베트남
- 「Luật Xây dựng 135/2025/QH15」(건설법)  
  https://vanban.chinhphu.vn/?classid=1&docid=216514&orggroupid=1&pageid=27160
- 「Nghị định 207/2026/NĐ-CP」(건설품질·시공·유지관리 시행령)  
  https://vanban.chinhphu.vn/?classid=1&docid=218450&pageid=27160&typegroupid=4
- 「Nghị định 212/2026/NĐ-CP」(건설활동 능력·자격 시행령)  
  https://vanban.chinhphu.vn/?classid=1&docid=218489&pageid=27160&typegroupid=4
- 「Thông tư 32/2026/TT-BXD」(건설부 세부규정)  
  https://vanban.chinhphu.vn/?classid=1&docid=218527&pageid=27160

---

## 20. 문서상태

- 버전: v0.1
- 성격: 연구 기준서
- 상태: 초안
- 주의: 프로젝트별 법정 감리인원, 공사등급, 외국인 자격, 소방·안전 세부요건은 실제 계약 및 착수 전 최신 법령과 관할기관 요구를 재확인한다.
