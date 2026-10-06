# 50. Project Configuration Pack v1.0

기준일: 2026-10-06
목적: 프로젝트별 조직·권한·기한·보고·양식·미디어 정책을 코드 변경 없이 버전으로 확정한다.
기계검증 계약: `app/schema/project_configuration_contract_v1.json`

## 1. 원칙

Project Configuration Pack은 Product Workflow를 새로 정의하지 않는다. Baseline이 허용한 범위 안에서 프로젝트별 값을 채운다.

설정변경은 과거 기록에 소급적용하지 않고 exact config version을 남긴다.

## 2. 필수 설정영역

- 프로젝트 기본정보: projectId, timezone, effectiveFrom
- 조직/Party Binding
- 역할배치: SUP/CON/OWN/DES/ADM
- Qualification Rule 및 유효기간
- 공종/Package/Location 기준
- 승인·판정·결정 권한코드별 담당 Role
- 계약/법정/내부 기한 규칙
- 발주처 즉시·정기보고 주기와 수신자
- 적용 DOUL 양식과 법정 원본서식 목록
- 안전·공정·기성 등 Threshold
- 미디어 운영정책
- Pilot Acceptance Profile

## 3. 설정으로 바꿀 수 없는 것

- Contractor가 공식 Issue를 close하도록 허용
- ADM에게 기술승인 부여
- AI/SYSTEM/INTEGRATION에 공식 인간권한 부여
- Issue close와 Owner Report close 통합
- Permit authorize와 workAuthorized 통합
- Forecast와 Baseline 통합
- Payment recommendation과 Owner approval/paid 통합

이런 요구는 Config가 아니라 Product Change Request다.

## 4. 버전과 적용

- `schemaVersion`: 설정계약 구조 버전
- `configVersion`: 동일 프로젝트 설정의 증가 버전
- `baselineVersion`: 적용 Product Baseline
- `effectiveFrom`: 새 명령/계산에 적용되는 시점

공식 기록은 자신에게 적용된 configVersion을 Audit에 남겨 재현 가능해야 한다.

## 5. Approval Authority 설정

권한설정은 `authorityCode`와 RoleAssignment를 연결한다. 개별 사용자 이름만 고정하지 않고 Role + Project Scope + Qualification을 우선한다.

예:
- `inspection.judge`
- `issue.close`
- `safety.stop_lift`
- `payment.recommend`
- `owner.decision`

Config는 Authority Matrix보다 권한을 넓힐 수 없다. 런타임의 유효권한은 `Authority Matrix ∩ Project Configuration ∩ 현재 RoleAssignment/Qualification/Scope`의 교집합으로만 계산한다. Config에 값이 있어도 상위 Authority Matrix가 허용하지 않으면 명령은 거부한다. `implementationStatus=active`인 Binding만 런타임 권한후보가 될 수 있고 현재 Authority Matrix의 policy/Actor/Role 범위 안이어야 한다. 아직 Backend가 구현하지 않은 Product 권한은 `planned`로 준비할 수 있으나 UI/API에서 실행 가능 기능으로 노출하지 않는다.

## 6. 기한·보고 설정

Deadline은 source와 계산방식을 기록한다.
- legal
- contract
- owner_requirement
- internal

더 엄격한 법정/계약 기준이 있으면 내부 기본값보다 우선한다.

P1/P2/P3/P4 보고선, 수신자, receipt/decision/action due 규칙을 별도 설정한다.

## 7. 양식 설정

- `applicableFormIds`: DOUL 내부양식
- `statutoryOriginals`: 법정 원본 문서/서식의 출처·버전·적용조건

DOUL 양식이 법정 원본을 대체하지 않는다.

## 8. 미디어 설정

Provider 선택과 무관하게 다음을 프로젝트에서 확정한다.
- 자동 retry 한도
- 사용자 재분석 허용여부
- 1회/월 비용한도
- 외부모델 반출정책
- 보존기간
- 공유용 비식별화
- 원본 Export 권한

상세 의미는 `52_Media_Analysis_Operations_Policy_v1.md`를 따른다.

## 9. 완료 기준

프로젝트 착수 전 최소:
- 설정 JSON 검증 PASS
- Role/Authority 충돌 없음
- 필수 기한/보고선 설정
- 적용양식/법정원본 식별
- 미디어정책 결정 또는 기능 비활성화
- Pilot Acceptance Scenario 선택
