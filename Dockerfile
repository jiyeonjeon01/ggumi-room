# syntax=docker/dockerfile:1

# ---- build: compile the Vite app (TypeScript check + production bundle) ----
FROM node:24-alpine AS build
WORKDIR /app
RUN npm install -g pnpm@12.16.1
# Dependencies first so they stay cached until the lockfile changes.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# ---- runtime: static files only, served by nginx as a non-root user ----
# No Node and no Vite dev server in the final image.
FROM nginxinc/nginx-unprivileged:1.31-alpine AS runtime
COPY deploy/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY deploy/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
