# GetInRoute Backend - Production Dockerfile
# Built for deployment on Ubuntu 22.04 (Matrixhost or any VPS).
# Runs as non-root, listens on $PORT (Railway/Heroku convention, default 3000).

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    APP_TIMEZONE=Asia/Kolkata

# Non-root user
RUN addgroup -S app && adduser -S app -G app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Pre-create the data directory (volume mount point)
RUN mkdir -p /data && chown -R app:app /app /data

USER app
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1:3000/health || exit 1

CMD ["node", "server.js"]
