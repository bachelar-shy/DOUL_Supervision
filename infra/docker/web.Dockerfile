# syntax=docker/dockerfile:1

FROM node:24-alpine AS build

WORKDIR /workspace

COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/mobile/package.json ./apps/mobile/package.json
COPY packages/client/package.json ./packages/client/package.json
COPY packages/localization/package.json ./packages/localization/package.json

RUN --mount=type=cache,target=/root/.npm npm ci

COPY apps/web ./apps/web
COPY packages/client ./packages/client
COPY packages/localization ./packages/localization

RUN npm run web:build

FROM nginxinc/nginx-unprivileged:alpine AS runtime

COPY infra/docker/web-nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/web/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
