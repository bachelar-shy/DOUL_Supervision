# Runtime Health Snapshot v1

이 도구는 Platform Runtime의 현재 상태를 **업무 Audit와 분리된 JSONL System Signal**로 출력한다.

현재 v1 범위:

- API `/health`
- PostgreSQL TCP reachability
- S3-compatible Object Storage health
  - RustFS `/health`
  - 기존 MinIO `/minio/health/ready` fallback
- Redis PING
- Worker heartbeat 존재 여부와 TTL
- 전체 runtime summary

출력 예:

```json
{"component":"redis-worker","details":{"ping":"PONG","workerHeartbeatPresent":true,"workerHeartbeatTtlSeconds":19},"latencyMs":1.2,"observedAt":"...Z","schemaVersion":"1.0","signal":"health","status":"ok"}
```

## 보안

다음 값은 출력하지 않는다.

- `REDIS_URL`
- DB/Object Storage credential
- password / secret / token
- 전체 DSN

오류도 원본 exception 문자열 대신 안전한 `errorType`만 기록한다.

## 업무 Audit와의 경계

이 JSONL은 System Observability이다.

다음을 대신하지 않는다.

- 누가 어떤 업무명령을 실행했는지
- 어떤 official state가 변경되었는지
- 승인/판정/종결 권한
- Evidence version과 공식 AuditEvent

즉, **System Log != Business Audit Log** 원칙을 유지한다.

## 아직 포함하지 않는 지표

Backend QueuePort/Redis Adapter가 확정되기 전에는 다음을 추측하지 않는다.

- queue depth
- job latency
- retry count
- dead-letter count
- AnalysisRun failure classification

Backend interface가 제공되면 별도 작은 PR로 연결한다.

## 실행

Development stack이 실행 중인 호스트에서:

```sh
REDIS_URL='redis://:...@127.0.0.1:6379/0' \
  python3 infra/observability/runtime_snapshot.py
```

Exit code:

- 모든 신호 정상: `0`
- 하나 이상 실패: `1`

이 출력은 향후 Staging monitoring/alert adapter의 입력 기준으로 사용한다.
