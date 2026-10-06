# syntax=docker/dockerfile:1

FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/opt/doul-supervision

RUN apt-get update \
    && apt-get upgrade -y --no-install-recommends \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10002 doul-worker \
    && useradd --uid 10002 --gid 10002 --no-create-home --shell /usr/sbin/nologin doul-worker

WORKDIR /opt/doul-supervision

COPY services/api/requirements.lock /tmp/requirements.lock
RUN pip install --no-cache-dir --requirement /tmp/requirements.lock \
    && rm -f /tmp/requirements.lock

COPY app ./app
COPY services ./services
COPY infra/docker/worker_runtime.py /opt/doul-platform/worker_runtime.py

USER doul-worker

HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=5 \
    CMD ["python", "/opt/doul-platform/worker_runtime.py", "--check"]

ENTRYPOINT ["python", "/opt/doul-platform/worker_runtime.py"]
CMD ["python", "-m", "services.worker"]
