# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────────
# espa-stamos-erp — production image
# Next.js 16 (standalone) + Prisma 7 (pg driver adapter) on Node 22 / Debian slim.
# Debian (glibc) is used on purpose: sharp + pdf libs + Prisma engines are far
# more reliable here than on Alpine/musl.
# ─────────────────────────────────────────────────────────────────────────────

# 1) deps — install node_modules (postinstall runs `prisma generate`, so the
#    prisma schema must be present before `npm ci`).
FROM node:22-slim AS deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# 2) builder — generate Prisma client + build Next.js (produces .next/standalone).
FROM node:22-slim AS builder
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
# Prisma's PrismaClient throws at construction if DATABASE_URL is unset, even
# during build (no connection is opened). A placeholder keeps `next build` happy;
# the real value is injected at runtime by Coolify. Override at build time with
# --build-arg DATABASE_URL=... if any page actually queries the DB during build.
ARG DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
ENV DATABASE_URL=$DATABASE_URL

# `npm run build` === `prisma generate && next build` (see package.json)
RUN npm run build

# 3) runner — minimal runtime. Copies only the standalone server + static assets.
FROM node:22-slim AS runner
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Run as non-root.
RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

# Standalone output: server.js + the minimal traced node_modules.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
# Safety net: ensure the generated Prisma client (and any engine binary) is
# present even if Next's output tracing missed it.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
# Schema + migrations, for running `prisma migrate deploy` out-of-band if needed.
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
# Wiki MDX content is read from disk at runtime (lib/wiki/loader.ts).
COPY --from=builder --chown=nextjs:nodejs /app/docs ./docs

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
