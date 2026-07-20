# syntax=docker/dockerfile:1
FROM node:22-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm -r build
RUN pnpm deploy --filter @pyrmap/server --prod /app/deploy/server

FROM node:22-slim AS runtime
WORKDIR /app
COPY --from=build /app/deploy/server/dist ./dist
COPY --from=build /app/deploy/server/node_modules ./node_modules
COPY --from=build /app/deploy/server/package.json ./package.json
COPY --from=build /app/packages/web/dist ./public

ENV NODE_ENV=production
EXPOSE 8080
# node:22-slim doesn't ship wget or curl; using node itself (always present) avoids installing
# an extra package just for this. Was silently marking the container "unhealthy" unconditionally.
HEALTHCHECK --interval=60s CMD node -e "require('http').get('http://localhost:8080/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/index.js"]
