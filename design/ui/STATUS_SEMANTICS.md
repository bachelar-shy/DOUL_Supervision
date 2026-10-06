# DOUL Supervision UI Status Semantics v1

## 목적

Product Baseline v1.0의 U-P1 공통 상태표현 규칙을 UI 계층에서 일관되게 적용한다.

이 문서는 **표현 규칙**만 정의한다. Domain 상태, Authority, Gate, Command 가능 여부를 새로 만들거나 변경하지 않는다. 화면은 서버가 제공한 상태와 Action Descriptor를 그대로 소비한다.

## 절대 합치지 않는 상태

다음 상태는 이름, 배지, 카드, 요약 KPI에서 하나의 "완료" 또는 "승인"으로 합치지 않는다.

| 구분 | 반드시 분리할 상태 | UI 원칙 |
|---|---|---|
| 제출·승인 | Submitted / Received / Approved | 제출, 접수, 승인 각각 별도 텍스트 |
| 도서 유효성 | Approved / Released / Current | 승인, 현장배포, 현재 적용본을 별도 표시 |
| 검측 | Inspection Pass / Next-work Released | 적합 판정과 후속공정 허용을 별도 표시 |
| 종결 | Issue Closed / Owner Report Closed | 기술 이슈 종결과 발주처 후속조치 종결을 별도 표시 |
| 안전 | Permit Authorized / Work Authorized / Stop | 허가, 실제 작업 가능, 중지 상태를 별도 표시 |
| 공정 | Baseline / Forecast | 기준 공정과 예상 공정을 별도 표시 |
| 기성 | Claimed / Verified / Recommended / Owner Approved / Paid | 금액·상태를 단계별로 분리 |
| 인수 | Test Passed / Handover Ready / Owner Accepted | 시험합격, 인수준비, 발주처 인수를 별도 표시 |

## 공통 컴포넌트

### StatusBoundaryGroup

연관되어 있지만 서로 대체할 수 없는 상태를 하나의 묶음 안에서 **각각 독립된 항목**으로 표시한다.

- 항목마다 명칭과 값을 텍스트로 표시한다.
- 색상은 보조 수단이며, 색상만으로 의미를 전달하지 않는다.
- 아직 서버 데이터가 없는 상태를 UI가 추론하지 않는다.
- `unknown`, `null`, 미연결 상태는 "정보 없음/확인 필요" 또는 "현재 명령 없음"으로 표시한다.

### ActionGate

서버 `CommandDescriptor`를 다음 **표현 상태**로만 변환한다. 이는 Domain 상태가 아니다.

| 표시 | 의미 |
|---|---|
| 실행 가능 | 서버가 현재 `ready=true`로 허용 |
| 입력 필요 | 입력 화면을 열 수 있으나 제출 시 서버 재검증 필요 |
| 선행조건 대기 | 서버 Gate가 현재 실행을 허용하지 않음 |
| 권한 없음 | 서버가 `NOT_AUTHORIZED`를 반환 |
| 오프라인 | 서버 검증이 불가능해 실행 차단 |

버튼 비활성화만으로 이유를 전달하지 않고, 상태 라벨과 사유 문장을 함께 표시한다.

## 현재 적용

- Inspection: 검측 판정 / 후속공정 허용 / Hold Point 분리
- Owner Governance: 현재 객체 상태 / 수령 확인 / 결정 제출 분리
- Workbench / Owner Governance ActionGate: 실행 가능, 입력 필요, 선행조건 대기, 권한 없음, 오프라인 명시

## 향후 적용

Backend/API가 준비되는 단위마다 같은 규칙을 재사용한다.

- Safety / Stop / Resume
- Schedule / Delay / Recovery
- Measurement / Payment
- Compliance / Regulatory Permit
- Commissioning / Handover / Warranty
- Claim / EOT

미연결 업무를 실제 처리 가능한 것처럼 표시하지 않는다.
