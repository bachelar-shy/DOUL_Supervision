# Runtime health configuration and review follow-up

Missing or blank `REDIS_URL` is a structured `redis-worker` error with
`errorType=MissingRedisUrl`. The other component signals and final platform
summary are still emitted; exit code is 1. No credential value is logged.
An external collector must also detect invocation/argument failures that occur
before probing and process timeouts, not only successful JSONL delivery.

Storage endpoint discovery tries `/health` and falls back to
`/minio/health/ready` only on HTTP 404. Authentication errors and readiness
failures are not silently replaced by a different success signal.

For an existing MinIO runtime that treats `/health` as an S3 bucket request
and returns 403, select its exact readiness path explicitly:

```sh
python3 infra/observability/runtime_snapshot.py \
  --object-storage-health-path /minio/health/ready
```

The configured development RustFS runtime uses `/health`. The observability
workflow performs a live health probe against the current development storage
image in a disposable Compose environment after unit tests. Legacy MinIO error
shapes are covered by controlled HTTP tests, not claimed as a newly executed
legacy-data migration or legacy server integration test.

TCP reachability is not a successful database query. Worker heartbeat is not
queue processing or media-analysis completion. Full observability, structured
application logs, capacity metrics and alert delivery remain under #45.
