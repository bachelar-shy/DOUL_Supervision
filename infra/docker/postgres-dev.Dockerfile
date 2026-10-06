# syntax=docker/dockerfile:1

FROM postgres:16.15-alpine3.24

RUN apk upgrade --no-cache \
    && rm -f /usr/local/bin/gosu /usr/local/bin/gosu.asc

USER postgres
