# PyrMap

A self-hosted near-real-time map of wildfire detections over Greece, built on NASA FIRMS
satellite data with a two-tier confirmation model: fast-but-noisy geostationary detections
(Meteosat) are upgraded to "confirmed" once a precise polar-orbiting pass (VIIRS/MODIS)
corroborates them. See `docs/pyrmap-dev-plan.md` for the full architecture and product spec.

## Deploying with Docker Compose

### 1. Get a FIRMS API key

Sign up (free) at https://firms.modaps.eosdis.nasa.gov/api/ to get a `MAP_KEY`.

### 2. Configure

```bash
cp .env.example .env
# edit .env and set FIRMS_MAP_KEY to your real key
```

### 3. Run

```bash
docker compose up -d
```

This builds the image, starts the container, and begins polling FIRMS immediately. Live
detections for Greece should appear within ~15 minutes.

The compose file publishes no ports — it expects a `cloudflared` container already running
on the external `web` Docker network, routing a public hostname to `http://pyrmap:8080`. That
tunnel hostname is configured manually by the operator in Cloudflare Zero Trust; it is not
part of this repo's deliverable. For local testing without a tunnel, temporarily add a `ports:`
mapping (e.g. `"8080:8080"`) to `docker-compose.yml`.

### 4. Check it's healthy

```bash
curl http://localhost:8080/api/health   # {"ok":true}
```

## Local development

Requires Node 22 and pnpm (via corepack).

```bash
corepack enable
pnpm install
pnpm -r build
pnpm test          # full suite, must pass before every commit
```

To run the backend against fixture data instead of the real FIRMS API (no `FIRMS_MAP_KEY`
needed):

```bash
pnpm --filter @pyrmap/server dev:mock
```

Then, in another terminal, run the frontend dev server (proxies `/api` to `localhost:8080`):

```bash
pnpm --filter @pyrmap/web dev
```

Only hit the real FIRMS API for explicit end-to-end verification — never during routine
frontend/backend iteration.

## Project structure

- `packages/shared` — cross-package types, constants, and pure geo helpers.
- `packages/server` — Fastify backend: FIRMS ingestion, confirmation/decay/retention jobs,
  SQLite storage, the `/api/*` routes, and static serving of the built frontend in production.
- `packages/web` — React + Leaflet frontend.

Agent working rules and architecture invariants are in `CLAUDE.md`. Durable technical
decisions are logged in `docs/DECISIONS.md`.
