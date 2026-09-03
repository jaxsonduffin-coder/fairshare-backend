# Multi-stage build: compile TypeScript in a full node image, then run the
# compiled JS in a slim image with only production dependencies. Keeps the
# deployed image small and avoids shipping ts-node/typescript/jest to prod.

# ---- build stage ----
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- production stage ----
FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
RUN npm install --omit=dev

COPY --from=build /app/dist ./dist

# Render/Fly/Railway all set PORT themselves; server.ts already reads
# process.env.PORT (defaulting to 4000 for local/manual runs).
EXPOSE 4000

# `/health` (see src/app.ts) reports DB reachability implicitly — if Postgres
# is unreachable, dbReady never resolves and the server never starts
# listening, so a platform health check against this endpoint doubles as a
# real end-to-end readiness probe, not just "the process is alive."
CMD ["node", "dist/server.js"]
