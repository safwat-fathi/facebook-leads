# syntax=docker/dockerfile:1
# Tested with Node 22.21 (the app needs >= 22.19 for undici 8 and node:sqlite).
FROM node:22.21-slim AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM node:22.21-slim AS run
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 DATA_DIR=/data NEXT_TELEMETRY_DISABLED=1
RUN useradd --system --uid 1001 app && mkdir /data && chown app /data
WORKDIR /app
COPY --from=build --chown=app /app/.next/standalone ./
COPY --from=build --chown=app /app/scripts/gen-key.mjs /app/scripts/backup.mjs ./scripts/
USER app
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--no-warnings", "server.js"]
