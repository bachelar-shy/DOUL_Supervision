# 양식·출력 검증 범위

기준일: 2026-10-04

25개 DOUL A4 양식의 카탈로그·필드·필수값·반복표·조건부 서명 계약은 `app/forms/`에 있다. 이 저장소에서 재현되는 검증은 `tests/test_media_documents.py`의 채워진 25개 DTO와 HTML 구조·출력 해시 검사다.

장문, 100행 표, 한국어·베트남어 텍스트, HTML 이스케이프, 법정 필수값 누락, 조건부 하도급 서명, 만료된 서명자도 검사한다. 이는 페이지 렌더링 이미지의 표 잘림·겹침·글리프 검증을 대신하지 않는다. 운영 DOCX/PDF 어댑터와 실제 폰트·페이지별 시각 QA는 추가로 필요하다.

기존 문서가 언급한 `DOUL_Supervision_A4_Form_Pack_v1.0.zip`, `DOUL_Supervision_App_Contract_v1.0.zip`, `DOUL_Supervision_Implementation_Pack_v1.0.zip` 및 25개 DOCX/PDF의 생성기·렌더링 QA 증거는 현재 리포에 포함되어 있지 않다. 따라서 해당 배포팩을 이 리포에서 재생성·검증 완료했다고 표시하지 않는다.

공식 고정서식은 `legal_form_registry.json`의 실제 설치 상태로 판단한다. 원본·체크섬·적용기간을 확인하기 전에는 생성하지 않는다. Nghị định 207 부록 VIII의 관할기관 결과통보는 수신 전용이다. 부록 IIb 준공도면 확인도장도 별도 등록했다. 법령 적용 여부는 프로젝트 Requirement 기준선에서 검토해야 한다.

```bash
python -m unittest tests.test_media_documents -v
```
