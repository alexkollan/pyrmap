# PyrMap

A self-hosted near-real-time map of wildfire detections over Greece — precisely over Greece:
satellite detections are filtered against Greece's real border polygon (sourced from
OpenStreetMap), so nearby Turkish coastline and islands don't show up as Greek hotspots or
trigger notifications. Two kinds of satellites
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
| **Time window** (6h/12h/24h/48h/72h) | How far back detections are shown. Default 6h; remembered across visits once you change it |
| **Refresh** | Manual re-fetch of already-ingested data. The map also updates live — the server pushes a signal the instant it ingests something new (via Server-Sent Events), so you don't need to press this or wait for the 5-minute fallback poll under normal conditions |
| **Re-scan** (6h/12h/24h) | Actually re-queries every source — including a fresh X API read — for that window, regardless of what's already been polled. Unlike Refresh, this can find posts/detections a normal poll missed (e.g. a since-last-seen tweet that failed to geocode the first time). Costs a real paid X API call, so it's gated by a 5-minute client-side cooldown after each use |
| **🔔/🔕 push-notification toggle** | Subscribes/unsubscribes this browser for push notifications on new detections and reported fires — only shown when the browser supports it. On iOS, only available after "Add to Home Screen" (regular Safari tabs can't receive push) |
| **Light/Dark mode** | Basemap + UI theme. Dark is the default |
| **Area/Point view** | Switches marker rendering, described above |
| **"Data stale" chip** (red) | The last fetch failed; the map still shows the previous good data with its timestamp |

The Layers and Legend panels' collapsed/expanded state is also remembered across visits.

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
  free** — X bills pay-per-use (~$0.005/tweet read). An empty poll (nothing new posted) costs
  nothing, so the real driver is how often the account actually posts, not the poll cadence
  itself (every 1 minute by default) — roughly $15–25/month in practice.
- **Login** (optional, strongly recommended for any public deployment): pick a username and
  password, and generate a session secret with:
  `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`
- **Push notifications** (optional — the 🔔 bell in the top bar, one push per new detection/
  reported fire): generate a VAPID keypair with
  `cd packages/server && pnpm exec web-push generate-vapid-keys`, then set
  `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` from its output plus `VAPID_SUBJECT` (a `mailto:` address
  the push services can contact you at, e.g. `mailto:you@example.com`). Leave any of the three
  unset and the bell simply doesn't appear — no error, just off.

### 2. Configure

```bash
cp .env.example .env
# edit .env: set FIRMS_MAP_KEY, and optionally LSASAF_USERNAME + LSASAF_PASSWORD, and/or
# EUMETSAT_CONSUMER_KEY + EUMETSAT_CONSUMER_SECRET, and/or X_BEARER_TOKEN, and/or
# AUTH_USERNAME + AUTH_PASSWORD + SESSION_SECRET, and/or HOST_DATA_DIR
```

For any GitOps deployment (Portainer or similar, where the compose file's working directory is
an ephemeral git clone rather than a path you control), also set `HOST_DATA_DIR` to an absolute
host path, e.g. `/home/alex/docker/data/pyrmapdb/`. Without it the SQLite data volume defaults to
a relative `./data`, which resolves *inside* that ephemeral clone directory and is deleted the
next time the stack is recreated — silently taking the database with it. The directory is created
automatically if it doesn't exist; plain local `docker compose up` (not through GitOps) doesn't
need this set at all.

The same data directory also gets a `logs/incidents/` subfolder (created automatically), holding
one file per UTC day of X posts the geocoder couldn't resolve — full original text plus why, kept
so a post that was missed or mis-parsed can be diagnosed later instead of silently vanishing.

### Access control

If `AUTH_USERNAME`, `AUTH_PASSWORD`, and `SESSION_SECRET` are all set, the whole app requires
login — `/api/fires`, `/api/status`, `/api/events`, everything except the static page shell and
`/api/health` (which stays open unconditionally so Docker's own healthcheck keeps working). Log
in once and the session persists for 90 days via a signed, HttpOnly cookie — no separate "remember
me" step. A **Log out** button appears in the top bar whenever login is active. Leave any of the
three unset and the site is fully open, no login screen at all — that's the default, meant for
local development, not for anything reachable from the internet.

### 3. Run

```bash
docker compose up -d --build
```

Live detections for Greece should appear within ~15 minutes.

The compose file publishes port `48080` on the host, mapped to the container's internal `8080`
(the app itself is unaffected — it still listens on 8080 inside the container; only the
host-side port differs). Point a `cloudflared` tunnel's public hostname at `http://localhost:48080`
on the host running the stack. For local testing on a different machine, add a gitignored
`docker-compose.override.yml` with a `ports: ["8080:8080"]` mapping if you'd rather use the
more familiar port locally — both mappings can coexist.

### 4. Check it's healthy

```bash
curl http://localhost:48080/api/health   # {"ok":true}
curl http://localhost:48080/api/status   # per-source fetch health + counts
```

### Continuous deployment

Pushing to `main` on the GitHub remote redeploys automatically: `.github/workflows/deploy.yml`
hits a Portainer webhook, which checks whether the commit hash actually changed and, if so,
pulls the repo and rebuilds the stack in place — no separate CI build or container registry
involved, the build runs on the same host that serves the app. Requires a Portainer stack
configured with GitOps auto-updates (webhook mode) pointed at this repo, and a
`PORTAINER_WEBHOOK_URL` repository secret in GitHub Actions.

The GitHub repo must stay **public** for this to be reliable: Portainer CE (confirmed through
2.43.0 STS, tracked upstream as issue #10340) has an open bug where editing/redeploying an
existing Git-sourced stack unreliably clears or mismanages the saved Git PAT, producing
"authentication required: Repository not found" even with a correct token — unrelated to token
scope, username, or anything on this repo's side. A public repo needs no git credentials to
clone, so the bug simply can't trigger. No secret has ever been committed here, so this is a
safe tradeoff, not a shortcut.

When you need to push an env-var-only change (no new commit, e.g. after editing the stack's
environment variables directly in Portainer's UI), the webhook won't help — it only fires on a
new commit hash. Use Portainer's **"Pull and redeploy"** button (not "Update the stack," which
doesn't exist in this version) to force a redeploy regardless of hash.

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
