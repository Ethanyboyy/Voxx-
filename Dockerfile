# VOX production image. Deliberately NOT using `output: "standalone"` — Next's
# file-tracing for standalone output can miss better-sqlite3's native .node
# binding, and this is a single small always-on instance where image size
# doesn't matter, so correctness wins over a smaller image.
#
# node:22-slim (Debian, glibc) rather than an Alpine base: better-sqlite3
# ships prebuilt glibc binaries, so this avoids needing a C++ toolchain in
# the image at all. Matches the Node version this app is developed against
# (see DEVELOPMENT.md).

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# DATABASE_URL only needs to be well-formed for `next build` (no queries run
# at build time) — the real value is provided at runtime via a Fly secret.
ENV DATABASE_URL="file:/data/prod.db"
ENV VOX_AI_PROVIDER="mock"
RUN npx prisma generate
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN groupadd --system vox && useradd --system --gid vox --home /app vox

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# The SQLite file lives on a mounted Fly volume, not in the image — writable
# by the non-root user, and survives redeploys since it's outside /app.
RUN mkdir -p /data && chown -R vox:vox /data /app

USER vox
EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
