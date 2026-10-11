#!/usr/bin/env bash
# Persistent Mac mini runners must not run disposable-host SDK cleanup.
set -euo pipefail

if [[ "${RUNNER_ENVIRONMENT:-}" == "self-hosted" && "${RUNNER_OS:-}" == "Linux" && "${RUNNER_ARCH:-}" == "ARM64" ]]; then
  echo "Dedicated Mac mini Linux ARM64 runner: preserve persistent tools and Docker caches."
  df -h / /opt/doul-ci
  docker info --format 'Docker server: {{.ServerVersion}}'
  exit 0
fi

if [[ "${RUNNER_ENVIRONMENT:-}" != "github-hosted" || "${RUNNER_OS:-}" != "Linux" || "${RUNNER_ARCH:-}" != "X64" ]]; then
  echo "::error::Unsupported CI runner; expected dedicated Mac mini Linux ARM64."
  exit 1
fi

echo "::group::Disk before cleanup"
df -h /
docker info --format 'Docker server: {{.ServerVersion}}'
echo "::endgroup::"

# No Python/Node/Playwright JS/Docker tests need the Android, .NET, PowerShell
# or GHC toolchains. Preserve /opt/hostedtoolcache (Python/Node).
for path in /usr/local/lib/android /usr/share/dotnet /usr/local/share/powershell /opt/ghc; do
  if [[ -d "$path" ]]; then
    sudo rm -rf -- "$path"
  fi
done

docker builder prune --force >/dev/null
echo "::group::Disk after cleanup"
df -h /
echo "::endgroup::"
available_kib="$(df -Pk / | awk 'END {print $4}')"
if (( available_kib < 10 * 1024 * 1024 )); then
  echo "::error::Fewer than 10 GiB free for disposable CI build/test data."
  exit 1
fi
