# 54. Implementation Progress Stage Ledger v1.0

기준일: 2026-10-06
목적: 근거 없는 진행률 대신 Product 계약부터 현장검증까지 증빙 가능한 단계로 진척도를 관리한다.
기계기록: `app/reference/implementation_progress_ledger_v1.json`

## 1. 단계

1. `contract_confirmed` — Product / Functional 계약 확정
2. `backend_api_implemented` — 해당 업무의 저장·명령·권한·API가 계약대로 구현되고 시험됨
3. `ui_connected` — 실제 API에 연결된 UI에서 허용 명령·오류·권한이 표현됨
4. `integration_passed` — Backend/UI/Platform을 연결한 인수 시나리오 PASS
5. `pilot_verified` — 실제 시범 프로젝트와 역할로 현장 인수 PASS

## 2. 승급원칙

- 단계 승급에는 `evidenceRefs`가 필요하다.
- 상위 단계의 일부 화면/코드가 존재한다는 사실만으로 중간단계를 건너뛰지 않는다.
- mock/demo/heartbeat/정적 화면은 업무 구현 증거가 아니다.
- 특정 하위기능만 완료된 경우 Function 전체를 상향하지 않고 Evidence에 부분범위를 기록한다.
- 결함 발견 시 단계 자체를 자동 하향하지 않는다. 해당 단계의 acceptance 상태를 `failed`/`revalidation_required`로 기록하고 수정·재검증한다.

## 3. 초기화 원칙

Product Baseline v1.0으로 F-01~F-17의 Contract는 확정됐으므로 초기 Ledger는 모두 `contract_confirmed`로 둔다.

이는 기존 Backend/UI 구현을 부정하는 의미가 아니다. 현재 구현을 실제 상위단계로 승급하려면 `49_Implementation_Acceptance_Scenarios_v1.md` 기준으로 Evidence를 연결해 재판정한다.

## 4. 병렬작업 표현

Queue/Worker, Object Storage, 인증, 알림, 문서출력 등은 개별 Function의 Stage와 별도 Foundation Track으로 관리한다. Foundation이 존재해도 F-01~F-17이 자동으로 `backend_api_implemented`가 되지 않는다.

반대로 Product Contract가 확정됐다는 이유만으로 Worker/Storage/Auth가 완료된 것으로 표시하지 않는다.

## 5. 완료 기준

프로젝트 시범운영 완료 시 선택된 필수 Function/Scenario가 `pilot_verified`에 도달하고, 권한·장애·복구 인수사례도 요구수준을 충족해야 한다.

## 2026-10-10 WWT operational-style demo validation (partial)

Dedicated local-development WWT demo database and actual API Evidence upload/download exercised for 20 synthetic cases with distinct capture IDs, SHA-256 checks, project-scope denial and idempotent rerun. See `55_WWT_Operational_Demo_Validation_Handoff_v1.md` and untracked private `.local/wwt-demo/manifest.json`. This is a **partial development verification**, not `integration_passed`, not `pilot_verified`, and not actual operating/field acceptance. Open items include real browser usability E2E, source WWT documents, the original 20 register scenarios and the five end-to-end business flows.
