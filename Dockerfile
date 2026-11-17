# syntax=docker/dockerfile:1

# ---- 1. dependencies (all, incl. dev — needed for the build) ----------------
FROM oven/bun:1.3.10-alpine AS deps
WORKDIR /app
COPY package.json bun.lock tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
RUN bun install --frozen-lockfile

# ---- 2. build the SPA -------------------------------------------------------
FROM deps AS build
COPY . .
RUN bun run build

# ---- 3. production-only dependencies ---------------------------------------
FROM oven/bun:1.3.10-alpine AS prod-deps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
RUN bun install --frozen-lockfile --production

# ---- 4. runtime -------------------------------------------------------------
FROM oven/bun:1.3.10-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3001

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/api/node_modules ./apps/api/node_modules
COPY package.json bun.lock ./
COPY packages ./packages
COPY apps/api/package.json ./apps/api/package.json
COPY apps/api/src ./apps/api/src
COPY apps/api/drizzle ./apps/api/drizzle
COPY apps/web/package.json ./apps/web/package.json
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh

RUN chmod +x /usr/local/bin/entrypoint.sh

USER bun
EXPOSE 3001

# runs migrations, then starts the API (which also serves the SPA)
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
