#!/bin/bash
set -euo pipefail
mkdir -p /opt/doul-ci/runner /opt/doul-ci/toolcache
cd /opt/doul-ci/runner
if [ ! -f ./config.sh ]; then
  cp -a /runner-template/. .
fi
if [ ! -f .runner ]; then
  # Registration is supplied over stdin by the administrator, never baked in.
  exec sleep infinity
fi
exec ./run.sh
