# PyrMap

A self-hosted near-real-time map of wildfire detections over Greece. Two kinds of satellites
feed it: a **geostationary** one (Meteosat MTG, parked over Europe, scanning every 10 minutes —
fast but coarse) and four **polar-orbiting** ones (VIIRS ×3 + MODIS, passing a few times a day —
slow but precise). A fast detection starts life "unconfirmed" and is upgraded to "confirmed"
when a precise pass corroborates it. See `docs/pyrmap-dev-plan.md` for the full architecture.

---

## Using the map — what am I looking at?

### The markers (Point view)

Two independent visual channels: **color = how old**, **shape/border = how trusted**.

**Color** fades along the same gradient everywhere on the map — red → orange → green → blue →
grey — from the moment a fire was detected/reported to fully grey at the max age. Satellite
markers use a 24-hour scale (grey at 24h+); reported-fire pins (below) use a compressed 12-hour
scale, so age is comparable at a glance without the two data sources fighting over one clock.

| Shape | Meaning | Trust level |
|---|---|---|
| **Solid circle** | Detection by a polar satellite (VIIRS 375m / MODIS 1km) | High — these instruments are precise enough to be trusted on sight |
| **Solid circle with red border** | A fast Meteosat detection that a polar satellite later corroborated (within 5km and 6h) | High — two independent satellites agree |
| **Hollow, dashed, pulsing circle** | A fresh Meteosat detection, **not yet corroborated** | Early warning — position accurate to ~1–2km; could be a false positive |
| *(nothing)* | An unconfirmed detection older than 12h expires and is hidden — with 3–4 polar passes having seen nothing there, it was very likely noise | — |
| 📣 **Map pin (flame icon)** | Not a satellite detection at all — a fire reported by the Greek Fire Service's own X account, geocoded automatically from the Greek post text | Lowest — human-written text, automatically geocoded; see "Reported fires" below |

Click any marker for details: acquisition time (Greek local time + "X min ago"), the source
satellite, **FRP** (Fire Radiative Power in megawatts — how intensely it's burning; a big
wildfire front can exceed 100 MW, a burning field is single digits), **confidence** (the
satellite's own quality flag), and **pixel footprint** (the ground area that satellite pixel
covers — the detection is somewhere inside that area, not necessarily at the dot's center).

### Point view vs Area view (button in the top bar)

- **Point view** (default): every satellite detection as an individual marker, sized for
  readability. Best for "is something burning near X?"
- **Area view**: detections within a few km of each other are merged into a single filled
  shape approximating the fire's extent — a wide fire triggers many adjacent satellite pixels,
  and the shape traces their outline. The popup shows aggregate info: detection count,
  estimated extent in km², peak FRP, and first/last detection times. Red shapes contain at
  least one confirmed detection; dashed orange shapes are built from unconfirmed ones only.
  **The shape is an estimate derived from detection points — not an official fire perimeter.**

### The top bar

| Control | What it does |
|---|---|
| **Last updated HH:MM** | When the browser last fetched data successfully |
| **Time window** (6h/12h/24h/48h/72h) | How far back detections are shown. Default 24h. A fire "disappearing" often just means it aged out of the window |
| **Refresh** | Manual re-fetch. The map also updates live — the server pushes a signal the instant it ingests something new (via Server-Sent Events), so you don't need to press this or wait for the 5-minute fallback poll under normal conditions |
| **Light/Dark mode** | Basemap + UI theme. Dark is the default |
| **Area/Point view** | Switches marker rendering, described above |
| **"Data stale" chip** (red) | The last fetch failed; the map still shows the previous good data with its timestamp |

### The Layers panel (top right)

**Detections** — tick/untick each satellite feed:

| Source | What it is |
|---|---|
| **Meteosat MTG alerts (geo, 10-min)** | EUMETSAT's curated fire-alert bulletin, full scan every 10 minutes. Applies its own significance threshold, so it tends to miss small fires |
| **Meteosat MSG raw pixels (geo, 15-min)** | LSA SAF's unfiltered fire-pixel list — every detection, no significance threshold. Slightly slower cadence than the alert feed above, but catches small fires it misses |
| **VIIRS NOAA-20 / NOAA-21 / Suomi NPP** | The precise tier: 375m resolution, each passes over Greece ~2×/day (~1–3h data latency) |
| **MODIS Terra/Aqua** | The veteran precise tier: 1km resolution, ~2 passes/day |
| **Unconfirmed hotspots** | Show/hide the not-yet-corroborated Meteosat detections as a class — untick for a "confirmed only" map. On by default: an early warning you can't see is an early warning you don't have |
| **Reported fires (Fire Service X, unverified)** | Show/hide the purple megaphone markers described above |

### Reported fires — how they're geocoded, and why it's not pixel-precise

The Fire Service's posts (`@pyrosvestiki`) never include coordinates — just Greek place names,
e.g. *"#Πυρκαγιά στο Κορωπί Αττικής"* ("...in Koropi, Attica"). PyrMap parses that text and
matches it against a gazetteer of Greek settlements and regional units. This is automatic and
occasionally coarse, by design it never fabricates a precise point it isn't sure of:

- **Settlement match found** → pinned at that settlement, full-opacity pin.
- **Only the region/regional-unit resolves** (e.g. the place name is too small or oddly spelled
  to match) → pinned at the region's centroid instead — a deliberately faded pin, meaning
  "somewhere in this area," not "exactly here."
- **Neither resolves** → the report is skipped entirely rather than guessed.

Click a marker for the original Greek text and a link to the source post.

**Overlays** — independent context layers drawn on top:

| Overlay | What it is |
|---|---|
| **EFFIS hotspots (JRC)** | The EU's official fire map (green dots), rendered live from their servers. Same satellites as our red markers but processed independently by the European Commission's JRC — use it as a second opinion: green over red means both pipelines agree. Not clickable (it's an image layer) |
| **EFFIS burnt areas (season)** | Officially mapped burn perimeters for this fire season's larger fires (roughly 30ha+). Shows what *has burned*, hours-to-days delayed — complements the live detections, which show what *is burning* |
| **Wind at fires (Open-Meteo)** | A blue arrow at each fire showing which way the wind is **pushing** it, with speed on hover. Fetched live for each fire's location |

**Cluster distance slider** (Area view only, 1–10km): how close detections must be to merge
into one fire shape. Lower = fires split apart sooner; higher = nearby fires merge together.
Default 3km. This only regroups *existing* detections — it cannot reveal fires the satellites
never saw.

### How fresh is the data?

| Path | End-to-end delay |
|---|---|
| Fire ignites → orange unconfirmed marker | **~15–25 min** (10-min scan cycle + ~7-min publishing + 10-min polling) |
| Orange → confirmed (or new red marker) | Next polar pass: minutes to a few hours, ~4 passes/day |
| Unconfirmed with no corroboration | Expires and disappears after **12h** |
| Anything older than **7 days** | Deleted from the database entirely |

These are ingestion delays (satellite scan → our server). Once the server has it, your browser
sees it within seconds via the live push, not on the next 5-minute poll.

**An empty map is information too:** no orange markers means the fast satellite currently
sees nothing burning in Greece — not that the system is down (check the "Last updated" time
and the absence of the red "stale" chip to be sure).

---

## Deploying with Docker Compose

### 1. Get API keys

- **NASA FIRMS** (required): sign up free at https://firms.modaps.eosdis.nasa.gov/api/ → `MAP_KEY`
- **LSA SAF** (optional but recommended — the geo tier's small-fire-sensitive source): register at
  https://mokey.lsasvcs.ipma.pt/auth/signup (instant, email verification only)
- **EUMETSAT** (optional but recommended — enables the fast Meteosat tier): register at
  https://eoportal.eumetsat.int, then copy your consumer key/secret from
  https://api.eumetsat.int/api-key/
- **X API** (optional — enables the "reported fires" layer): create a project/app at
  https://developer.x.com and generate a Bearer Token. **Unlike the others, this one is not
  free** — X bills pay-per-use (~$0.005/tweet read); polling one account every 15 minutes costs
  roughly $15–25/month. Skip it if you don't want that recurring cost.

### 2. Configure

```bash
cp .env.example .env
# edit .env: set FIRMS_MAP_KEY, and optionally LSASAF_USERNAME + LSASAF_PASSWORD, and/or
# EUMETSAT_CONSUMER_KEY + EUMETSAT_CONSUMER_SECRET, and/or X_BEARER_TOKEN
```

### 3. Run

```bash
docker compose up -d --build
```

Live detections for Greece should appear within ~15 minutes.

The compose file publishes no ports — it expects a `cloudflared` container already running
on the external `web` Docker network, routing a public hostname to `http://pyrmap:8080`
(tunnel hostname configured by the operator in Cloudflare Zero Trust). For local testing,
create the network once (`docker network create web`) and add a gitignored
`docker-compose.override.yml` with a `ports: ["8080:8080"]` mapping.

### 4. Check it's healthy

```bash
curl http://localhost:8080/api/health   # {"ok":true}
curl http://localhost:8080/api/status   # per-source fetch health + counts
```

## Local development

Requires Node 22 and pnpm (via corepack).

```bash
corepack enable
pnpm install
pnpm -r build
pnpm test          # full suite, must pass before every commit
```

Start both the backend and frontend together with one command:

```bash
pnpm dev
```

This runs the backend against **fixture data** (`FIRMS_MOCK=1`, a local `data/dev.db`) at
`http://localhost:8080` and the frontend dev server at `http://localhost:5173`, and stops both
cleanly on Ctrl+C. Mock mode never calls any real API (FIRMS or EUMETSAT) — mock markers are
identifiable by `Source: MSG_NRT` in their popups; real Meteosat data shows `Source: MTG_FCI_FIR`.

Only hit the real APIs for explicit end-to-end verification — never during routine iteration.
For that, use the Docker image, or run `node packages/server/dist/index.js` with a real `.env`.

## Project structure

- `packages/shared` — cross-package types, constants, and pure geo helpers.
- `packages/server` — Fastify backend: FIRMS + EUMETSAT + LSA SAF ingestion, X-post geocoding
  (Greek-text parsing and a bundled GeoNames-derived gazetteer), confirmation/decay/retention
  jobs, SQLite storage, the `/api/*` routes, and static serving of the built frontend.
- `packages/web` — React + Leaflet frontend.

Agent working rules and architecture invariants are in `CLAUDE.md`. Durable technical
decisions are logged in `docs/DECISIONS.md`.
