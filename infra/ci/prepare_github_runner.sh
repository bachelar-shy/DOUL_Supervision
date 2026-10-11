#!/usr/bin/env bash
# Dedicated Mac mini runners preserve persistent tools and Docker caches.
set -euo pipefail

if [[ "${RUNNER_ENVIRONMENT:-}" != "self-hosted" || "${RUNNER_OS:-}" != "Linux" || "${RUNNER_ARCH:-}" != "ARM64" ]]; then
  echo "::error::Expected the dedicated Mac mini Linux ARM64 runner."
  exit 1
fi

echo "Dedicated Mac mini runner: preserving tools, containers and Docker caches."
df -h / /opt/doul-ci
docker info --format 'Docker server: {{.ServerVersion}}'
