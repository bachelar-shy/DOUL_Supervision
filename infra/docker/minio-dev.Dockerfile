# syntax=docker/dockerfile:1

ARG GO_VERSION=1.24
FROM golang:${GO_VERSION}-alpine AS build

ARG MINIO_VERSION=RELEASE.2025-10-15T17-29-55Z
ARG MC_VERSION=RELEASE.2025-08-13T08-35-41Z

RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go install github.com/minio/minio@${MINIO_VERSION} \
    && CGO_ENABLED=0 go install github.com/minio/mc@${MC_VERSION}

FROM alpine:3.21

RUN apk add --no-cache ca-certificates curl \
    && addgroup -S -g 10001 objectstore \
    && adduser -S -D -h /home/objectstore -u 10001 -G objectstore objectstore \
    && mkdir -p /data /home/objectstore \
    && chown -R objectstore:objectstore /data /home/objectstore

COPY --from=build /go/bin/minio /usr/local/bin/minio
COPY --from=build /go/bin/mc /usr/local/bin/mc

USER objectstore
WORKDIR /data

EXPOSE 9000 9001

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
    CMD curl -fsS http://127.0.0.1:9000/minio/health/live >/dev/null || exit 1

ENTRYPOINT ["minio"]
CMD ["server", "/data", "--address", ":9000", "--console-address", ":9001"]
