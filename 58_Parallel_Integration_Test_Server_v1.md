# 병렬 기능 통합 테스트 서버 v1

통합 브랜치: `integration/parallel-test-v1`. main은 변경하지 않았다.
맥미니 작업 경로: `/Users/automation/work/doul-parallel-test`.

## 접속과 실행

맥미니 브라우저: http://127.0.0.1:5191/#/parallel-test . API: http://127.0.0.1:8801/health .
루프백에만 바인딩하며 기존 5181/8791 서버를 재사용하거나 변경하지 않는다.
다른 기기 접속용 Tailscale HTTPS 포트 10002 추가는 자동 승인 검토에서 차단되어 실행하지 않았다. 공개 인터넷 Funnel은 요청 범위에 포함하지 않는다.

API 실행: 기존 프로젝트 가상환경의 Python으로 `python -m services.api --demo --database .local/parallel-demo.sqlite3 --port 8801`.
화면 실행: `DOUL_TEST_API_TARGET=http://127.0.0.1:8801 npm run dev --workspace apps/web -- --host 127.0.0.1 --port 5191 --strictPort`.
프로세스 식별 파일과 로그는 `.local/parallel-api-process.json`, `.local/parallel-web-process.json`, `.local/parallel-api.log`, `.local/parallel-web.log`에 있다.
서버 재시작 시 이 테스트 작업 경로와 해당 PID의 명령을 확인한다. 다른 서비스는 종료하지 않는다. 맥미니 재부팅 자동시작은 구성하지 않았다.

## 확인할 기능

- 도면 버전: 기존 도면 목록과 선택한 정확한 버전의 연결 기록 조회.
- 위치 계층: 실제 위치 트리와 배정 위치의 하위 노드. Location은 업무의 공종/패키지 필드가 없어 별도 위치 읽기 어댑터가 기존 역할/읽기 권한/위치 범위를 검사한다.
- 작업함: 기존 업무 상태와 명령 후보. 임의의 완료/대기 상태를 생성하지 않는다.
- 알림: 정식 Notification DTO만 표시한다. 아직 발생/전송 파이프라인은 연결하지 않았으므로 초기 목록은 비어 있을 수 있다.
- 안전 추적성: 안전 화면에서 생성한 SafetyStopOrder의 정확한 버전 조회. 다른 안전 기록 유형은 선택하지 않는다. 초기 합성자료에 작업중지 기록이 없으면 빈 상태를 표시한다.
- 증빙 격리 테스트: 최대 20 MiB 파일을 크기/SHA-256 검증 후 로컬 임시 보관한다. 프로젝트/업로더별 분리, 잘못된 해시/용량/권한 거부. 파일은 공식 Evidence 등록이나 승인 완료로 표시하지 않는다.

기존 검측·안전·증빙 업무 화면은 그대로 사용할 수 있다. PDF 뷰어·도면 핀·마크업은 이 작업에서 구현하지 않았다. 개발 역할 선택은 실제 운영 인증이 아니다. 테스트 자료는 합성자료이며 운영 데이터베이스·원격 객체 저장소에 연결하지 않았다.

## 검증 방법

기능 단위: `python -m unittest tests.test_s1_drawing_revision_projection tests.test_s2_streaming_storage tests.test_s3_location_query tests.test_s4_work_inbox tests.test_s5_notification_inbox tests.test_s6_business_traceability -q`.
연결 시험: `python -m unittest tests_mvp.test_parallel_workspace_api tests_mvp.test_parallel_evidence_upload tests_mvp.test_safety_http -q`.
화면: UI 경계 검사, web typecheck/lint/build. 브라우저: `./node_modules/.bin/playwright test --config playwright.parallel.config.ts`.
Context7 확인: Starlette Request.stream (https://github.com/kludex/starlette/blob/main/docs/requests.md), 원본 요청을 전체 메모리에 읽지 않고 디스크로 처리. 설치 버전에서 지원이 불확실한 max_body_size 옵션 대신 직접 크기를 검사한다.

## 2026-10-07 재개 검증 결과

- 최신 API로 재시작 후 건강 상태와 브라우저 조회/파일 격리 업로드 시험 통과.
- 6개 모듈 집중시험 54개, 연결 및 안전 HTTP 시험 20개 통과. UI 경계/typecheck/build 통과, lint 경고/오류 0개.
- 전체 API 수집 시험은 174개 중 인증/DB 의존성 누락으로 7개 오류, 4개 건너뜀. 전체 통과로 간주하지 않는다. 누락 패키지: jwt, psycopg, psycopg_pool, cryptography.
- 별도 .venv에 고정 의존성 설치를 시도했으나 현재 패키지 인덱스에 anyio==4.15.1이 없어 실패했다. 고정 파일을 임의 변경하지 않았다. 서버는 기존 검증된 가상환경으로 계속 실행한다. 새 .venv는 서버 실행에 사용하지 않는다.
- Tailscale 접속 설정은 이전 자동 승인 검토 차단 이후 실행하지 않았다. 현재 맥미니 로컬에서만 접속한다.
