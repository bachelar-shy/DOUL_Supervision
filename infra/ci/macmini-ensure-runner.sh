#!/bin/bash
set -euo pipefail
export PATH=/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin
if ! docker --context colima-doul-ci info >/dev/null 2>&1; then
  colima --profile doul-ci start --activate=false
fi
if [ "$(docker --context colima-doul-ci inspect -f '{{.State.Running}}' doul-ci-runner)" != true ]; then
  docker --context colima-doul-ci start doul-ci-runner
fi
