# syntax=docker/dockerfile:1

FROM python:3.12-slim-bookworm AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

RUN apt-get update \
    && apt-get upgrade -y --no-install-recommends \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 doul \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin doul

COPY services/api/requirements.lock /tmp/requirements.lock
RUN --mount=type=cache,target=/root/.cache/pip \
    python -m pip install -r /tmp/requirements.lock

COPY app ./app
COPY services ./services
COPY infra/docker/api_entrypoint.py ./infra/docker/api_entrypoint.py

RUN mkdir -p /data \
    && chown -R doul:doul /data

USER doul

EXPOSE 8791

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8791/health', timeout=2).read()" || exit 1

CMD ["python", "-m", "infra.docker.api_entrypoint"]
