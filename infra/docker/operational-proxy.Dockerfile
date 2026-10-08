# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS web-build
RUN apt-get update && apt-get install -y --no-install-recommends python3 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/mobile/package.json ./apps/mobile/package.json
COPY packages/client/package.json ./packages/client/package.json
COPY packages/localization/package.json ./packages/localization/package.json
RUN npm ci
COPY apps/web ./apps/web
COPY packages/client ./packages/client
COPY packages/localization ./packages/localization
COPY scripts/dependency_environment.py ./scripts/dependency_environment.py
RUN npm run web:build

FROM nginxinc/nginx-unprivileged:stable-alpine@sha256:15c994d10d6d78658721c3bcafff14cb281fba2a4bdf9d5ba92c416a472516e3
COPY --from=web-build /workspace/apps/web/dist /usr/share/nginx/html
COPY --chmod=644 infra/docker/operational-nginx.conf /etc/nginx/nginx.conf
USER 101:101
EXPOSE 8443
ENTRYPOINT []
CMD ["nginx", "-g", "daemon off;"]
