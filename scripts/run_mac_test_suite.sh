#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_python="${repo_root}/.venv/bin/python"
shared_site="${DOUL_SHARED_TEST_SITE_PACKAGES:-/Users/automation/work/DOUL_Supervision/.venv/lib/python3.9/site-packages}"

if [[ ! -x "${test_python}" ]]; then
  uv venv --python "$(command -v python3)" "${repo_root}/.venv"
fi
if [[ ! -d "${shared_site}" ]]; then
  echo "Set DOUL_SHARED_TEST_SITE_PACKAGES to the existing shared site-packages directory." >&2
  exit 2
fi

site_dir="$("${test_python}" -c 'import site; print(site.getsitepackages()[0])')"
mkdir -p "${site_dir}"
printf '%s\n' "${shared_site}" > "${site_dir}/shared-work-test-deps.pth"
uv pip install --python "${test_python}" -r "${repo_root}/requirements.mac-test.lock"

cd "${repo_root}"
mvp_status=0
runtime_status=0
"${test_python}" -m unittest discover -s tests_mvp -v || mvp_status=$?
"${test_python}" -m unittest discover -s tests_runtime -v || runtime_status=$?
if [[ "${mvp_status}" -ne 0 || "${runtime_status}" -ne 0 ]]; then
  exit 1
fi
