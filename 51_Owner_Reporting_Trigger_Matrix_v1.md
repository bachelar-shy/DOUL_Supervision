# 51. Owner Reporting Trigger Matrix v1.0

기준일: 2026-10-06
목적: 각 업무에서 즉시보고·정기보고·결정요청·후속조치 종결을 빠뜨리지 않는다.

| Function | 즉시보고 후보 | 정기보고 | Decision Request | 업무 종결과 Report 종결 |
|---|---|---|---|---|
| F-01 제출/Shop Drawing | critical 승인 지연, 현장사용 위험 | 제출/승인 현황 | 주요 설계/공정 선택 | 제출 완료와 Owner Report close 분리 |
| F-02 자재/시험 | critical material 불합격, 설치 후 Fail | 승인·반입·시험 현황 | 대체자재/영향 결정 | Test/Issue close 후에도 Report follow-up 확인 |
| F-03 Safety | 중대위험, Stop, 사고/Near Miss | Permit/Stop 추세 | 장기중지·비용/공기 영향 | Stop Lift와 Owner Report close 분리 |
| F-04 Schedule | Completion/Milestone critical delay | variance/forecast/recovery | Recovery 대안·Acceleration·Owner blocker | DelayEvent close와 EOT/Report close 분리 |
| F-05 Payment | 큰 금액차, 중요 지급보류, Contract Amount risk | Claim/Recommendation/Payment | 승인·조정·분쟁 | Payment Record와 관련 Report close 분리 |
| F-06 Fire/Environment | 통합시험 실패, 환경초과/사고, 법정지연 | Compliance status | 운영/인수/공기 영향 | Compliance 상태와 Owner Action close 분리 |
| F-07 Handover/Warranty | 인수일 위험, major test fail, 운영영향 하자 | readiness/punch/warranty | 조건부/부분 인수 | Handover/Warranty case와 Report close 분리 |
| F-08 Notice/Claim/EOT | notice deadline risk, 큰 time/cost exposure | open claim/EOT | entitlement/time/cost 결정 | Claim close와 Decision/Report close 분리 |
| F-09 Permit | rejection, expiry, critical approval delay | permit dashboard | 설계/공정 대응 결정 | Permit case와 Report close 분리 |
| F-10 Site Instruction | 안전/품질 긴급지시, 큰 Change 가능성 | open/overdue instruction | 비용/공기/설계 변경 | Instruction verification과 Report close 분리 |
| F-11 Risk/Audit | Critical risk/finding | Top risks/audit status | residual risk acceptance | Audit close와 Owner follow-up 분리 |
| F-12 Insurance | expiry/call/release risk | validity dashboard | waiver/release/call | Instrument close와 Decision close 분리 |
| F-13 Lesson | 원칙상 즉시보고 아님 | 주요 반복원인/개선 | 표준변경 결정 | Lesson close와 Change implementation 분리 |
| F-14 Transmittal | critical delivery failure | overdue response | 공식 회신 필요 시 | delivery/receipt와 승인/Report 분리 |
| F-15 Personnel | 핵심자격 만료/필수인력 공백 | deployment status | 주요 replacement 승인 | 배치 close와 관련 Risk/Report 분리 |
| F-16 Drawing | 현장 obsolete drawing 사용 | revision/distribution | 중요 revision/change | release/distribution과 Owner Decision 분리 |
| F-17 Daily Record | 중대사실 발견 시 해당 Domain으로 즉시보고 | Daily/Weekly source | 직접 Decision보다 관련 Domain 전환 | DailyRecord freeze와 Report close 분리 |

## 적용 규칙

1. Trigger 발생은 보고 초안/알림의도 생성 근거이며 자동 발행·결정이 아니다.
2. 같은 사건이 여러 Function에 걸쳐도 Owner Report sourceDomainRefs로 원 출처를 유지한다.
3. P1~P4 분류와 구체 기한·수신자는 Project Configuration Pack에서 확정한다.
4. Domain 업무 종결이 Owner Report의 Decision/Action을 자동 종결하지 않는다.
5. 발주처 수령확인은 승인으로 해석하지 않는다.
