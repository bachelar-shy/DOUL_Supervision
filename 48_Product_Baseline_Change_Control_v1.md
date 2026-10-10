# 48. Product Baseline Change Control v1.1

기준일: 2026-10-10
상태: Product / Functional 운영계약
기준선: Product / Functional Baseline v1.1 승인; 검증된 릴리스 채택 전까지 v1.0 효력 유지

## 1. 목적

구현 과정에서 상태·권한·Gate·판정·종결조건을 임의로 바꾸지 않고, 변경 이유·영향·적용 버전·검증사례를 남긴다.

## 2. 변경 분류

| 등급 | 의미 | 예 | 처리 |
|---|---|---|---|
| C0 | 의미변경 없음 | 문구, 오탈자, UI 배치 | Baseline 버전 유지, 기록 선택 |
| C1 | 호환 가능한 명확화/확장 | 새 Project 설정값, 기존 Trigger 명시, 기존 상태의 필드 보강 | v1.x 변경기록 필수 |
| C2 | 기존 구현에 영향 있는 호환 확장 | 새 command payload 필드, 새 예외분기, 신규 보고 Trigger | v1.x + 구현영향/회귀시험 필수 |
| C3 | 의미를 깨는 변경 | 기존 Decision Right 변경, 상태 의미 변경, 종결조건 완화, 기존 승인 의미 변경 | v1.x에 직접 반영 금지. 새 Major Baseline 또는 명시적 Migration 필요 |

## 3. Product 변경으로 반드시 회수할 항목

- Actor / Decision Right 추가·변경
- 공식 State / Command / Gate 추가·변경
- 제출·수령·승인·판정의 의미 변경
- Completion Criteria 변경
- Owner Reporting Trigger 변경
- 법령·계약 해석으로 Workflow 의미가 달라지는 경우
- Evidence / exact version 추적방식 변경
- 정상 업무인데 기존 Contract로 종결할 수 없는 경우

다음은 원칙적으로 Product 변경이 아니다.

- UI 배치/스타일
- 내부 코드구조
- Queue/DB/Object Storage 제품 선택
- Retry 구현방식 자체
- 배포도구/CI 구조

단, 위 기술변경이 사용자에게 보이는 업무상태나 공식판정 의미를 바꾸면 Product 변경으로 전환한다.

## 4. 변경기록 필수 필드

기계검증 계약은 `app/schema/product_change_record_contract_v1.json`을 따른다.

`app/reference/product_change_record_example_v1.json`은 형식 검증용 예시이며, 파일이 존재하거나 `decision=approved`라고 적혀 있다는 사실만으로 현재 Product Baseline의 효력 버전이 변경되지는 않는다. 실제 기준선 변경은 승인된 변경기록이 해당 릴리스에 포함되고 적용버전이 공식 선언될 때 효력이 생긴다.

최소:
- changeId
- baselineFrom / baselineTo
- changeClass
- reason
- requestedBy / decidedBy
- impactedContracts
- impactedRegisters / forms / API surfaces
- compatibility
- migrationRequired
- effectiveFrom
- acceptanceScenarioIds
- decision

## 5. Decision Right

- Product / Functional Owner가 변경등급과 계약의미를 확정한다.
- Backend/UI/Platform은 구현 중 발견한 문제와 대안을 제안할 수 있으나 업무 Contract를 직접 변경하지 않는다.
- 법령·계약 해석은 필요 시 외부 검토를 거친 뒤 Product에서 적용범위를 확정한다.

## 6. 적용 순서

변경요청 → 영향분석 → Product 결정 → Contract/Schema 수정 → Acceptance Scenario 갱신 → Backend/UI 영향반영 → 회귀시험 → 적용버전 확정.

C2 이상은 이전 버전의 정상업무가 깨지지 않는지 회귀시험을 포함한다.

## 7. 종결조건

변경은 다음이 모두 있을 때 종결한다.

- 결정된 Contract 버전
- 영향목록
- 필요한 Migration 여부
- Acceptance Scenario 결과
- 변경 후 생성물/계약 검증
- 적용 시작시점


## 8. 승인 변경 및 릴리스 효력

PCR-2026-002는 Product/Functional Owner가 C2, v1.0→v1.1 변경으로 승인했다. 승인 응답은 “제안대로 v1.1에 채택”이며 intended effectiveFrom은 `2026-10-10T00:00:00+07:00`이다. 승인 기록은 `app/reference/product_change_record_pcr_2026_002.json`에 있으며 변경은 검증된 릴리스에 포함된 때에만 효력이 생긴다. 구현이나 승인기록 단독으로 현재 release의 baseline을 승격하지 않는다.
