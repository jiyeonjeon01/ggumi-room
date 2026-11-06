# syntax=docker/dockerfile:1

# ---- build: compile the Vite app (TypeScript check + production bundle) ----
FROM node:24-alpine AS build
WORKDIR /app
RUN npm install -g pnpm@12.16.1
# Dependencies first so they stay cached until the lockfile changes.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# The font isn't in the public repo (its license forbids redistribution), so
# it comes from the local build context (public/fonts/, git-ignored). The file
# must be the maker's original TTF byte for byte: deploy/fonts.sha256 holds its
# hash. REQUIRE_FONT=1 (set by docker-compose.yml) refuses to build without it;
# with REQUIRE_FONT=0 the site falls back to system fonts. See docs/DEPLOY.md > 폰트.
ARG REQUIRE_FONT=0
COPY deploy/fonts.sha256 /tmp/fonts.sha256
RUN if [ -f public/fonts/omyu-pretty.ttf ]; then \
      sha256sum -c /tmp/fonts.sha256 || { echo "ERROR: public/fonts/omyu-pretty.ttf is not the original file"; exit 1; }; \
    elif [ "$REQUIRE_FONT" = "1" ]; then \
      echo "ERROR: public/fonts/omyu-pretty.ttf not found (copy the original TTF there, see docs/DEPLOY.md)"; exit 1; \
    else \
      echo "WARNING: public/fonts/omyu-pretty.ttf not found - building with fallback fonts"; \
    fi
RUN pnpm build
# Vite copies public/ as is; make sure the served font is still the original.
RUN if [ -f public/fonts/omyu-pretty.ttf ]; then cmp public/fonts/omyu-pretty.ttf dist/fonts/omyu-pretty.ttf; fi

# ---- runtime: static files only, served by nginx as a non-root user ----
# No Node and no Vite dev server in the final image.
FROM nginxinc/nginx-unprivileged:1.31-alpine AS runtime
COPY deploy/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY deploy/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
