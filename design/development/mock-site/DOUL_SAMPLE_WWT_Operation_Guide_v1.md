# DOUL SAMPLE — WWT 공장 가상 운영 검증 프로젝트 v1

기준: 2026-10-11 / 시험 전용 / **실제 현장 확인·감리 승인·법정서명 자료가 아님**

## 운영 원칙

- **한 프로젝트를 지속 사용:** `DOUL SAMPLE · WWT 공장 (합성 시험자료)`를 프로젝트 목록에 일반 프로젝트와 함께 표시한다.
- 원래의 `DOUL 시범현장 · 예시 데이터`와 ProjectID/권한/데이터베이스 참조를 구별한다. **기존 프로젝트는 삭제하거나 초기화하지 않는다.**
- 샘플에서도 평상시 UI·API·워크플로/DB 스키마·권한 검사를 그대로 사용한다.
- 개발용 관리자(ADM)만 사례 결과를 보거나 재실행할 수 있다. 시공사(CON)/감리(SUP)/발주처(OWN)는 실제 계약에 따른 승인 권한을 획득하지 않는다.
- 사례 실행은 데이터베이스 백업을 임시 복제해 수행한다. 검증 결과만 원본 샘플 DB에 남긴다. 사례 실행은 실사용 데이터의 변경을 의미하지 않는다.
- `--demo` 모드에서만 사례 엔드포인트가 생성된다. 실사용 보안, 본인 확인, 서명, 자료 진본성 검증은 시범운영 인수 `53_Field_Pilot_Acceptance_Plan_v1.md`의 별도 절차를 따른다.

## 데이터세트 (실제 개발용 API에 적재됨)

| 종류 | 수량 | 실제 시험 데이터 구성 / 한계 |
|---|---:|---|
| 인적 조직과 역할 | 12개 사람·역할 | SUP 4, CON 4, OWN 2, DES 1, ADM 1. 추가 SYSTEM·AI 시험 역할은 별도 |
| 위치 | 15 | 동/층/그리드, WWT 탱크, 배관, 펌프실, 전기실 등 |
| 공종 | 4 | 건축/구조/기계/전기. 초기 8공종 목표에서 축소했으며 향후 확장 가능 |
| PDF 도면 | 24 | 건축 A, 구조 S, 기계 M, 전기 E 각 5개 시트 및 4개의 구버전 Rev.A |
| 현장사진 형태 PNG | 60 | **한 장의 기존 합성 contact sheet(P01~P12)에서 5개씩 파생한 이미지**. 60장의 독립 촬영사진이라고 주장하지 않는다 |
| 감리보고 PDF | 10 | 가상 날짜·주제·측정 관련 요약 / **미서명, 미발행, 영어 텍스트 예시** |
| 검측 | 40 | 실제 서버 요청·접수·일정/측정·합격·불합격 상태, 요구사항/도면/사진 연결 |
| 현장 확인(Observation) | 15 | 합성 사진 근거와 감리자의 확인 상태 |
| 지적사항 | 15 | 검측·확인·시정 담당 연결 |
| 시정조치 | 16 | 일반 15 + 기한초과 1 |
| 감리보고(업무) | 10 | 발주처 수신자, 지적사항 참조 및 PDF 증빙 첨부 |

현재 도면은 **형식·도면번호·개정·PDF 도면조회 검증용으로 제작한 벡터 테스트 도면**이다. 실제 설계 검토용 CAD/BIM/설계계산 및 한국어/베트남어 표준 도면 수준이 아니다. 가상 계측값은 품질 합격의 증명이 아니다. 가상 도면의 `approved/superseded`는 시험 DB 기준상태로 설정되었으며 실제 승인을 생성하거나 법적 효력을 만들지 않는다.

2026-09-07부터 30일에 해당하는 업무일·검측일을 정의한 가상 CSV를 생성하지만 시스템 AuditEvent의 `createdAt`는 **실제 등록 시각**을 사용한다. 과거 일자로 감사이력을 조작하지 않는다.

## 설치 / 테스트 서버 실행

저장소 최상위에서 실행한다.

```sh
python3 -m scripts.sample_project_materials --output .local/sample-materials
python3 -m scripts.sample_project_load --database .local/DOUL_SAMPLE_WWT.sqlite3 --materials .local/sample-materials
python3 -m scripts.sample_usecases --database .local/DOUL_SAMPLE_WWT.sqlite3 --case all --output .local/sample-usecase-results.json
python3 -m services.api --demo --database .local/DOUL_SAMPLE_WWT.sqlite3 --port 8794
```

별도 터미널에서 웹 서버를 시작한다.

```sh
npm ci
DOUL_TEST_API_TARGET=http://127.0.0.1:8794 npm run dev --workspace apps/web -- --host 127.0.0.1 --port 5187
```

브라우저에서 `http://127.0.0.1:5187/`을 열고 **프로젝트 선택 → DOUL SAMPLE → 시험 사용자 역할 ‘관리자’ → 배치·권한 → 상황별 유즈케이스 검증** 순서로 접근한다. 다른 역할에서는 이 관리자 전용 시험 화면이 보이지 않는다.

추가 재현:

```sh
python3 -m unittest tests_mvp.test_sample_project_full_workflow -v
DOUL_SAMPLE_BASE_URL=http://127.0.0.1:5187 npm run test:sample-browser
```

**주의:** `.local/DOUL_SAMPLE_WWT.sqlite3` 파일은 샘플용으로만 유지한다. Loader는 데이터베이스 파일 이름이 `sample` 또는 `DOUL_SAMPLE`로 시작하는 경우에만 허용한다. 동일 파일 경로로 재실행할 때 파일·레코드 수는 증가하지 않는다. 다른 개발·운영 DB를 경로에 사용하지 않는다.

## 15개 가상 사례

| ID | 상황 | 기대 검증 및 처리 |
|---|---|---|
| UC-01 | 사용자와 프로젝트 선택 | 두 개 프로젝트 조회·권한 분리 **부분: 실제 비밀번호 계정 미검증** |
| UC-02 | 현장사진 작성·조회 | 원본 SHA256·파생 이미지 출처 보존 |
| UC-03 | 시공사 검측요청 | 도면·요구사항·증빙 연계 |
| UC-04 | 감리자 적합 판정 | 측정기록과 적합 판정 일치 |
| UC-05 | 부적합 배근·배관 | Observation → Issue → Action/Inspection 연결 |
| UC-06 | 시정 담당과 제출 대기 | 조치 중인 이슈가 임의로 종결되지 않음 |
| UC-07 | 시정 완료 후 재검측 | 실제 API 시정 제출·감리 확인까지 **부분: 정식 재검측·서명·최종 종결 미완료** |
| UC-08 | 시정기한 초과 | 기한이 지난 미종결 건을 정확히 확인 |
| UC-09 | 이전 도면을 검측 기준으로 등록 | Rev.A가 superseded일 때 서버 409 `DRAWING_STALE` |
| UC-10 | 감리보고 작성 | 보고서·원본 PDF·지적사항 연결 및 수령자 확인 |
| UC-11 | 발주처 수령 | 보고 수령과 Issue 종결의 독립 검증 |
| UC-12 | 사진 재전송 및 통신 중단 | 원본·중복 캡처 조회 **부분: 실제 오프라인 브라우저 복귀·재전송 미검증** |
| UC-13 | 다른 감리자 동시 갱신 | 낡은 ExpectedVersion 요청을 서버에서 차단 |
| UC-14 | 다른 현장 접근 | 교차 ProjectId와 무인증 접근 차단 |
| UC-15 | 시스템 재시작 후 재조회 | Evidence 원본 바이트 및 업무 목록 보존 |

검증 표시: `PASS`=현재 자동시험의 기대조건 충족, `PARTIAL`=일부 API 단계 확인, `FAIL`=조건 불충족. **모든 상태는 개발 통합검증 결과이며 `pilot_verified`가 아니다.**

## 출처, 연결 및 산출물

1. 합성 원본: `design/development/mock-site/assets/SYNTHETIC_WWT_contact_sheet_P01-P12.png`
2. 생성 코드: `scripts/sample_project_materials.py` (사진 파생·PDF·CSV·manifest/SHA256)
3. 샘플 등록: `scripts/sample_project_registry.py` (기존 프로젝트 분리, 공종·장소·배치)
4. 자료 적재: `scripts/sample_project_load.py` (실제 파일 업로드 API/도면 등록/작업 API/재조회)
5. 기대조건·사례 실행: `scripts/sample_usecases.py`; 각 사례는 별도 DB 백업에서 실행
6. 결과: `.local/sample-usecase-results.json` 또는 샘플 관리자 화면
7. API 재현 검증: `tests_mvp/test_sample_project_full_workflow.py`
8. 브라우저 검증: `tests_browser_sample/sample-project.spec.ts`

### 제한 및 다음 통합조건

- PR #148의 관리자 발급 로그인, PR #152의 5개 핵심업무 UI, PR #141 WWT 운영 데모와 충돌 없이 통합한 후 재검증한다.
- 실제 공사 인수는 53번 Pilot Acceptance Plan의 필수 안전·공정·기성·준공 시나리오까지 포함한다.
- 향후 사진은 각 현장사건에 대한 **서로 다른 원본/시점/위치**가 있는 독립 합성 이미지로 확장하고, PDF 도면도 근거가 일치하는 상세 수준으로 개선해야 한다.
- 자격증·서명·사업자번호·시험성적서는 실제 식별자처럼 보이지 않도록 합성 자료로 표기한다.


## 자동 CI

`.github/workflows/sample-project.yml`은 GitHub 제공 Ubuntu 실행기에서 아래를 검증한다.

- Python 검증: 데이터 생성·실제 API 적재·중복실행·15개 사례·프로젝트간 권한·기록 보존
- 웹 검증: UI 경계·lint·타입 검증 포함 빌드
- Chromium 브라우저: 15개 사례 탐색/실행·관리자 메뉴 스크롤·390/768/1440px 가로 넘침

모든 결과가 통과해도 세 가지 PARTIAL 사례는 자동 인수로 바뀌지 않는다.
