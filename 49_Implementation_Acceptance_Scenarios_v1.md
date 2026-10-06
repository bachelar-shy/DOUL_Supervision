# 49. Implementation Acceptance Scenarios v1.0

기준일: 2026-10-06
목적: Product 계약을 Backend·UI·통합시험에서 같은 사례로 검증한다.
기계검증 카탈로그: `app/schema/implementation_acceptance_catalog_v1.json`

## 1. 공통 기준

각 시나리오는 정상경로만 보지 않는다. 최소 `정상 → 반려/실패 → 재작업 → 종결`과 권한·버전·중복요청 예외를 함께 검증한다.

공통 불변조건:
- 공식 기록은 exact version을 가진다.
- stale expectedVersion은 거부한다.
- 같은 Idempotency-Key 재시도는 중복 공식기록을 만들지 않는다.
- AI/SYSTEM/INTEGRATION은 인간 공식권한을 행사하지 않는다.
- 업무 종결과 Owner Report 후속조치 종결은 분리한다.

## 2. 필수 Pilot/E2E 시나리오

### AC-Q-01 품질 Closed Loop
Inspection FAIL → Issue → Action → Reinspection → Closure Evidence → Issue Close → Owner follow-up 별도 종결.

금지조건: Contractor Issue self-close, 초기 결함 Evidence만으로 close, Owner Report 자동 close.

### AC-S-01 안전 Stop / Resume
Permit 승인 → workAuthorized 확인 → 위험발견 → Stop → 시정 → 재검증 → 명시적 Stop Lift → Resume.

금지조건: Permit 승인만으로 작업가능, Issue close로 자동재개, CON self-resume.

### AC-SCH-01 지연 / EOT / Baseline
Baseline vN → Progress Update → DelayEvent → Recovery → Notice/EOT → Owner Decision → 승인된 경우에만 Baseline vN+1.

금지조건: Forecast가 Baseline을 덮어씀, DelayEvent만으로 EOT 인정.

### AC-PAY-01 물량 / 기성 / 지급
Quantity Measurement → verified → Payment Claim → SUP recommendation → Owner approval/adjustment → Payment Record.

금지조건: claimed=verified 자동처리, SUP 추천=지급승인, 승인=실제지급.

### AC-HO-01 시운전 / 인수 / 하자
Commissioning Test → Handover Readiness → Owner Acceptance → Warranty Defect → Remedy → Reinspection → Close.

금지조건: Test pass=Handover, Handover=Warranty close.

### AC-MEDIA-01 미디어 E2E
Resumable upload → hash verify → AnalysisRun → frame/transcript/coverage → AI candidate → SUP confirm/reject → eligible candidate만 공식 Issue 생성.

금지조건: no_findings=Inspection pass, speech-only candidate로 Issue, 누락구간이 있는데 complete=true.

## 3. 권한·장애 시나리오

- AC-AUTH-01: 다른 프로젝트 사용자의 객체 접근/명령 거부
- AC-QUAL-01: 자격 만료 후 공식 판정 명령 거부, 과거 서명은 보존
- AC-ADM-01: ADM이 기술승인/Issue close 시도 시 거부
- AC-VERSION-01: stale version write 거부와 UI conflict 표시
- AC-IDEMP-01: 중복 submit/retry가 공식 객체를 중복생성하지 않음
- AC-STORE-01: 파일 저장 실패 시 Domain 결과를 성공으로 확정하지 않음
- AC-WORKER-01: Worker 중단/재시작 후 중복 결과 없이 재처리 또는 명시적 실패
- AC-REPORT-01: Domain close 후에도 Owner Action/Decision 미종결이면 Report close 불가
- AC-OFFLINE-01: 오프라인 재연결 시 last-write-wins 금지, 충돌을 사용자에게 노출

## 4. 업무별 구현 인수판정

각 기능은 다음 5단계를 별도로 기록한다.

1. Contract 확정
2. API/Backend 구현
3. UI 실제 연결
4. Integration Scenario PASS
5. Pilot 현장 검증

`설계 M3`는 1단계 완료를 의미하고 2~5단계 완료로 표시하지 않는다.

## 5. 인수 Evidence

각 시나리오 결과에는 최소:
- baseline/config version
- build/commit
- actor/role setup
- input IDs/versions
- command/result
- expected/actual
- failure reason if failed
- screenshots/log references if applicable
을 남긴다.
