# syntax=docker/dockerfile:1

FROM node:24.19.0-bookworm-slim AS build

RUN apt-get update && apt-get install -y --no-install-recommends python3 \
    && rm -rf /var/lib/apt/lists/*
RUN npm install --global npm@12.2.0
WORKDIR /workspace

COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/mobile/package.json ./apps/mobile/package.json
COPY packages/client/package.json ./packages/client/package.json
COPY packages/localization/package.json ./packages/localization/package.json
COPY scripts/apply_braces_backport.cjs ./scripts/apply_braces_backport.cjs
COPY security/backports/braces-3.0.3.json ./security/backports/braces-3.0.3.json
COPY security/backports/braces-3.0.3.md ./security/backports/braces-3.0.3.md
COPY scripts/apply_node_forge_backport.cjs ./scripts/apply_node_forge_backport.cjs
COPY security/backports/node-forge-1.4.0.json ./security/backports/node-forge-1.4.0.json
COPY security/backports/LICENSE.BSD-3-Clause ./security/backports/LICENSE.BSD-3-Clause
COPY security/backports/node-forge-1.4.0.md ./security/backports/node-forge-1.4.0.md

RUN --mount=type=cache,target=/root/.npm \
    for attempt in 1 2; do \
      npm ci --include=optional && node -e "import('rolldown')" && exit 0; \
    done; exit 1

COPY apps/web ./apps/web
COPY packages/client ./packages/client
COPY packages/localization ./packages/localization

COPY scripts/dependency_environment.py ./scripts/dependency_environment.py
RUN npm run web:build

FROM nginxinc/nginx-unprivileged:alpine AS runtime

COPY --chmod=644 infra/docker/web-nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/web/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
