#!/usr/bin/env bash
# The public repository runs untrusted PR checks only on disposable GitHub VMs.
# Never reclaim disk, alter Docker state, or prune caches on the user's Mac mini.
set -euo pipefail

if [[ "${RUNNER_ENVIRONMENT:-}" != "github-hosted" || "${RUNNER_OS:-}" != "Linux" || "${RUNNER_ARCH:-}" != "X64" ]]; then
  echo "::error::DOUL CI requires an ephemeral GitHub-hosted Linux X64 runner."
  exit 1
fi

echo "Isolated GitHub-hosted Linux runner: leaving all host toolchains intact."
df -h /
if command -v docker >/dev/null 2>&1; then
  docker info --format 'Docker server: {{.ServerVersion}}'
fi
free_kib="$(df -Pk / | awk 'NR == 2 {print $4}')"
if (( free_kib < 6 * 1024 * 1024 )); then
  echo "::error::Less than 6 GiB free on disposable CI runner."
  exit 1
fi
