#!/bin/bash
set -euo pipefail
mkdir -p /opt/doul-ci/runner /opt/doul-ci/toolcache /opt/doul-ci/tmp
cd /opt/doul-ci/runner
if [ ! -f ./config.sh ]; then
  cp -a /runner-template/. .
fi
if [ ! -f .runner ]; then
  # Registration is supplied over stdin by the administrator, never baked in.
  exec sleep infinity
fi
# End the listener session after each job. Docker restarts it for the next job.
exec ./run.sh --once
