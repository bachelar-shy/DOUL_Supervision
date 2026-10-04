# 23. MVP 코드 골격과 Stitch 화면 세트

기준일: 2026-10-05
기준 커밋: `d13e744f23ac183ca5246f1ed431f40fe74ef0c1` (PR #2 병합)
상태: **로컬 개발용 실행 골격 / 실제 현장 운영판 아님**

## 1. 이번 구현의 기준

PR #2의 10개 상태모델·98개 전이·51개 권한정책·29개 대장 투영·25개 양식 계약을 재사용한다. 상태엔진을 프론트엔드나 다른 워크플로 엔진으로 다시 만들지 않는다. 원본 `app/reference/`, 생성기와 도메인·권한·상태 스키마는 보존한다.

- 웹: React + TypeScript + Vite, 모바일/태블릿/데스크톱 반응형.
- 네이티브: Expo + React Native + TypeScript 공통 Android/iOS 골격.
- API: FastAPI가 기존 Python 계약 검증기를 호출한다.
- 개발 저장소: SQLite JSON 스냅샷. 상태·이력·멱등성·감사기록·원본 바이트를 트랜잭션으로 보존한다.
- 실운영 데이터베이스: 정규화된 PostgreSQL/PostGIS 어댑터는 미구현이다.

## 2. 코드 구조

```text
apps/web/                  반응형 작업공간
apps/mobile/               Android/iOS 앱과 기기 원본 저장
packages/client/           공유 API 클라이언트·명령 봉투
services/api/              HTTP·개발 인증·SQLite·업로드 어댑터
app/reference/             PR #2에서 검증한 업무 엔진 (보존)
app/schema/                권한·상태·도메인 기준 (보존)
design/stitch/             화면 계획, 실제 ID, 역할·명령 연결
scripts/stitch_screen_set.py     최초 화면 생성
scripts/reconcile_stitch.py      원격 결과 재조회·누락 확인
scripts/stitch_mobile_corrections.py  모바일 형식 보완 이력
tests_mvp/                 HTTP·동시성·업로드·문서 시험
tests_browser/             실제 브라우저 반응형·업무 시험
```

## 3. 실행

Mac mini 체크아웃: `/Users/automation/work/DOUL_Supervision`

```bash
python3 -m venv .venv
.venv/bin/pip install -r services/api/requirements.lock
npm ci
```

터미널 1:

```bash
.venv/bin/python -m services.api --demo
```

터미널 2:

```bash
npm run web
```

API는 `127.0.0.1:8791`, 웹은 `127.0.0.1:5181`이다. 기존 Mac mini의 8787/5173 서비스를 변경하지 않는다. `--demo`가 없으면 기동을 거부하고, API는 loopback에만 바인딩한다.

네이티브 개발:

```bash
npm run mobile
```

iOS 시뮬레이터는 Mac loopback 주소를 사용한다. Android 에뮬레이터/USB 개발기기는 개발자가 `adb reverse tcp:8791 tcp:8791` 연결을 준비한 뒤 사용한다. 실제 네트워크 현장 배포를 위해 인증을 끄거나 바인딩을 공개하지 않는다. 네이티브 코드의 개발용 업무 입력은 아직 일부 JSON 편집 방식이다.

## 4. 실제 연결한 기능

| 영역 | 구현 내용 | 아직 없는 것 |
|---|---|---|
| 사용자 | 5개 인간 역할, 세션별 Party/RoleAssignment 재확인 | SSO, MFA, 실제 초대·퇴사·계정 수명주기 |
| 업무 | 현재 상태의 명령 목록, 서버 권한·범위·버전·증빙 검증 | 전체 공종의 현장 설정 및 업무용 입력 UX 완성 |
| 영속화 | SQLite 재시작 복구, 감사·버전·멱등성 일괄 커밋 | PostgreSQL 정규화·마이그레이션·다중 서버 운영 |
| 사진·영상 | 파일 선택, 기기 저장, 분할 업로드, offset 재개, 서버 해시 검증 | 대용량 객체저장소, 악성파일 검사, 영상 디코딩·전사 |
| 네이티브 촬영 | OS 카메라/사진 선택, 앱 수신 파일 복사, SHA256, SQLite 제출대기 | 실기기 권한·백그라운드 전송·발열·배터리 검증 |
| 오프라인 | 웹 IndexedDB와 앱 파일/SQLite에 원본 보존, 수동 전송 재개 | 앱 재시작 시 전체 업무 화면 오프라인 조회, 자동 병합 |
| 도면·위치 | 도면 예시와 수동 위치 맥락 | 실제 PDF 뷰어, 좌표정합, GPS/QR/AR/Depth |
| 문서 | 양식 기반 초안, 원본 버전 연결, HTML 스냅샷 | 상용 문서 편집기, DOCX/PDF 렌더러, 법정 원본 탑재 |
| 서명·AI | 미연결 기능을 501/비활성으로 명시 | 실제 전자서명, 인증서 검증, AI 분석서비스 |

**OS 선택기가 제공한 파일 바이트를 앱에서 변경 없이 보관한다. 사진 라이브러리 내부 원본과 OS 반환 파일이 항상 동일하다는 포렌식 보증은 하지 않는다.**

## 5. 통제 원칙

1. 데모 역할 선택기는 운영 로그인 기능이 아니다. 실제 프로젝트 자료를 넣지 않는다.
2. 클라이언트가 역할·승인권·서명검증 결과를 임의 제출해서 권한을 얻을 수 없다.
3. 시공사는 공식 Issue를 종결하지 못한다. 관리자도 기술 감리권한을 자동 상속하지 않는다.
4. 적합 판정 뒤에도 필수서명·현재 버전의 Hold 승인이 없으면 다음 공정이 허용되지 않는다.
5. 요청의 `expectedVersion`과 `Idempotency-Key`를 유지한다. 충돌을 강제 덮어쓰지 않는다.
6. 원본 파일, 보고서 발행 시점 데이터, 과거 실패·재검측 이력을 보존한다.
7. 발주처 보고는 종결 뒤에만 처리하지 않는다. 즉시보고·수령·결정·조치를 별도 업무로 둔다.
8. 시험기관/외부검토기관은 문서 출처 Party로만 유지한다. 앱 로그인 대상에서 제외한다.
9. AI/SYSTEM/INTEGRATION은 인간 승인권자나 개발 역할 선택지로 노출하지 않는다.
10. 법정 서명 어댑터가 없으므로 임의 `receipt.verified=true` 등을 받아 서명 완료로 만들지 않는다.

## 6. API 범위

원본 OpenAPI는 업무 계약의 기준이다. 이번 HTTP 어댑터가 124개 계약 경로 전체의 운영 서비스를 구현했다고 보지 않는다.

추가 개발용 읽기 API:
- `GET /health`
- `GET /dev/actors`
- `POST /dev/sessions`
- `GET /projects/{id}/workspace`
- `GET /projects/{id}/roles`
- `GET /projects/{id}/{collection}/{id}/available-actions`

계약의 생성·명령·증빙 업로드·문서 조회/HTML 출력 경로는 연결했다. 분석·전자서명·DOCX/PDF는 명시적으로 미연결 응답을 준다. UI가 명령을 숨기는 것과 별개로 서버가 다시 검증한다.

## 7. Stitch와 코드의 관계

- 프로젝트: `DOUL Supervision MVP` / `11486949689509673114`
- 디자인 시스템: `assets/4105194232699724772`
- 기존 2개 화면은 삭제·수정하지 않는다.
- 새 화면 16종은 `design/stitch/screen-plan.json`에 정의한다.
- 실제 생성·조회 결과와 채택한 화면 ID는 `design/stitch/screens.json`을 따른다.
- 명령·상태 대응표는 코드 경로와 함께 기록하며, 화면 이미지가 승인권한의 기준이 되지 않는다.
- 수정 과정의 참고 화면은 남을 수 있다. 실제 채택 ID와 캔버스 전체 화면 수는 다를 수 있다.
- 생성 성공, 개별 조회 성공, 캔버스 등록, 화면 폭 적합성, 사용자 디자인 승인은 별도 상태다.
- 화면은 디자인 초안이다. Stitch 결과물을 픽셀 단위로 그대로 구현했거나 전체 버튼을 Stitch 내에서 연결했다고 주장하지 않는다.

## 8. 검증 명령

```bash
python3 scripts/validate_contracts.py
python3 scripts/generate_api.py --check
python3 scripts/generate_types.py --check
python3 -m unittest discover -s tests -q
.venv/bin/python -m unittest discover -s tests_mvp -v
npm run typecheck
npm run web:build
npx playwright install chromium
npx playwright test
cd apps/mobile
npx expo export --platform ios --platform android --output-dir ../../.local/mobile-export
```

원본 79개 시험과 새 HTTP 시험, 브라우저 시험은 범위가 다르다. 번들 생성은 APK/IPA 네이티브 빌드나 실제 iPhone/Android 기기 검증이 아니다. 브라우저 시험은 390/768/1440px의 넘침과 역할·명령·문서·오프라인 업로드 동작을 확인한다.

## 9. 운영 배포 전 필수 보완

현재 패키지 감사에는 의존성 경고가 남아 있다. 상세 집계와 기초 권고는 `design/verification/security-audit.json`을 따른다. 경고 패키지 수는 독립 취약점 수가 아니며, 동일 기초 권고가 상위 패키지에 전파된 항목을 포함한다. 호환성을 무시한 `npm audit fix --force`로 SDK를 강제 다운그레이드하지 않는다.

운영 전에는 보안 패치/대체 패키지 검토, 실제 인증·권한 운영, 개인정보·미디어 보존정책, 객체저장소/백업, 전자서명 검증, 공식 서식 원본, 네이티브 실기기 시험, 접근성·현장 파일럿을 완료해야 한다.


## 10. Stitch 연결 도구의 요청 제한

MCP Inspector 2.9.0 CLI가 서버 설정의 requestTimeout을 실제 요청 옵션에 넘기지 않아, 일부 화면 생성이 60초에 중단되는 현상을 확인했다. `scripts/stitch_long_request.py`는 설치된 원본을 변경하지 않고 같은 디렉터리에 별도 클라이언트 복사본을 만들어 요청 기본값만 300초로 설정한다. API 키를 읽거나 출력하지 않으며 기존 Inspector 인증 설정을 그대로 사용한다. 다른 버전에서는 임의로 수정하지 않고 검토를 요구한다.

생성 응답만 존재하고 캔버스에 반영되지 않은 경우를 완료로 처리하지 않는다. 최종 기록에서 `readbackVerified`, `canvasVerified`, `formatVerified`를 구분한다.


## 11. 최종 화면 확인 상태

16종(모바일 6, 웹 10)의 화면 리소스를 생성하고 개별 조회했다. 기존 프로젝트 캔버스에서 크기까지 확인된 것은 13종이며, `SUP-INSPECTION-M`, `SUP-CAPTURE-M`, `CON-CORRECTION-M`의 모바일 보정 리소스는 조회 가능하지만 캔버스 교체/프레임 크기 변경은 확인되지 않았다. 기존 프레임이 1280px로 남아 있으므로 이 3종은 `canvasVerified=false`로 기록한다. 전체 화면 세트의 캔버스 반영 완료를 주장하지 않는다.

브라우저 반응형 동작 시험과 이 Stitch 캔버스 메타데이터 문제는 구분한다. 실제 구현한 웹은 390/768/1440px에서 시험했다.

추가 한계: 파일 해시는 바이트 변경 여부를 확인할 뿐 촬영자·장소·내용의 진위를 자동 증명하지 않는다. 개발 서버의 파일 형식은 코드에 명시한 PNG/JPEG/GIF/WebP/MP4/WebM/WAV/MP3/PDF 범위이며 HEIC/HEIF·QuickTime MOV 등 실기기 형식의 추가 수용/변환은 아직 필요하다.
