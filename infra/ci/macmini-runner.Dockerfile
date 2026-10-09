FROM ubuntu:24.04@sha256:534baea6a22c03a63003dbc8dbe78fe34bc0d7e595d9a9dc9834884ff530eb55
ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl git jq sudo unzip xz-utils python3 python3-venv \
    docker.io docker-compose-v2 libicu74 libssl3t64 zlib1g libkrb5-3 \
    liblttng-ust1t64 && rm -rf /var/lib/apt/lists/*
RUN apt-get update && apt-get install -y --no-install-recommends docker-buildx \
    && rm -rf /var/lib/apt/lists/*
ARG RUNNER_VERSION=2.338.0
ARG RUNNER_SHA256=628b4a7258487b80c1d3c221095a7ded349f5ae0175fd3dfab708d07428f041b
RUN mkdir /runner-template && cd /runner-template && \
    curl -fsSL --retry 3 -o runner.tar.gz \
      "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-arm64-${RUNNER_VERSION}.tar.gz" && \
    echo "${RUNNER_SHA256}  runner.tar.gz" | sha256sum -c - && \
    tar xzf runner.tar.gz && rm runner.tar.gz
ENV RUNNER_ALLOW_RUNASROOT=1 \
    RUNNER_TOOL_CACHE=/opt/doul-ci/toolcache \
    PLAYWRIGHT_SKIP_BROWSER_GC=1 \
    PLAYWRIGHT_BROWSERS_PATH=/opt/doul-ci/playwright
COPY macmini-runner-entrypoint.sh /usr/local/bin/doul-runner
ENTRYPOINT ["/bin/bash", "/usr/local/bin/doul-runner"]
