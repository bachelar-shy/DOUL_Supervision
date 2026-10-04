# Generated A4 Forms and Distribution Packs

기준일: 2026-10-04

## DOUL A4 감리양식 25종

생성·렌더링 QA 완료:

- FM-01 시공사 제출자료 표지
- FM-02 시공계획 검토서
- FM-03 시공상세도 검토서
- FM-04 자재승인 요청·검토서
- FM-05 자재반입 검사서
- FM-06 시험·검사 요청서
- FM-07 검수요청서
- FM-08 시공사 자체검측표
- FM-09 시공작업 검수기록
- FM-10 단계·부분 검수기록
- FM-11 완료검수기록
- FM-12 부적합 보고서
- FM-13 시정조치서
- FM-14 현장지시서
- FM-15 기술질의서
- FM-16 설계변경 검토서
- FM-17 고위험작업 안전확인서
- FM-18 일일 감리기록
- FM-19 주간 감리보고
- FM-20 발주처 즉시보고
- FM-21 발주처 의사결정 요청서
- FM-22 미결사항 목록
- FM-23 준공서류 완성도표
- FM-24 인수인계 확인서
- FM-25 미완료·하자 추적표

## GitHub 원본 정의

양식은 생성 바이너리보다 아래 원본 정의를 기준으로 관리한다.

- `app/forms/form_catalog.json`
- `app/forms/form_templates_v1.json`
- `app/forms/doul-a4.css`
- `app/forms/rendering_contract.json`
- `app/forms/legal_form_registry.json`
- `app/schema/register_catalog.json`
- `app/api/openapi.yaml`
- `app/types/supervision.ts`

## QA

- @DOUL 표준 A4 적용
- A4 210 × 297 mm
- 여백 17 mm
- 기본 빈 양식 25종 모두 1페이지 기준
- 렌더링 시 표 잘림·겹침·글리프 오류 확인
- 법정 고정서식은 DOUL A4로 재디자인하지 않고 별도 LegalFormTemplate으로 관리

## 배포팩

현재 생성된 배포물:
- `DOUL_Supervision_A4_Form_Pack_v1.0.zip`
- `DOUL_Supervision_App_Contract_v1.0.zip`
- `DOUL_Supervision_Implementation_Pack_v1.0.zip`

배포팩은 위 GitHub 원본 정의에서 재생성 가능한 산출물이며, 앱 구현 시 원본 계약파일을 기준으로 한다.
