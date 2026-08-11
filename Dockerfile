# VOX production image. Deliberately NOT using `output: "standalone"` — Next's
# file-tracing for standalone output can miss better-sqlite3's native .node
# binding, and this is a single small always-on instance where image size
# doesn't matter, so correctness wins over a smaller image.
#
# node:22-slim (Debian, glibc) rather than an Alpine base: better-sqlite3
# ships prebuilt glibc binaries for most platforms, so this usually avoids
# needing a C++ toolchain at all. But the deps stage still installs one as a
# fallback — if the builder's exact platform has no matching prebuild, npm
# falls back to compiling from source via node-gyp, which needs python3/make/
# g++ and silently fails without them. Only affects this build stage's image,
# not the final runtime image (the compiled node_modules are copied forward,
# the compiler isn't).

FROM node:22-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ openssl \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
# NOT --ignore-scripts: that was tried and is wrong — it also silently skips
# better-sqlite3's own install script (the thing that actually builds its
# native database binding), not just our "postinstall": "prisma generate".
# Confirmed by a real deploy where the app started but Prisma couldn't find
# better_sqlite3.node anywhere. Fix is to give this stage the Prisma schema
# it needs so postinstall succeeds naturally, and let all install scripts run.
RUN npm ci

FROM node:22-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
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

RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
RUN groupadd --system vox && useradd --system --gid vox --home /app vox

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY docker-entrypoint.sh ./docker-entrypoint.sh
# Strip any \r from line endings unconditionally, regardless of what the
# host checkout did to this file (e.g. Git for Windows' core.autocrlf=true
# rewriting it to CRLF) — a CRLF shebang line breaks the interpreter lookup
# inside the container with a misleading "No such file or directory" for the
# script itself. Doing this in the build makes the image correct no matter
# what platform it was built from, instead of depending on the checkout.
RUN sed -i 's/\r$//' docker-entrypoint.sh && chmod +x ./docker-entrypoint.sh

# The SQLite file lives on a mounted Fly volume, not in the image — writable
# by the non-root user, and survives redeploys since it's outside /app.
RUN mkdir -p /data && chown -R vox:vox /data /app

USER vox
EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
