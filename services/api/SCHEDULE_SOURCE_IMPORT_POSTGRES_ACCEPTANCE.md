# Schedule 원본 입력 — PostgreSQL 인수검증 기록

검증일: 2026-10-07 (Asia/Bangkok)

## 1. 판정과 작업 범위

**API Implemented + Integration Tested: Schedule 원본 입력의 HTTP·영속성 경계.**
실제 PostgreSQL 16.2에서 검증했으며 SQLite 결과로 대체하지 않았다.
앱 전체의 통합 E2E 완료, UI Connected 또는 Field Validated를 의미하지 않는다.

| 항목 | 확인 내용 |
| --- | --- |
| main / origin/main | `c4f8764529a10cea51fe24553a3b155d6f5651a6` |
| Backend branch | `backend/schedule-source-import-v1` |
| Backend worktree | `/Users/automation/work/DOUL_Supervision-backend-schedule-import` |
| Product dependency | `product/schedule-source-import-v1` — 미커밋·미병합 상태 유지 |
| Product worktree | `/Users/automation/work/DOUL_Supervision-product-schedule-import` |
| 열린 PR / Issue | PR 없음. Issue #73은 변경·종결하지 않음 |
| Git 변경 권한 | commit / push / PR 생성 / merge 모두 실행하지 않음 |

이번 작업은 PostgreSQL 인수시험과 검증 기록에 한정한다. 업무 상태·명령·권한·판정·종결조건 및 Product Contract를 변경하지 않았다. 원본 입력 UI와 비주얼 에디터는 작업하지 않았다.

## 2. 실제 실행 환경과 격리

| 항목 | 확인 내용 |
| --- | --- |
| 호스트 | Mac mini, Apple Silicon arm64 |
| Python | `/tmp/doul-issue81-venv/bin/python`, Python 3.14.6 |
| 서버 | PostgreSQL 16.2, native macOS arm64 실행 파일 |
| 저장 어댑터 | 실제 `PostgresSnapshotAdapter`, `postgresql-snapshot-development` |
| DB | 신규 일회용 클러스터의 `doul_schedule_import_test` |
| 접속 | 외부 TCP 접속 없음. `listen_addresses=''`, 전용 Unix socket, 디렉터리·소켓 권한 0700 |
| 내구성 설정 | `fsync=on`, `synchronous_commit=on` |
| 테스트별 격리 | UUID 기반 전용 스키마. 종료 시 해당 스키마만 삭제 |
| 운영 DB | 접속하지 않음. 기존 운영 서비스·시스템 설정 변경 없음 |

기존 `DOUL_TEST_POSTGRES_DSN`과 PostgreSQL 실행기가 없어 임시 디렉터리에 독립 실행 파일을 준비했다. 시스템 패키지나 앱의 Python 의존성을 설치·변경하지 않았다. `pgserver 0.1.4`의 macOS arm64 wheel에서 native 실행 파일을 추출했으며 다운로드 파일의 SHA-256을 PyPI 배포 메타데이터와 대조했다.

Wheel SHA-256: `780fa89f26a960cca0215caf471e70848dd8597bd8ceaeba7faf42170278980c`

연결 정보는 임시 디렉터리의 권한 0600 파일과 테스트 프로세스 환경에서만 전달했다. 연결 문자열·비밀정보를 보고서에 저장하지 않았다.

## 3. 실행 결과

| 실행 단위 | 결과 | 생략 |
| --- | --- | --- |
| `tests_mvp.test_schedule_source_import_postgres` | 30개 통과: 실제 PostgreSQL 26개 + 연결·격리 보호장치 단위시험 4개 | 0 |
| Backend `unittest discover -s tests_mvp -v` | 전체 API 234개 통과 | 0 |
| Backend `unittest discover -s tests -v` | 코어·계약 162개 통과 | 0 |
| Product `unittest discover -s tests -v` | 코어·계약 162개 통과 | 0 |
| Product / Backend `scripts/validate_contracts.py` | 각각 통과 | 해당 없음 |
| 별도 실제 PostgreSQL 서버 재시작 시나리오 | 통과 | 해당 없음 |
| Product / Backend `git diff --check` | 각각 통과 | 해당 없음 |
| 추가 PostgreSQL 시험 파일 Python 구문 검사 | 통과 | 해당 없음 |

전체 API 234개에는 위 원본 입력 모듈 30개와 기존 PostgreSQL 영속성 시험이 포함된다. 서로 더하지 않으며, 전체 234개가 PostgreSQL 전용 시험이라는 뜻도 아니다. 별도 DB 서버 재시작 시나리오는 unittest 실행 개수에 합산하지 않았다.

### 핵심 인수 항목

| 항목 | 검증 근거 |
| --- | --- |
| 실제 원본 입력 | JSON 업로드·청크·완료 후 원본 바이트 SHA-256과 내용·Evidence 참조 검증. Schedule·Activity 참조 및 개수의 서버 생성 |
| 부분 저장 실패 | 첫 Activity와 감사 이벤트 저장 후 두 번째 Activity에서 실패 주입. 별도 DB 연결로 전체 스냅샷·파일 해시가 요청 전과 동일함을 확인 |
| 실제 SQL 실패의 전체 롤백 | 스냅샷의 실제 SQL UPDATE와 시험용 blob INSERT 후 PostgreSQL SQL 오류 발생. Schedule·Activity·Audit·History·Idempotency·blob 모두 롤백 확인 |
| 실패 후 동일 키 재시도 | 앱·연결 풀 재생성 후 실패한 요청과 같은 키로 정상 입력. 실패 요청이 중복 요청 정보를 남기지 않음 |
| 프로세스 재시작 보존 | 기존 앱·연결 풀을 닫고 새로운 Python 프로세스에서 원본·업무 상태·전체 DB 상태 확인 |
| 동일 요청 재생 | 업무 명령으로 현재 Schedule 버전이 증가한 뒤에도 원본 입력 응답을 정확히 재생. 감사·이력·객체 중복 없음 |
| 다른 요청의 동일 키 충돌 | 내용이 다른 요청은 HTTP 409 / `IDEMPOTENCY_CONFLICT`. DB 상태 불변 |
| Baseline 업무 연결 | 실제 승인 생성·검토·승인 명령과 Baseline 승인·활성화 명령 실행 |
| Progress 업무 연결 | 원본 입력 → 검증 → 동결 → 새 정정본 입력·동결. 이전 Progress는 superseded, 승인 Baseline은 불변 |
| 원본 보존 | 업무 버전 증가·정정 이후에도 Schedule 원본 v1과 Activity의 원본 참조 보존 |
| Recovery 경계 | supporting snapshot 유지. Baseline 활성화 불가 |
| 발주처 종결 경계 | 원본 입력·공정 업무가 발주처 종결 Decision을 생성하지 않음을 회귀 검증 |

### 실제 DB 서버 재시작

앱 재생성과 별도로 이 검증에서 만든 PostgreSQL 클러스터만 `pg_ctl ... -m fast -w restart`로 재시작했다. 서버 PID와 `pg_postmaster_start_time()`이 모두 변경됐음을 확인했다.

재시작 후 새로운 Python 프로세스에서 Baseline, 최초 Progress, 정정 Progress, Recovery의 원본 4건을 비교했다. 현재 업무 상태는 각각 effective / superseded / frozen / snapshot으로 유지됐다. 원본 v1·Activity 참조·업로드 파일 해시·정확한 요청 재생·다른 내용의 동일 키 충돌과 전체 스냅샷 불변을 확인했다.

정상적인 제어 재시작 검증이며, 전원 장애·강제 종료에 대한 전체 복구 시험이나 운영 백업 복원 시험을 의미하지 않는다.

## 4. 재실행 방법

운영 DB가 아닌 신규 로컬 또는 CI 전용 테스트 DB를 먼저 준비하고, `DOUL_TEST_POSTGRES_DSN`을 프로세스 환경에 설정한다. DB 이름에는 `_`로 구분된 `test` 구성요소가 있어야 한다. 원격 호스트·원격 hostaddr·pilot 환경은 실행 전 차단한다.

```sh
export DOUL_ENVIRONMENT=development
export DOUL_QUEUE_ENABLED=false
.venv/bin/python -m unittest tests_mvp.test_schedule_source_import_postgres -v
.venv/bin/python -m unittest discover -s tests_mvp -v
.venv/bin/python -m unittest discover -s tests -v
.venv/bin/python scripts/validate_contracts.py
```

DSN이 없으면 PostgreSQL 시험은 생략된다. PostgreSQL 인수검증에서는 반드시 실제 서버 실행, 종료 코드, 테스트 개수와 생략 0을 함께 확인해야 한다. 전체 API의 기존 PostgreSQL 시험은 지정된 테스트 DB 안의 snapshot 테이블을 초기화하므로 반드시 신규 전용 DB를 사용한다.

## 5. 기존 작업 보존과 변경 파일

작업 전 Product 10개, Backend 16개 미커밋 파일의 SHA-256과 diff를 별도 보존했다. 작업 후 Product 10개 전부 동일함을 확인했다. Backend의 기존 16개 중 코드·스키마·생성물 등 15개는 동일하며, 기존 안내 문서 1개만 PostgreSQL 검증 결과에 맞춰 갱신했다.

이번 작업의 저장소 변경:

- 추가: `tests_mvp/test_schedule_source_import_postgres.py`
- 추가: `services/api/SCHEDULE_SOURCE_IMPORT_POSTGRES_ACCEPTANCE.md`
- 갱신: `services/api/SCHEDULE_SOURCE_IMPORT.md`

Backend diff에 포함된 미병합 Product 의존성은 그대로 보존했다. 후속 commit / PR 작성 시 Product와 Backend 변경을 분리해야 한다.

## 6. 실행 증빙과 정리

Mac mini 증빙 디렉터리:

```text
/var/folders/sr/9gbghn4964743b_7hy274cz80000gn/T/doul-schedule-pg-acceptance-m8vdctyt
```

주요 증빙은 `postgres-source-import-tests.log`, `all-api-tests.log`, Product·Backend 코어·계약 로그, `regression-summary.json`, `db-server-restart-probe.py`, `db-server-restart-probe.log`, `db-server-restart-summary.json`, `cleanup-summary.json`, `preservation-verification.json`, `evidence-manifest.json`이다. 이 디렉터리는 임시 로컬 증빙이며 영구 CI 아카이브가 아니다.

| 증빙 | SHA-256 |
| --- | --- |
| 추가 PostgreSQL 시험 코드 | `7792107d8898debe47ddb5fa47930f1ebcb58066ddf4b1b8776a2eab183724d1` |
| `postgres-source-import-summary.json` | `e968807302498a4be4afe6152692fa5c764bee69ea7bfd2e239729bede2e836c` |
| `regression-summary.json` | `869d5a457a0cf7232dd8e71c4a8a6fb806ba952b86ad32f39931fdd8fdfd6d85` |
| `db-server-restart-summary.json` | `c28b5344563ef905dba63741bff8bea0f8f5815c806f5dc5ae5c8e948372b85d` |
| `cleanup-summary.json` | `16e1fc9004c53d8d61eee679bfa5fb9e73b1bc79a28e3b07eec25892677553ee` |

종료 전 테스트 전용 잔여 스키마 0개, 다른 클라이언트 연결 0개를 확인했다. 생성한 클러스터만 정상 종료했으며 `pg_ctl status`의 미실행 상태와 PID 파일 부재를 확인했다. 원본 작업 파일·테스트 로그·DB 데이터 디렉터리는 삭제하지 않았다.

## 7. 미검증 범위와 다음 작업

실행한 서버는 PostgreSQL 16.2다. 저장소 배포 이미지의 PostgreSQL 16.15 컨테이너 조합은 이번에 실행하지 않았으므로 해당 배포 조합의 검증으로 확장하지 않는다. 개발용 snapshot 어댑터 검증이며, 정규화된 운영 DB 스키마·운영 인증/TLS·다중 인스턴스 부하·장애 복구 전체 인수검증이 아니다.

원본 입력 UI, 브라우저 E2E, 현장 검증은 미완료다. 웹·모바일 타입 검사와 UI 빌드는 이번 변경에 포함되지 않아 재실행하지 않았다. XER / MSP / CSV 파서는 여전히 미구현이며 normalized_json만 지원한다.

남은 의존성은 미병합 Product 원본 입력 계약과 Backend 구현이다. **다음 단 하나의 작업은 Schedule 원본 입력 UI 연결이다.** commit / push / PR / merge는 별도 지시 전까지 실행하지 않는다.
