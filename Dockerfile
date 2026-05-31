# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy manifests first for layer caching
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy source and build
COPY . .
RUN pnpm build

# ── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app

# Non-root user
RUN addgroup -S omnecor && adduser -S omnecor -G omnecor

# Copy only what's needed to run
COPY --from=builder --chown=omnecor:omnecor /app/dist ./dist
COPY --from=builder --chown=omnecor:omnecor /app/package.json ./package.json
COPY --from=builder --chown=omnecor:omnecor /app/node_modules ./node_modules
COPY --from=builder --chown=omnecor:omnecor /app/drizzle ./drizzle

ENV NODE_ENV=production
ENV OMNECOR_PORT=3000
ENV LOG_LEVEL=info

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/trpc/system.health || exit 1

USER omnecor

CMD ["node", "dist/server/_core/index.js"]
