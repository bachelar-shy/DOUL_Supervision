# DOUL 감리 앱 구현계약 v2.1

업무의 원본은 Core Domain Object다. 29개 관리대장은 조회용 Projection이며 상태를 직접 수정할 수 없다. 업무규칙의 우선순위는 **Domain → State → Authority → Requirement/Gate → API → UI/Stitch**다.

이 저장소에는 정의서, 기계가독형 계약, Python 표준 라이브러리로 실행하는 참조 엔진이 있다. 모바일·웹 앱이나 운영 서버가 배포된 상태는 아니다.

## 계약과 실행 코드

| 경로 | 역할 |
|---|---|
| `schema/domain_model_v2.json`, `domain_schemas_v2.json` | 15개 핵심 객체, 보조 객체, 입력 데이터 스키마 |
| `schema/state_machines_v1.json` | 10개 모델의 98개 명령·상태전이·검증조건·실패사유 |
| `schema/authority_matrix_v1.json` | 51개 권한정책과 프로젝트·분야·패키지·위치·자격·배치 범위 |
| `schema/register_projection_map_v2.json` | 29개 대장별 원본·하위유형·정확한 연결·계산·허용명령 |
| `schema/media_analysis_contract_v1.json` | 사진·영상·발화의 출처, 시간코드, 처리범위, 사람 확인 |
| `schema/owner_reporting_contract_v1.json` | 보고·수령·결정·조치·검증·종결과 기한관리 |
| `forms/form_data_schemas_v1.json`, `form_domain_bindings_v2.json` | 25개 양식의 필드형식·필수값·반복표·서명·출처 DTO |
| `forms/legal_form_registry.json` | 공식서식 설치·확인 상태와 수신 전용 서식 |
| `api/openapi.yaml`, `types/supervision.ts` | 위 계약에서 생성한 API 및 TypeScript 선언 |
| `reference/` | 상태명령, 권한, 증빙, 조회, 분석결과 검증, 불변 HTML 문서의 참조 구현 |

일부 `_v1` 파일명은 기존 링크 호환성을 위해 유지한다. 내부 `version`이 계약 버전이다. API의 YAML 파일은 JSON 문법을 사용하며 YAML로도 유효하다.

## 실행과 검증

저장소 루트에서 Python 3.12로 실행한다. 별도 패키지 설치는 필요 없다.

```bash
python scripts/validate_contracts.py
python scripts/generate_api.py --check
python scripts/generate_types.py --check
python -m unittest discover -s tests -v
```

스키마·상태 계약을 수정했다면 `generate_api.py`, `generate_types.py`를 `--check` 없이 실행하고 검증한다. 정의 JSON은 편집 원본이고 API·타입은 생성물이다. JSON Schema 조건부 규칙은 런타임에서 검사한다. 참조 검증기는 사용하는 키워드만 지원하며 계약 검사에서 미지원 키워드를 거부한다.

참조 엔진의 `bootstrap`, `_save`, `get`, `resolve`는 신뢰된 저장소·마이그레이션 어댑터용이다. HTTP에 그대로 노출하지 않는다. 인증된 Party ID는 인증 어댑터에서 공급하고 RoleAssignment는 서버 저장소에서 조회한다. 요청으로 권한객체를 만들거나 전달할 수 없다.

## 구현 범위

- AI 없이 합격 → 서명된 작업검수 → 후속공정 허용, 불합격 → 시정 → 반복 재검측 → 종결을 실행한다.
- RFI 답변, 변경 승인, 정확한 대상 버전에 대한 승인, 발주처 보고·수령·조치 종결을 별도로 검사한다.
- 분석 작업자가 반환한 프레임·발화·관찰후보를 검증한다. 실제 미디어 디코더와 AI 모델 호출은 구현하지 않았다.
- HTML 문서는 원본 버전, 데이터, 양식 버전·해시, 실제 출력 바이트 해시를 보존한다. 서명 검증의 참조 입력은 신뢰된 어댑터 영수증이다.
- 조회 대장의 누락 계산값은 `null`과 `unavailableFields`로 표시한다. 빠진 자료를 합격·승인으로 추정하지 않는다.

운영 DB 트랜잭션·동시성 제어, 인증, 저장소·재개 업로드·격리 검사, 미디어 작업자, 알림 발송, 법적 전자서명 검증, 전체 양식의 업무별 DTO 작성 화면, DOCX/PDF 생성 및 페이지 시각 검증은 운영 어댑터 작업이다. 현재 공식 고정서식은 원본·체크섬·적용기간이 설치·확인되지 않아 생성이 차단된다. HTML 구조 검증을 DOCX/PDF 시각 QA나 법정 효력 검증 완료로 표시하지 않는다.
