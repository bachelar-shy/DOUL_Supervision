#!/usr/bin/env bash
# Remove only unused preinstalled SDKs from disposable GitHub-hosted runners.
set -euo pipefail

if [[ "${RUNNER_ENVIRONMENT:-}" != "github-hosted" || "${RUNNER_OS:-}" != "Linux" || "${RUNNER_ARCH:-}" != "X64" ]]; then
  echo "::error::DOUL CI requires GitHub-hosted ubuntu-24.04 x64, not a self-hosted runner."
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
