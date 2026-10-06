# syntax=docker/dockerfile:1
FROM python:3.12-slim-bookworm@sha256:7753c33391fc9f01d1984375bf375eb6686d52ba10db6043a86634a5ccf90dcf
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 TZ=UTC LANG=C.UTF-8 LC_ALL=C.UTF-8 SAL_USE_VCLPLUGIN=svp
WORKDIR /app
# Immutable Debian snapshot keeps LO, Poppler and font package versions stable.
# Package signatures remain enabled; only timestamp freshness is bypassed.
RUN rm -f /etc/apt/sources.list.d/debian.sources \
    && printf 'deb [check-valid-until=no] https://snapshot.debian.org/archive/debian/20261001T000000Z/ bookworm main\ndeb [check-valid-until=no] https://snapshot.debian.org/archive/debian-security/20261001T000000Z/ bookworm-security main\n' > /etc/apt/sources.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends libreoffice-writer poppler-utils fontconfig fonts-noto-core fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 doul \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin doul
COPY services/api/requirements.lock /tmp/api.lock
COPY services/document_runtime/requirements.lock /tmp/document.lock
RUN pip install --no-cache-dir -r /tmp/api.lock -r /tmp/document.lock
COPY app ./app
COPY services ./services
COPY scripts ./scripts
COPY infra/docker/api_entrypoint.py ./infra/docker/api_entrypoint.py
COPY tests ./tests
COPY tests_mvp ./tests_mvp
COPY tests_runtime ./tests_runtime
RUN python -m services.document_runtime.inventory /opt/doul-document-runtime.json \
    && mkdir -p /data && chown 10001:10001 /data
USER 10001:10001
CMD ["python", "-m", "services.document_runtime"]
