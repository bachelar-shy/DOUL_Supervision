# DOUL Supervision App Contract v1.0

이 디렉터리는 DOUL 감리체계를 앱으로 구현하기 위한 기계가독형 계약이다.

- `schema/register_catalog.json`: 29개 관리대장
- `forms/form_catalog.json`: A4 양식 25종
- `forms/legal_form_registry.json`: 베트남 법정 고정서식
- `forms/rendering_contract.json`: 출력·스냅샷 규칙
- `forms/doul-a4.css`: 웹 A4 미리보기/인쇄 스타일
- `types/supervision.ts`: TypeScript 핵심 타입
- `api/openapi.yaml`: 최소 API 계약

## 원칙

1. 관리대장 DB가 원본이다.
2. 문서는 원본 데이터 revision을 고정한 스냅샷이다.
3. 앱 입력값과 A4 출력 필드키를 동일하게 사용한다.
4. 서명된 문서는 덮어쓰지 않는다.
5. 베트남 공식 고정서식은 DOUL 스타일로 변경하지 않는다.
6. 법정 필수항목형 기록은 필수필드·서명을 잠금 처리한다.


## v2 구현계약

- `schema/domain_model_v2.json`: 15개 Core Domain Object
- `schema/state_machines_v1.json`: Observation / Inspection / Issue / RFI / Change / Approval 상태모델
- `schema/authority_matrix_v1.json`: SUP / ADM / CON / OWN / DES / SYS 권한
- `schema/ui_surfaces_v1.json`: Mobile / Tablet / Responsive Web 및 Stitch 연결

29개 Register는 유지하되 운영 원본의 Projection/View로 사용한다.
