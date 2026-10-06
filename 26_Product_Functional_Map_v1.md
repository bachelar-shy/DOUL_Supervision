# 26. DOUL Supervision Product / Functional Map v1.0

기준일: 2026-10-06
문서상태: Product / Functional Baseline 초안 v1.0
담당영역: Product / Functional Design
비담당영역: UI 구현, Backend 구현, Infrastructure / DevOps 구현

---

## 1. 목적

이 문서는 DOUL Supervision의 감리업무 전체를 제품 관점에서 하나의 구조로 정리한다.

기준 순서는 다음과 같다.

> 업무목적 → Actor / 책임 → 기능 → 상태흐름 → 업무규칙 / Gate → 완료조건 → Domain Contract → API / UI

API, DB, 화면구조는 이 문서의 상위 기준을 구현하는 수단이며 Product / Functional 정의의 원천이 아니다.

현재 Repository 계약 기준은 다음과 같다.

- Core / Auxiliary Domain Object: 22종
- State Machine: 10개
- State Transition: 98개
- Authority Policy: 51개
- Register: 29개
- A4 업무양식: 25개
- 통합 Projection View: 4개

29개 관리대장은 각각 독립된 업무시스템이 아니다. 일부는 실제 Workflow를 실행하는 업무 Surface이고, 일부는 여러 Domain Object를 집계하는 Projection이며, 일부는 기준정보를 보여주는 Reference Register다.

---

## 2. Product / Functional 경계

### 2.1 Product / Functional이 결정하는 것

- 감리 업무 프로세스
- Actor와 책임
- 업무 권한
- 기능 목록
- Trigger와 Input
- 상태 흐름
- 업무규칙과 Gate
- 예외·반려·재수행 조건
- 완료조건
- 업무 객체 간 관계
- 대장과 양식의 업무적 의미
- 발주처 보고·결정·회신·후속조치 구조

### 2.2 다른 개발축이 결정하는 것

**Backend**
- API 구현
- Application Service
- DB / Transaction
- Authentication 구현
- Worker / Queue 처리코드
- AI Provider Adapter

**UI/UX**
- Navigation
- 화면 Layout
- Component
- Interaction
- Responsive / Mobile UX

**Platform / Infrastructure**
- Server
- Container
- CI/CD
- Database Runtime
- Object Storage Runtime
- Logging / Monitoring
- Backup / Restore

Backend, UI, Platform이 업무규칙을 변경해야 할 필요가 생기면 Product / Functional에 변경요청을 올리고 여기서 먼저 확정한다.

---

## 3. L1 Product Functional Domain

| 코드 | Functional Domain | 목적 | 주요 Actor | 핵심 객체 |
|---|---|---|---|---|
| D1 | Project / Governance | 프로젝트 기준·법령·계약·조직·자격을 기준선으로 관리 | ADM, SUP, OWN | Project, Requirement, Party, RoleAssignment, Qualification |
| D2 | Document / Design Control | 도면·제출자료·시공상세도·자재승인과 버전을 통제 | CON, SUP, DES | InformationItem, WorkItem, Approval, Asset |
| D3 | Field Quality Control | 자재반입·시험·검측·부적합·시정·재검측을 폐쇄형으로 관리 | CON, SUP, TEST_LAB | Inspection, Observation, Issue, Action, Evidence |
| D4 | Technical Coordination | RFI·현장지시·설계변경·기술승인을 추적 | CON, SUP, DES, OWN | WorkItem, Decision, Approval, InformationItem |
| D5 | Safety / Compliance | 고위험작업·안전·소방·환경의 사전조건과 위반조치를 관리 | CON, SUP, OWN, AUTHORITY | Inspection, Issue, Requirement, WorkItem |
| D6 | Schedule / Commercial / Contract | 공정·지연·기성·계약통지·Claim·EOT·보험을 관리 | CON, SUP, OWN, ADM | WorkItem, Decision, Approval, Evidence |
| D7 | Owner Governance | 정기보고·즉시보고·의사결정·수령·후속조치를 폐쇄형으로 관리 | SUP, OWN, ADM | Report, Decision, Action, Approval |
| D8 | Risk / Assurance | 위험·기회·내부감사·준수·경험교훈을 관리 | SUP, ADM, OWN | WorkItem, Issue, Action, Decision, Requirement |
| D9 | Completion / Handover | 시운전·완료검수·인수인계·Punch·하자를 관리 | CON, SUP, OWN, DES | Inspection, Issue, WorkItem, InformationItem |
| D10 | Cross-cutting Capabilities | Evidence·AI·버전·감사·서명·알림·Offline·Projection을 공통 제공 | ALL + AI/SYSTEM/INTEGRATION | Evidence, AnalysisRun, AuditEvent, Signature, DocumentSnapshot, Notification |

---

## 4. Actor Map

| Actor | Product 책임 |
|---|---|
| SUP | 공식 검측·판정, Observation 확인, Issue 발행·배정, 시정검증, 재검측, 기술검토, 발주처 보고, 종결검증 |
| CON | 자체검측, 검수요청, 자료제출, RFI, 시정조치, 재검측요청, 승인된 변경 실행 |
| OWN | 보고 수령확인, 발주처 결정, 계약·비용·공기 및 지정 승인권한 |
| DES | RFI 회신, 설계검토, 개정정보 발행 |
| ADM | 프로젝트·사용자·기준정보 관리. SUP의 기술권한을 자동 상속하지 않음 |
| AI | Observation Candidate 생성 보조. 공식 판정권한 없음 |
| SYSTEM | SLA, 분석 실행, Projection 갱신 등 비인적 자동처리. 공식 인간 권한 없음 |
| INTEGRATION | 외부 정보·Evidence 유입. 공식 승인권한 없음 |
| TEST_LAB / EXTERNAL_REVIEWER / AUTHORITY | 출처 또는 외부 검토 주체. 기본적으로 일반 앱 로그인 역할과 분리 |

---

## 5. Core Product Spine

DOUL Supervision의 핵심 업무 Spine은 다음과 같다.

~~~text
Requirement / Contract / Approved Drawing
                    ↓
            Submission / Approval
                    ↓
             Construction
                    ↓
         Self Inspection / Request
                    ↓
              Inspection
                    ↓
             Evidence
                    ↓
         Human Technical Judgment
             ┌──────┴──────┐
           PASS           FAIL
             │              │
     Next Work Gate       Issue
             │              ↓
             │       Corrective Action
             │              ↓
             │         Reinspection
             │              ↓
             └────────→ Verify / Close
                            ↓
                    Owner Reporting
                            ↓
                  Decision if required
                            ↓
                         Action
                            ↓
                         Verify
                            ↓
                          Close
~~~

원칙:

1. 제출과 승인은 다르다.
2. 열람과 수령확인은 다르다.
3. 수령확인과 승인은 다르다.
4. 검측 합격과 후속공정 Release는 다르다.
5. Issue 시정완료와 Issue Close는 다르다.
6. Issue Close와 발주처 보고 종결은 다르다.
7. AI 분석결과와 공식 감리판정은 다르다.
8. RFI 답변은 설계변경 승인으로 간주하지 않는다.
9. 모든 공식 결정은 Actor·시각·대상 버전·Evidence와 연결한다.

---

## 6. 현재 State Machine Coverage

현재 명시적 State Machine은 다음 10개다.

| Machine | Product 기능 |
|---|---|
| observation | AI/현장 관찰후보 → 사람 검토 → 확인/기각 |
| inspection | 검수요청 → 완전성검토 → 일정 → 현장검측 → 판정 → 후속공정 Gate |
| issue | 공식 부적합 → 배정 → 시정 → 재검측 → 종결/재시정 |
| action | 조치 배정 → 수행 → 제출 → 검증 → 종결 |
| rfi | 기술질의 제출 → 감리검토 → 책임자 회신 → 감리검토 → 종결 |
| change | 변경제안 → 영향검토 → 결정 → 개정정보 → 실행 → 검증 → 종결 |
| approval | 승인요청 → 검토 → 승인/반려/보완 → 만료/취소/대체 |
| decision | 발주처 의사결정 요청 → 수령 → 결정 → 실행 → 검증 → 종결 |
| report | 보고 작성 → 검토 → 발행 → 수령 → 후속조치 → 검증 → 종결 |
| analysis_run | 사진·영상·발화 분석 작업 실행상태 |

이 10개 Machine이 모든 29개 대장의 업무를 완전히 정의한다는 뜻은 아니다. 여러 대장이 이 Machine을 재사용하지만, 해당 업무 특유의 Trigger·Gate·완료조건이 아직 충분히 정의되지 않은 경우가 있다.

---

## 7. Coverage 평가기준

이 문서의 성숙도는 코드 구현률이 아니라 Product / Functional 정의 성숙도다.

| 등급 | 의미 |
|---|---|
| M3 | Actor, Trigger, 상태/명령, Gate, Evidence, 예외, 완료조건이 명시된 폐쇄형 Workflow |
| M2 | 업무절차와 데이터/양식은 정의됐으나 업무 특유의 상태·Gate·완료조건 중 일부를 더 정규화해야 함 |
| M1 | Register / Data / Form은 있으나 Workflow 계약이 아직 얕음 |
| R | 기준정보 또는 참조 Projection이 주목적이며 별도 Workflow를 만들 필요가 없음 |

read-only Register와 Maturity는 같은 의미가 아니다. Read-only Projection이라도 원천 Domain Workflow가 완전하면 Product 기능은 완전할 수 있다.

---

## 8. 29개 관리대장 × Functional Domain Coverage Matrix

| No. | 관리대장 | Domain | 현재 역할 | 연결 Workflow | 양식 | 성숙도 | 다음 Product / Functional 과제 |
|---|---|---|---|---|---|---|---|
| 01 | 법령·인허가 | D1 | 기준+상태 Projection | Requirement 중심 | - | M2 | 인허가 적용성, 제출, 보완, 승인, 만료, 변경 영향의 업무 Gate 정규화 |
| 02 | 계약·업무범위 | D1 | 기준정보 | 변경은 14/26으로 분리 | - | R | 기준선·유효기간·업무범위 참조 유지. 별도 상태머신 불필요 |
| 03 | 인력·자격 | D1 | 기준+배치 Projection | RoleAssignment / Qualification | - | M2 | 배치요청·검증·승인·대체·만료/철수 절차 명확화 |
| 04 | 도면·개정 | D2 | 버전 Projection | Change / Approval과 연결 | FM-03 | M2 | 발행·수령·현재본·폐기도면·대체본·현장배포 Gate 명확화 |
| 05 | 문서송수신 | D2 | 기록 Projection | Notification / InformationItem | FM-01 | M1 | 송신·수신·접수·회신기한·공식전달 증빙의 업무 계약 필요 |
| 06 | 시공사 제출자료 | D2 | 제출자료 Projection | F-01 Submission + Approval | FM-01, FM-02 | M3 | F-01에서 Revision 불변성, 완전성검토, 기술검토, 최종판정, 재제출, 배포까지 확정 |
| 07 | 시공상세도 | D2/D4 | 설계·시공성 검토 | F-01 + Approval / RFI / Change | FM-03 | M3 | F-01에서 설계의도·다분야 간섭·RFI/Change 분기·Release/Supersede까지 확정 |
| 08 | 자재승인 | D2/D3 | 승인 Projection | F-02 Material Approval | FM-04 | M3 | F-02에서 제품 Identity, Sample/Mock-up, 동등품, 승인 Scope·유효성까지 확정 |
| 09 | 자재반입검사 | D3 | 실행형 | F-02 + Inspection | FM-05 | M3 | F-02에서 실제 Lot, Approval Match, Quarantine, 사용 Release까지 확정 |
| 10 | 시험·계측 | D3 | 결과 Projection | F-02 Test Request + Issue | FM-06 | M3 | F-02에서 Sampling Chain, Lab, 시험판정, Failed Test, Retest까지 확정 |
| 11 | 검측·검수 | D3 | 핵심 실행형 | Inspection | FM-07~10 | M3 | 현 상태 유지. 공종별 Gate/ITP 확장 |
| 12 | 부적합·시정 | D3 | 핵심 실행형 | Issue + Action + Reinspection | FM-12, FM-13 | M3 | 반복 시정주기·발주처 보고 연계를 지속 검증 |
| 13 | 기술질의 | D4 | 실행형 | RFI | FM-15 | M3 | 답변이 Change/Approval을 자동 대체하지 않는 원칙 유지 |
| 14 | 설계변경 | D4 | 실행형 | Change + Approval + Decision | FM-03, FM-16 | M3 | 기술승인과 계약/비용/공기 결정 권한 분리 유지 |
| 15 | 현장지시 | D4 | 실행형 | Action 재사용 | FM-14 | M2 | 지시 발행권한, 수령확인, 이의/질의, 완료확인, 설계변경 전환조건 상세화 |
| 16 | 공정·지연 | D6 | 현황 Projection | F-04 Schedule + DelayEvent + RecoveryPlan | FM-19 | M3 | F-04에서 Baseline, Data Date, Progress Update, Delay Impact, Recovery, EOT 경계까지 확정 |
| 17 | 물량·기성 | D6 | 현황 Projection | F-05 ContractBOQ + QuantityMeasurement + PaymentClaim | FM-26 | M3 | F-05에서 BOQ, 수량검증, 지급적격성, 추천, 발주처승인, 실제지급까지 확정 |
| 18 | 안전·고위험작업 | D5 | 실행형 | F-03 SafetyPermit + SafetyStopOrder + Issue | FM-02, FM-17 | M3 | F-03에서 Permit 상태, Pre-start Gate, 작업중지, 재개승인, workAuthorized까지 확정 |
| 19 | 안전검사 장비·기계 | D5 | 자격/검사 Projection | F-03 SafetyEquipmentInspection + Certificate | FM-17 | M3 | F-03에서 검사·인증·교정·사용중지·재검사·Equipment Readiness까지 확정 |
| 20 | PCCC(소방) | D5 | 실행형 | Requirement + Inspection | - | M2 | 설계/시공/시험/자체검수/관할기관 단계와 법정문서 Gate 상세화 |
| 21 | 환경 | D5 | 실행형 | Issue 중심 | - | M2 | 환경조건·측정·위반·시정·대관보고·재확인 Workflow 정규화 |
| 22 | 회의·발주처 보고·결정 | D7 | 핵심 실행형 | Report + Decision + Action + Approval | FM-16, FM-19~21 | M3 | 정기·즉시·의사결정·수령·후속검증의 독립성 유지 |
| 23 | 일일기록·사진증빙 | D10 | Evidence Projection | Evidence + AnalysisRun | FM-18 | M2 | 일일기록 완료/서명 기준과 사진·영상·발화 분석결과의 공식 반영경계 명확화 |
| 24 | 준공·인수·하자 | D9 | 실행형 | Inspection + Issue 재사용 | FM-11, FM-23~25 | M2 | Commissioning/Handover/Warranty Package별 전용 상태·Gate 상세화 |
| 25 | 위험·기회 | D8 | 실행형 | Decision 재사용 | FM-20 | M2 | 식별→평가→대응→잔여위험→모니터링→종결의 Risk Workflow 정규화 |
| 26 | 계약통지·클레임·공기연장 | D6 | 실행형 Projection | Decision 재사용 | - | M1 | Notice 기한, entitlement, substantiation, 검토, 결정, EOT/비용 반영 Workflow 필요 |
| 27 | 보험·보증 | D6 | 기준/만료 Projection | Certificate 참조 | - | M1 | 제출·적합성확인·만료·갱신·보증금 반환조건과 알림 계약 필요 |
| 28 | 내부감사·준수점검 | D8 | 실행형 | Issue + Action 재사용 | - | M2 | Audit 계획→수행→Finding→시정→독립검증→종결 구조 상세화 |
| 29 | 경험·교훈 | D8 | 지식 Projection | Requirement / Decision 참조 | - | M1 | Lesson 후보→검토→채택→표준/Checklist 반영→효과확인의 학습 Loop 필요 |

### 8.1 현재 분포

- M3: 14개 — 06, 07, 08, 09, 10, 11, 12, 13, 14, 16, 17, 18, 19, 22
- M2: 10개 — 01, 03, 04, 15, 20, 21, 23, 24, 25, 28
- M1: 4개 — 05, 26, 27, 29
- R: 1개 — 02

핵심 판단:

> Inspection / Issue / RFI / Change / Owner Governance는 깊게 정의됐으나, 제출·자재·시험·공정·기성·안전허가·Claim/EOT·준공 Package는 동일한 깊이의 Functional Contract가 아직 부족하다.

---

## 9. 25개 양식 Coverage

양식은 Workflow를 대신하지 않는다. 양식은 Domain Data를 공식 기록물로 표현하는 Output이다.

~~~text
Domain / Workflow
      ↓
Form Data
      ↓
Template
      ↓
Document Snapshot
      ↓
Signature / Distribution
~~~

현재 주요 연결은 다음과 같다.

| 업무군 | 양식 |
|---|---|
| 제출·시공계획 | FM-01, FM-02 |
| 상세도·자재 | FM-03, FM-04 |
| 자재반입·시험 | FM-05, FM-06 |
| 검측·검수 | FM-07 ~ FM-11 |
| 부적합·시정 | FM-12, FM-13 |
| 현장지시·RFI·변경 | FM-14 ~ FM-16 |
| 안전 | FM-17 |
| 일일·정기보고 | FM-18, FM-19 |
| 발주처 즉시보고·결정 | FM-20, FM-21 |
| 미결사항 | FM-22 |
| 준공·인수·하자 | FM-23 ~ FM-25 |

현재 양식이 없는 대장 중 Product 관점에서 우선 검토할 대상은 다음과 같다.

- 17 물량·기성
- 20 PCCC(소방) — 법정 원본서식과 내부 보조양식 구분 필요
- 21 환경
- 26 계약통지·클레임·공기연장
- 27 보험·보증
- 28 내부감사·준수점검
- 29 경험·교훈

모든 대장에 DOUL 양식을 강제로 만들 필요는 없다. 공식 법정서식 또는 원본 외부문서를 그대로 관리해야 하는 업무는 자체 양식보다 원본 연결과 Snapshot 보존이 우선이다.

---

## 10. Cross-cutting Functional Capabilities

| Capability | 기능 원칙 | 현재 Product 정의 상태 |
|---|---|---|
| Evidence | 원본 불변, 출처·시각·위치·대상 연결 | 상세정의됨 |
| Photo / Video / Audio | 현장 Evidence 수집 | 상세정의됨 |
| AI Analysis | Candidate 생성 보조, 인간 공식판정 필수 | 상세정의됨 |
| Version Control | Requirement/도면/승인/보고 대상 버전 보존 | 상세정의됨 |
| Authority | Actor + Role + Project + Scope + Qualification | 상세정의됨 |
| Audit | 공식 Command의 Before/After와 Actor 기록 | 상세정의됨 |
| Signature | 법적/공식 서명과 일반 확인행위 구분 | 기본계약 있음 |
| Document Snapshot | 발행시점 데이터·양식버전 고정 | 기본계약 있음 |
| Notification / SLA | 기한초과 알림, 자동승인 금지 | 기본계약 있음 |
| Offline / Sync | stale write 차단, last-write-wins 금지 | 기본원칙 있음 |
| Register Projection | Domain 상태를 조회·집계, 별도 독립상태 금지 | 상세정의됨 |
| Search / Filter | 프로젝트·공종·위치·책임·상태 기반 탐색 | UI/제품 상세화 필요 |
| Dashboard / KPI | 원천대장 자동집계, 수기 중복작성 최소화 | 기본정의 있음 |

---

## 11. Functional Gap 우선순위

### P0 — 다음 Backend 기능개발 전에 Product 계약을 먼저 상세화

#### F-01 시공사 제출자료 / 시공상세도
대상: 06, 07

정의할 것:
- 제출주체
- 완전성검토
- 분야별 검토
- 설계자 Referral
- 보완/재제출
- 승인유형
- 승인 유효버전
- 현장배포
- 폐기도면 차단
- Change 전환조건

#### F-02 자재승인 / 반입 / 시험 연계
대상: 08, 09, 10

정의할 것:
- Material Submittal
- 샘플/Mock-up
- 시험성적/인증
- 승인 Revision
- Material Lot
- 반입검사
- 불일치
- 시험기관
- Sample Chain
- Retest
- Issue 전환

### P1 — 현장 운영 핵심

#### F-03 Safety Permit / Stop / Resume
대상: 18, 19

#### F-04 Schedule / Delay / Recovery
대상: 16

#### F-05 Progress Measurement / Payment
대상: 17

#### F-06 PCCC / Environment Compliance
대상: 20, 21

#### F-07 Commissioning / Handover / Warranty
대상: 24

#### F-08 Contract Notice / Claim / EOT
대상: 26

### P2 — Governance 강화

#### F-09 Regulatory / Permit Lifecycle
대상: 01

#### F-10 Site Instruction
대상: 15

#### F-11 Risk / Assurance
대상: 25, 28

#### F-12 Insurance / Guarantee
대상: 27

#### F-13 Lesson Learned
대상: 29

#### F-14 Document Transmittal
대상: 05

---

## 12. 각 Functional 상세설계의 표준 Template

앞으로 모든 기능은 아래 형식으로 정의한다.

| 항목 | 정의 |
|---|---|
| Function ID | 고유 기능번호 |
| Functional Domain | D1~D10 |
| 업무목적 | 왜 필요한가 |
| Primary Actor | 책임주체 |
| Supporting Actor | 협조/검토주체 |
| Trigger | 업무 시작조건 |
| Preconditions | 선행조건 |
| Input | 필수 입력/증빙 |
| Command | 사용자가 실행하는 업무행위 |
| State | 상태 |
| Gate | 다음 단계 진입조건 |
| Decision Right | 누가 판정/승인하는가 |
| Exception | 반려·보완·취소·재수행 |
| SLA / Due | 내부/계약/법정 기한 |
| Output | 결과 객체/문서 |
| Evidence | 필수 증빙 |
| Completion Criteria | 언제 완료인가 |
| Related Register | 29개 대장 |
| Related Form | 25개 양식 |
| Owner Reporting Trigger | 발주처 보고조건 |
| Audit Requirement | 기록해야 할 이력 |

Backend는 이 Template에서 확정된 Command/State/Gate/Decision Right를 구현하고, UI는 Actor별로 가능한 업무행위를 표현한다.

---

## 13. 역할별 End-to-End Journey — 다음 정의대상

### SUP
Today → Review Queue → Inspection → Observation/Issue → Verification → Owner Report → Closure

### CON
Submission → Self Check → Inspection Request → Correction → Reinspection Request → Completion

### OWN
Dashboard → Report Receipt → Decision Queue → Decision → Follow-up Status → Closure

### DES
RFI Queue → Technical Response → Change / Revision → Issue Information

### ADM
Project Setup → Party/Role/Qualification → Baseline → Reporting Rule → Audit / Access Management

각 Journey는 화면 순서가 아니라 업무책임 순서로 정의한다.

---

## 14. Product / Functional Baseline v1.0 완료조건

다음 조건을 모두 만족해야 Product / Functional Baseline을 v1.0으로 확정한다.

1. 29개 대장 각각의 역할이 Workflow / Projection / Reference로 분류됨
2. 업무 Workflow 대상은 Primary Actor와 Decision Right가 확정됨
3. Trigger / Input / State / Gate / Completion이 정의됨
4. 발주처 보고 Trigger와 후속조치 연결이 정의됨
5. 25개 양식과 Domain Source가 연결됨
6. 법정 원본서식과 DOUL 내부서식이 구분됨
7. SUP / CON / OWN / DES / ADM Journey가 완결됨
8. UI가 독자적인 업무상태를 만들지 않도록 계약됨
9. Backend가 Product 상태/권한을 임의 변경하지 않도록 변경절차가 정의됨
10. 미정의 영역이 명시적으로 Backlog에 남고 우선순위가 부여됨

---

## 15. 개발축 간 변경관리

~~~text
Product / Functional Change
          ↓
Domain / Workflow Contract
          ↓
Backend Contract / API
          ↓
UI Consumption
          ↓
Platform Runtime
~~~

### Product 변경 예

- 시공사에게 Issue Close 권한 추가
- Inspection 단계 추가
- 발주처 승인조건 변경
- Material Approval 완료조건 변경

이 경우 Product / Functional에서 먼저 확정한다.

### Backend 구현변경 예

- DB Index
- Transaction 분리
- Cache
- Queue
- API 내부구조

업무 의미가 바뀌지 않으면 Backend에서 독립 결정할 수 있다.

### UI 변경 예

- Tab 위치
- Card Layout
- Modal / Drawer
- Responsive Breakpoint

업무 권한이나 상태 의미가 바뀌지 않으면 UI에서 독립 결정할 수 있다.

---

## 16. 다음 작업

Product / Functional의 다음 상세설계 순서는 다음으로 한다.

1. **F-01 시공사 제출자료 / 시공상세도 — 상세계약 완료 (`27_Submission_Shop_Drawing_Functional_Contract.md`)**
2. **F-02 자재승인 / 반입 / 시험 — 상세계약 완료 (`28_Material_Approval_Receiving_Test_Functional_Contract.md`)**
3. **F-03 Safety Permit / Stop / Resume — 상세계약 완료 (`30_Safety_Permit_Stop_Resume_Functional_Contract.md`)**
4. **F-04 Schedule / Delay / Recovery — 상세계약 완료 (`31_Schedule_Delay_Recovery_Functional_Contract.md`)**
5. **F-05 Progress Measurement / Payment — 상세계약 완료 (`32_Progress_Measurement_Payment_Functional_Contract.md`)**
6. **F-06 PCCC / Environment Compliance — 다음 상세설계**
7. F-07 Commissioning / Handover / Warranty
8. F-08 Contract Notice / Claim / EOT
9. 역할별 End-to-End Journey
10. Product / Functional Baseline v1.0 최종검증

이 순서는 단순 관리대장 번호순이 아니라 현장 착공 전 승인 → 현장 품질 → 리스크 → 공정/비용 → 준공의 의존관계를 기준으로 한다.
