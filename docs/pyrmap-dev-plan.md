# PyrMap — Wildfire Near-Real-Time Map for Greece

**Development Plan & Architecture Specification**
Version 1.0 — 2026-07-17

This document is a complete, unambiguous specification. The implementing agent MUST follow it as written. Where a decision is marked **[FIXED]**, do not deviate. Where marked **[AGENT CHOICE]**, the agent may pick within the stated constraints.

---

## 1. Product Summary

A self-hosted web application showing active wildfire detections over Greece on an interactive map, using NASA FIRMS satellite data with a **two-tier confirmation model**:

- **Tier 1 — "Unconfirmed" (fast):** Geostationary detections (Meteosat SEVIRI via FIRMS). Latency ~15–30 min. Noisy, coarse (~3 km pixels).
- **Tier 2 — "Confirmed" (accurate):** Polar-orbiting detections (VIIRS 375 m, MODIS 1 km via FIRMS). 1–2 passes/day per satellite. High confidence, precise location.

A geostationary detection is **upgraded to confirmed** when a polar detection corroborates it spatially and temporally (rules in §6.3). Stale uncorroborated geostationary detections **decay and disappear** (rules in §6.4).

Out of scope for v1: snow cover, user accounts, push notifications, historical analytics beyond 7 days.

---

## 2. Tech Stack **[FIXED]**

| Layer | Choice | Notes |
|---|---|---|
| Monorepo | pnpm workspaces | Root `pnpm-workspace.yaml` |
| Language | TypeScript (strict mode) everywhere | `"strict": true` in all tsconfigs |
| Backend | Node.js 22 LTS + Fastify | Single service |
| Scheduler | `node-cron` inside the backend process | No external cron |
| Database | SQLite via `better-sqlite3` | Single file DB, WAL mode. No Postgres — deliberate simplicity |
| Frontend | React 18 + Vite | |
| Map | Leaflet + `react-leaflet` | OpenStreetMap raster tiles (free, attribution required) |
| Testing | Vitest (unit + integration), no e2e in v1 | |
| Lint/format | ESLint + Prettier, defaults | |
| Container | Docker, multi-stage build, single image | Backend serves the built frontend statically |
| Deployment | Docker Compose on Ubuntu VPS, exposed via Cloudflare Tunnel | No ports published to the internet |

### Monorepo layout **[FIXED]**

```
pyrmap/
├── pnpm-workspace.yaml
├── package.json                 # root: scripts, devDeps (eslint, prettier, vitest workspace)
├── docker-compose.yml
├── Dockerfile
├── .env.example
├── CLAUDE.md                    # agent working rules — see §13
├── docs/
│   ├── pyrmap-dev-plan.md       # this document, committed into the repo
│   ├── DECISIONS.md             # append-only decision log (see CLAUDE.md §8)
│   └── TODO.md                  # cross-session handoff notes (see CLAUDE.md §7)
├── packages/
│   ├── shared/                  # @pyrmap/shared — types, constants, pure logic
│   │   └── src/
│   │       ├── types.ts
│   │       ├── constants.ts
│   │       └── geo.ts           # haversine, bbox helpers (pure functions)
│   ├── server/                  # @pyrmap/server
│   │   └── src/
│   │       ├── index.ts         # entrypoint: start Fastify + scheduler
│   │       ├── app.ts           # buildApp(): Fastify instance (for tests)
│   │       ├── config.ts        # env parsing/validation
│   │       ├── domain/          # pure business logic (hexagonal core)
│   │       │   ├── confirmation.ts
│   │       │   ├── decay.ts
│   │       │   └── dedup.ts
│   │       ├── ports/           # interfaces
│   │       │   ├── FireDataSource.ts
│   │       │   └── FireRepository.ts
│   │       ├── adapters/
│   │       │   ├── firms/       # FirmsClient implements FireDataSource
│   │       │   │   ├── FirmsClient.ts
│   │       │   │   └── csvParser.ts
│   │       │   └── sqlite/      # SqliteFireRepository implements FireRepository
│   │       │       ├── SqliteFireRepository.ts
│   │       │       └── migrations.ts
│   │       ├── services/
│   │       │   ├── ingestService.ts
│   │       │   └── queryService.ts
│   │       ├── jobs/
│   │       │   └── scheduler.ts
│   │       └── routes/
│   │           ├── fires.ts
│   │           └── health.ts
│   └── web/                     # @pyrmap/web
│       └── src/
│           ├── main.tsx
│           ├── App.tsx
│           ├── api/client.ts
│           ├── components/
│           │   ├── FireMap.tsx
│           │   ├── FireMarker.tsx
│           │   ├── Legend.tsx
│           │   ├── StatusBar.tsx
│           │   └── FirePopup.tsx
│           └── hooks/
│               └── useFires.ts
```

Hexagonal rule: `domain/` imports nothing from `adapters/`, `services/`, or `routes/`. `services/` orchestrate domain + ports. Adapters implement ports. Enforce with ESLint `no-restricted-imports` if convenient, otherwise by review.

---

## 3. External Data Source: NASA FIRMS API

### 3.1 Credentials

- One env var: `FIRMS_MAP_KEY`. Obtained free from https://firms.modaps.eosdis.nasa.gov/api/ (email signup). The agent must NOT hardcode a key; read from env, fail fast at startup if missing.
- Rate limit: 5000 transactions per 10-minute window per key. Our usage (§5) is ≤ ~40 requests/hour. No client-side rate limiter needed, but log every request.

### 3.2 Endpoint **[FIXED]**

```
GET https://firms.modaps.eosdis.nasa.gov/api/area/csv/{MAP_KEY}/{SOURCE}/{west},{south},{east},{north}/{dayRange}
```

- Response: CSV with header row. Empty result = header row only (or the literal string "No data found" — handle both: if the body does not start with `latitude` treat as empty, log at warn level, return `[]`).
- `dayRange`: integer days back from now. We always use `1`.

### 3.3 Greece bounding box **[FIXED]**

```
west=19.0, south=34.5, east=29.7, north=42.0
```

Store in `@pyrmap/shared/constants.ts` as `GREECE_BBOX`.

### 3.4 Sources used **[FIXED]**

| Source string | Tier | Poll interval |
|---|---|---|
| `MSG_NRT` (Meteosat SEVIRI FRP-PIXEL) | geo (unconfirmed) | every 10 min |
| `VIIRS_NOAA21_NRT` | polar | every 30 min |
| `VIIRS_NOAA20_NRT` | polar | every 30 min |
| `VIIRS_SNPP_NRT` | polar | every 30 min |
| `MODIS_NRT` | polar | every 30 min |

**Important:** FIRMS source names occasionally change. At startup, the server MUST call `https://firms.modaps.eosdis.nasa.gov/api/data_availability/csv/{MAP_KEY}/ALL` once, parse the available source IDs, and log a warning for any configured source not present (skip it in polling rather than crash). If `MSG_NRT` is absent, look for any available source ID containing `MSG` or `SEVIRI` (case-insensitive) and use the first match; log which was chosen.

### 3.5 CSV columns

Polar sources (VIIRS/MODIS) columns include: `latitude, longitude, bright_ti4/brightness, scan, track, acq_date, acq_time, satellite, instrument, confidence, version, bright_ti5, frp, daynight`.
Geostationary columns include at minimum: `latitude, longitude, acq_date, acq_time, satellite, frp` (may differ in extras).

The parser (`csvParser.ts`) MUST:
- Parse by header names, never by column position.
- Required fields per row: `latitude`, `longitude`, `acq_date` (YYYY-MM-DD), `acq_time` (HHMM as string, may be 1–4 chars — left-pad to 4).
- Optional fields: `frp` (float), `confidence` (string or number; store raw as TEXT), `satellite`, `instrument`, `daynight`.
- Compute `acquiredAt` (ISO 8601 UTC): `acq_date` + `acq_time` are UTC. `acquiredAt = {acq_date}T{HH}:{MM}:00Z`.
- Rows failing to parse: skip and count; log one summary line per fetch (`parsed=N skipped=M`).

---

## 4. Data Model

### 4.1 SQLite schema **[FIXED]**

Migrations run at startup (simple ordered-array-of-SQL-strings in `migrations.ts`, tracked in a `migrations` table by index).

```sql
CREATE TABLE detections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dedup_key TEXT NOT NULL UNIQUE,        -- see §6.1
  tier TEXT NOT NULL CHECK (tier IN ('geo','polar')),
  source TEXT NOT NULL,                  -- e.g. 'VIIRS_NOAA20_NRT'
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  acquired_at TEXT NOT NULL,             -- ISO 8601 UTC
  frp REAL,
  confidence TEXT,
  satellite TEXT,
  instrument TEXT,
  daynight TEXT,
  inserted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX idx_detections_acquired ON detections (acquired_at);
CREATE INDEX idx_detections_tier ON detections (tier);

CREATE TABLE geo_status (
  detection_id INTEGER PRIMARY KEY REFERENCES detections(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('unconfirmed','confirmed','expired')),
  confirmed_by INTEGER REFERENCES detections(id),  -- polar detection id
  updated_at TEXT NOT NULL
);

CREATE TABLE fetch_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  http_status INTEGER,
  rows_parsed INTEGER NOT NULL DEFAULT 0,
  rows_inserted INTEGER NOT NULL DEFAULT 0,
  error TEXT
);
```

- WAL mode: `PRAGMA journal_mode = WAL;` at open. `PRAGMA foreign_keys = ON;`
- DB file path from env `DB_PATH`, default `/data/pyrmap.db` (Docker volume).

### 4.2 Retention **[FIXED]**

A daily job (03:00 UTC) deletes `detections` older than 7 days (`acquired_at < now - 7d`) and `fetch_log` older than 14 days.

---

## 5. Ingestion Pipeline

`scheduler.ts` registers with node-cron:

| Job | Schedule | Action |
|---|---|---|
| `poll-geo` | `*/10 * * * *` | Fetch `MSG_NRT` (dayRange=1), ingest as tier `geo` |
| `poll-polar` | `*/30 * * * *` | Fetch all 4 polar sources sequentially (not parallel), ingest as tier `polar`, then run confirmation pass (§6.3) |
| `decay` | `*/10 * * * *` | Run decay pass (§6.4) |
| `retention` | `0 3 * * *` | §4.2 |

Also run `poll-geo` and `poll-polar` once immediately at startup (after migrations).

Ingestion per fetch (`ingestService.ts`):
1. HTTP GET with 30 s timeout, 2 retries with 5 s backoff on network error or HTTP 5xx. On final failure: write `fetch_log` row with `error`, do not crash.
2. Parse CSV (§3.5).
3. For each row, compute `dedup_key` (§6.1), `INSERT OR IGNORE`.
4. For newly inserted `geo` rows, insert `geo_status` row with `status='unconfirmed'`.
5. Write `fetch_log` row.

All timestamps handled in UTC internally. Frontend converts for display.

---

## 6. Domain Logic (pure functions in `domain/`, fully unit-tested)

### 6.1 Deduplication (`dedup.ts`) **[FIXED]**

FIRMS `dayRange=1` returns overlapping data on successive polls; dedup is mandatory.

```
dedup_key = `${source}|${latitude.toFixed(4)}|${longitude.toFixed(4)}|${acquiredAt}`
```

### 6.2 Types (`@pyrmap/shared/types.ts`)

```ts
export type Tier = 'geo' | 'polar';
export type GeoStatus = 'unconfirmed' | 'confirmed' | 'expired';

export interface Detection {
  id: number;
  tier: Tier;
  source: string;
  latitude: number;
  longitude: number;
  acquiredAt: string;   // ISO UTC
  frp: number | null;
  confidence: string | null;
  satellite: string | null;
  instrument: string | null;
  daynight: string | null;
}

export interface GeoDetection extends Detection {
  tier: 'geo';
  status: GeoStatus;
  confirmedBy: number | null;
}
```

### 6.3 Confirmation (`confirmation.ts`) **[FIXED]**

Runs after every polar ingest. For each `geo` detection with `status='unconfirmed'` and `acquired_at >= now - 24h`:

- It becomes `confirmed` if there EXISTS a `polar` detection where:
  - haversine distance ≤ **5 km** (geo pixels are ~3 km + geolocation error), AND
  - `|polar.acquired_at - geo.acquired_at|` ≤ **6 hours**.
- Set `confirmed_by` to the nearest qualifying polar detection's id, `updated_at = now`.

`confirmation.ts` exports a pure function:
```ts
findConfirmation(geo: Detection, polarCandidates: Detection[]): Detection | null
```
The service layer supplies candidates pre-filtered by a coarse bbox (±0.1° lat/lon) via SQL for efficiency; the pure function applies exact haversine + time rules. Haversine lives in `@pyrmap/shared/geo.ts`.

### 6.4 Decay (`decay.ts`) **[FIXED]**

Every 10 min, for each `geo` detection with `status='unconfirmed'`:
- If `acquired_at < now - 12 hours` → set `status='expired'`.

Rationale: within 12 h at least 2–4 polar passes occur over Greece; an uncorroborated geo detection after that window is very likely a false positive. Expired detections are excluded from the default API response but kept in DB until retention deletes them.

Polar detections never expire; they simply age out of the query window (§7).

---

## 7. HTTP API (Fastify, JSON)

All routes prefixed `/api`. CORS: allow all origins in dev; in production same-origin only (frontend is served by the same server, so no CORS config needed beyond defaults).

### `GET /api/fires`

Query params:
- `hours` (int, default `24`, max `168`): return detections with `acquired_at >= now - hours`.
- `includeExpired` (`true`/`false`, default `false`).

Response `200`:
```json
{
  "generatedAt": "2026-07-17T12:00:00Z",
  "polar": [ Detection, ... ],
  "geo":   [ GeoDetection, ... ]
}
```
Sorted by `acquiredAt` desc. No pagination in v1 (Greece bbox, 7-day cap ⇒ bounded size).

### `GET /api/status`

```json
{
  "lastFetch": { "MSG_NRT": { "fetchedAt": "...", "ok": true, "rowsInserted": 3 }, "...": {} },
  "counts": { "geoUnconfirmed": 4, "geoConfirmed": 2, "polarLast24h": 17 },
  "dbSizeBytes": 123456
}
```

### `GET /api/health`

`200 {"ok": true}` if DB is reachable (runs `SELECT 1`). Used by Docker healthcheck.

Errors: standard Fastify error shape, correct 4xx for invalid params (e.g. `hours=abc` → 400).

---

## 8. Frontend Spec

Single page. No routing library.

### 8.1 Layout

- Full-viewport Leaflet map, initial view: center `[38.5, 24.0]`, zoom `7` (fits Greece).
- Base layer: OSM raster `https://tile.openstreetmap.org/{z}/{x}/{y}.png` with attribution `© OpenStreetMap contributors`.
- Top bar (`StatusBar`): app name, "Last updated HH:MM" (local time), time-window select (`6h / 12h / 24h / 48h / 72h`, default `24h`), auto-refresh indicator.
- Bottom-left: `Legend` explaining the three marker styles.

### 8.2 Markers **[FIXED]**

| Kind | Style |
|---|---|
| Polar (confirmed by nature) | Solid red circle marker, radius 8 px, opacity 0.9 |
| Geo `confirmed` | Solid orange circle, radius 10 px, with red 2 px border |
| Geo `unconfirmed` | Hollow orange circle (fillOpacity 0.25), radius 12 px, dashed border, plus CSS pulse animation |
| Geo `expired` | Not rendered |

Use `L.circleMarker` (via react-leaflet `CircleMarker`) — NOT icon images.

### 8.3 Popup (`FirePopup`)

On marker click: tier label ("Confirmed detection (VIIRS)" / "Unconfirmed satellite hotspot (Meteosat)"), acquired time in local Greek time (Europe/Athens) with relative time ("42 min ago"), FRP in MW if present, source, confidence if present, and for unconfirmed: the text "Χαμηλή ακρίβεια θέσης (~3 χλμ). Αναμένεται επιβεβαίωση από δορυφόρο υψηλής ανάλυσης." Bilingual: EN string + this GR string underneath.

### 8.4 Data fetching (`useFires`)

- Fetch `/api/fires?hours={selected}` on mount and every **5 minutes** (setInterval, cleared on unmount).
- Manual refresh button in StatusBar.
- On fetch error: keep last data, show a small red "data stale" chip in StatusBar with last-success time.
- No state management library; `useState` + the hook is sufficient.

### 8.5 Mobile

Must be usable on mobile: touch map controls (Leaflet default), StatusBar wraps, legend collapsible via a small toggle button below 640 px width.

---

## 9. Configuration

`.env.example` **[FIXED]**:
```
FIRMS_MAP_KEY=changeme
PORT=8080
DB_PATH=/data/pyrmap.db
LOG_LEVEL=info
```

`config.ts` validates at startup: `FIRMS_MAP_KEY` non-empty and not `changeme`, `PORT` integer. Fail with a clear message and exit code 1 otherwise. Use plain code, no config library.

Logging: Fastify's built-in pino, level from `LOG_LEVEL`.

---

## 10. Docker & Deployment

### 10.1 Dockerfile **[FIXED]** (multi-stage)

1. `node:22-slim` build stage: `corepack enable`, `pnpm install --frozen-lockfile`, `pnpm -r build` (shared → server → web; web build output goes to `packages/web/dist`).
2. Runtime stage `node:22-slim`: copy server `dist` + production node_modules (use `pnpm deploy --filter @pyrmap/server --prod` pattern), copy `packages/web/dist` to `/app/public`.
3. Server serves `/app/public` statically via `@fastify/static` with SPA fallback to `index.html` for non-`/api` routes.
4. `EXPOSE 8080`. `HEALTHCHECK CMD wget -qO- http://localhost:8080/api/health || exit 1` (interval 60s).
5. Note: `better-sqlite3` is a native module — ensure build stage has `python3 make g++` installed (`apt-get install -y python3 make g++`) before `pnpm install`, and that the compiled binary is what ships in the runtime stage (same base image/arch, so copying node_modules is fine).

### 10.2 docker-compose.yml **[FIXED]**

```yaml
services:
  pyrmap:
    build: .
    container_name: pyrmap
    restart: unless-stopped
    env_file: .env
    volumes:
      - ./data:/data
    networks:
      - web
networks:
  web:
    external: true
```

No `ports:` mapping. The host's existing `cloudflared` container (network `web`) routes a public hostname (e.g. `pyrmap.<domain>`) to `http://pyrmap:8080`. The agent's deliverable ends at the compose file; tunnel hostname config is done manually by the operator in Cloudflare Zero Trust. Document this in README.

---

## 11. Testing Requirements

Vitest. Minimum coverage — these tests MUST exist and pass:

**Unit (domain & parsing):**
1. `csvParser`: parses a valid VIIRS sample (fixture file), pads 3-char `acq_time`, computes correct `acquiredAt`; skips malformed rows; handles empty body and "No data found" body → `[]`.
2. `dedup`: same row twice → same key; 5th-decimal coordinate difference → same key (toFixed(4)); different source → different key.
3. `geo.haversine`: known pair (Athens 37.9838,23.7275 ↔ Thessaloniki 40.6401,22.9444) ≈ 300 km ±5 km.
4. `confirmation.findConfirmation`: polar at 4.9 km / 5 h → confirms; 5.1 km → does not; 6.5 h → does not; multiple candidates → returns nearest.
5. `decay`: 11 h 59 m old → stays unconfirmed; 12 h 1 m → expired.

**Integration (server, real SQLite in temp file, FIRMS mocked with `undici` MockAgent or injected fake `FireDataSource`):**
6. Ingest fixture CSV → rows in DB, re-ingest same fixture → 0 new rows.
7. Ingest geo fixture then polar fixture with a corroborating point → geo status becomes `confirmed` with correct `confirmed_by`.
8. `GET /api/fires?hours=24` returns correct shape and excludes expired; `includeExpired=true` includes them.
9. `GET /api/fires?hours=abc` → 400. `GET /api/health` → 200.

Fixtures: commit small real-format CSV samples under `packages/server/test/fixtures/`.

CI is out of scope for v1; `pnpm test` from root must run everything.

---

## 12. Git Workflow **[FIXED]**

- Initialize a local git repo at project root before writing any code (`git init`, default branch `main`). No remote in v1.
- First commit: scaffolding + this plan + `CLAUDE.md` + `.gitignore` (must ignore: `node_modules/`, `dist/`, `data/`, `.env`, `*.db`, `*.db-wal`, `*.db-shm`).
- **Commit granularity:** one commit per completed, working unit — roughly one per numbered sub-deliverable inside a milestone (e.g. "csvParser + tests" is one commit; an entire milestone is NOT one commit). Never commit broken code: `pnpm -r build` and `pnpm test` MUST pass before every commit. If a task is abandoned mid-way, revert rather than commit.
- **Message format:** Conventional Commits — `feat(server): firms csv parser with acq_time padding`, `fix(web): stale-data chip on fetch error`, `test(domain): confirmation distance edge cases`, `chore: scaffold monorepo`. Scope = package name without prefix (`server`, `web`, `shared`) or `repo` for cross-cutting.
- Each milestone ends with a tag: `git tag m1`, `m2`, … after its final commit.
- No branches in v1 — linear history on `main`. (Multiple agents work sequentially, not in parallel; see CLAUDE.md.)

## 13. CLAUDE.md **[FIXED]**

A `CLAUDE.md` file MUST exist at the repo root from the first commit, containing the agent working rules (git discipline, architecture invariants, context-efficiency practices, handoff protocol). Its required content is delivered alongside this plan as a separate file; copy it verbatim into the repo. When any rule in it conflicts with ad-hoc judgment, CLAUDE.md wins. Keep it updated: when a durable decision is made during development (e.g. FIRMS renamed a source and the fallback chose another), append it to the "Decision log" section in the same commit as the change.

## 14. Implementation Milestones (do in order, each ends with passing tests)

1. **M1 — Skeleton:** `git init` + first commit (plan, CLAUDE.md, .gitignore), monorepo scaffolding, shared types/constants/geo + tests (items 2,3), Fastify app with `/api/health`, config validation, Dockerfile builds.
2. **M2 — Ingestion:** FirmsClient + csvParser + tests (1), SQLite repo + migrations, ingestService + dedup, fetch_log, scheduler with geo+polar polls, startup data_availability check. Tests 6.
3. **M3 — Confirmation & decay:** domain functions + tests (4,5), wiring into polar ingest and decay job. Test 7.
4. **M4 — API:** `/api/fires`, `/api/status`, validation. Tests 8,9.
5. **M5 — Frontend:** map, markers, legend, popup, polling hook, status bar, mobile behavior.
6. **M6 — Packaging:** static serving from server, compose file, README (setup: get FIRMS key, `.env`, `docker compose up -d`, tunnel note), retention job.

Definition of done: `docker compose up` on a clean machine with only a valid `FIRMS_MAP_KEY` in `.env` yields a working map at `http://localhost:8080` (for local testing, operator may temporarily add a ports mapping) showing live FIRMS data for Greece within 15 minutes of startup.

---

## 15. Non-Goals / Explicit Constraints

- No user auth, no HTTPS handling in-app (tunnel terminates TLS), no websockets (polling is sufficient), no clustering of detections in v1, no i18n framework (the two GR strings are hardcoded), no Kubernetes, no external queue, no ORM.
- Do not add dependencies beyond: fastify, @fastify/static, better-sqlite3, node-cron, undici (or native fetch), pino (bundled with fastify), react, react-dom, react-leaflet, leaflet, and dev tooling (vite, vitest, typescript, eslint, prettier, @types/*). Any other dependency requires justification in a code comment at the import site.
