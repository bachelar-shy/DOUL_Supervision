# DOUL 감리앱 데이터베이스 정규화 — 1단계 사전 검증

## 현재 구조 (2026-10-11)

`services/api/postgres_store.py`는 PostgreSQL 연결을 사용하지만 `doul_snapshot_state`의 단일 JSON을 통째로 읽고 저장하는 개발용 저장소다. 개별 현장·검측·도면·문서 테이블이 아니며, 여러 프로젝트가 늘어날 때 쓰기 경합 및 전체 상태 직렬화 부담이 커진다. 현재 코드를 바로 전환하면 원본 버전/감사 이력, 인가 및 서명 처리가 변할 위험이 있다.

## 이번 PR에서 실제 구현한 것

- `snapshot_record_versions(state)`: `Engine._history`의 모든 버전을 프로젝트/객체/버전 단위로 해석하고, `_records`와 최신 버전 일치 여부·교차 현장 혼입·중복 ID·변조를 검사한다.
- `snapshot_preflight_summary(state)`: 자료 원문 없이 프로젝트별 버전 수, 전체 버전 수, 결정적 manifest SHA-256을 반환한다.
- `002_shadow_record_versions.sql`: 프로젝트 복합키·개정 이력·불변 트리거를 갖는 **후속 검토용 shadow 테이블 정의**. 배포, 생성, 백필, 운영 읽기 전환은 **하지 않는다**.
- Python 9건 사전 검증 유닛테스트.

## 전환 순서 및 종료 조건

1. **기준선 기록:** 샘플 + 과거 현장 + 대형 자료 3종에 대해 preflight 검사. 불일치 0건, projectId/role/evidenceVersion 검사 기록. 민감한 원본 자료를 CI artifact로 올리지 않는다.
2. **백업·복원 검증:** PostgreSQL PITR·문서 snapshot·개별 사진/영상 원본을 분리해 동일 해시 재조회 확인.
3. **Shadow 구축:** 승인된 migration SQL을 격리 테스트 DB에서 실행하고 버전별 읽기 전용 백필·동일 해시·idempotent 재실행을 확인한다. 운영 DB에는 적용하지 않는다.
4. **이중 기록:** 서버의 공인 command 이후 shadow로 동일 트랜잭션 기록. 데이터 이동/이중 읽기 중 오류 시 fail closed. 삭제가 아니라 기록/보상 이벤트로 정정한다.
5. **프로젝트 단위 조회:** `Project`, `Inspection`, `InformationItem(Drawing/Report)`, `Issue`, `Action`, `Evidence`, `DocumentSnapshot`, `AuditEvent`을 단계적으로 분리. 최신/과거 버전, 서명/승인 권한, 현장별 격리, 중복요청을 회귀 검증한다.
6. **전환 승인:** 기능/성능/인수 테스트 완료 후 현장별로 읽기 경로 전환. 기존 스냅샷 읽기 경로는 충분한 기간 유지한 뒤 삭제·정리 여부 별도 결정.

## 변경 금지 조건

- 현재 운영 데이터에 SQL 마이그레이션 자동 실행 금지.
- 검측 합격·시정조치 완료·문서 서명 상태를 DB 백필 과정에서 생성하거나 추론 금지.
- 사진·영상 바이트를 JSONB 문서에 중복 저장 금지: 암호화된 객체 저장소, Evidence 원본 해시/권한과 연결.
- 데이터베이스 저장소 전환 완료 또는 실제 현장 인수 합격으로 이번 PR을 표시하지 않는다.
