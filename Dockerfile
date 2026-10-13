# Explicit Node.js Dockerfile for the backend service.
# Railway's nixpacks builder was picking up the (now-removed) Caddyfile
# and building a Caddy image. This Dockerfile pins the runtime to Node.
# The railway.json at the repo root sets the root directory to backend/.

FROM node:20-alpine AS deps
WORKDIR /app
COPY backend/package.json backend/package-lock.json* ./
RUN npm ci --omit=dev

FROM node:20-alpine AS runtime
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY backend/ ./
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
