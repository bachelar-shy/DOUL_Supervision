# PostgreSQL Backup / Clean-Restore Slice

이 디렉터리의 첫 번째 범위는 #46 중 **PostgreSQL clean restore 검증**만 담당한다.

Object Storage backup/version recovery, Secret recovery, 전체 RPO/RTO는 후속 작은 작업으로 분리한다.

## 원칙

- `pg_dump -Fc` custom archive를 사용한다.
- ownership/privilege를 dump에 고정하지 않는다.
- dump와 SHA-256 sidecar를 함께 만든다.
- restore 전에 sidecar가 있으면 hash를 검증한다.
- clean restore는 별도 target database에만 허용한다.
- 현재 Compose의 primary `POSTGRES_DB`에는 기본적으로 restore를 거부한다.
- password나 전체 DSN을 명령행/출력에 쓰지 않는다.
- 이 도구는 Product 상태·업무 종결·Audit 의미를 변경하지 않는다.

## Backup

Development PostgreSQL이 실행 중일 때:

```sh
infra/backup/postgres_backup.sh \
  doul_supervision \
  .local-backups/postgres/doul_supervision.dump
```

생성물:

```text
doul_supervision.dump
doul_supervision.dump.sha256
```

Sidecar는 dump bytes의 SHA-256 한 줄만 저장한다.

## Clean Restore Verification

운영 primary를 직접 덮지 않고 별도 DB로 복구한다.

```sh
infra/backup/postgres_restore_clean.sh \
  .local-backups/postgres/doul_supervision.dump \
  doul_restore_verify
```

이 스크립트는 target DB가 있으면 제거하고 `template0`에서 다시 만든 뒤 `pg_restore --exit-on-error`를 실행한다.

따라서 **검증용 clean target**에만 사용한다.

실제 Pilot/Production 원복 절차는 #46에서 다음을 추가로 확정해야 한다.

- 서비스 write 중지 또는 일관성 경계
- Object Storage와의 복구 시점 정합
- migration version
- Secret/config recovery
- RPO/RTO
- 승인권자와 실행 담당
- rollback/fallback

## CI 검증

CI는 임시 PostgreSQL volume에서:

1. source probe DB 생성
2. deterministic row 저장
3. custom-format backup 생성
4. SHA-256 검증
5. 별도 clean DB restore
6. row 내용 검증
7. 손상 dump hash 거부
8. primary DB restore 거부
9. volume 제거

까지 수행한다.
