# 112 Civil Protection Alerts — Design

## Problem

`@112Greece` posts official civil-protection "112 activation" alerts on X — currently almost
always fire-related, but the account also covers other hazard types (floods, extreme weather,
etc.). Each alert names a specific local area and/or a containing regional unit/periphery, and
warns nearby residents to take shelter. We want these shown on the map as a distinct layer: a pin
plus a highlighted area (not just a point), and included in push notifications — without changing
any existing behavior (satellite detections, Fire Service incident reports, etc.).

## Why a new domain concept, not an extension of `incident_reports`

`incident_reports` (Fire Service situational updates, free-text, fire-only, human-authored) and
112 alerts (official government evacuation alerts, any hazard, structured template, needs an area
polygon not just a point) are structurally different in the same way `incident_reports` itself was
judged structurally different from satellite `detections` (see `docs/DECISIONS.md`, 2026-07-20:
"text reports geocoded from free text are structurally different from satellite pixels; no
confirmation/decay logic applies"). Bolting alerts onto `incident_reports` would conflate two
different trust levels and semantics under one table and one map toggle. This design adds a fully
parallel concept instead: own table, port, adapter, ingest service, X client, marker, area layer,
and Layers-panel toggle.

## Data model

New migration (appended to `migrations.ts`), new table `civil_protection_alerts`:

```sql
CREATE TABLE civil_protection_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,             -- 'ALERT_112_X'
  text TEXT NOT NULL,               -- raw Greek post text
  url TEXT NOT NULL,
  published_at TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  precision TEXT NOT NULL CHECK (precision IN ('locality','regional_unit')),
  area_polygon TEXT,                -- nullable, serialized GeoJSON Polygon/MultiPolygon
  hidden INTEGER NOT NULL DEFAULT 0,
  ingested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
```

New table `alert_failed_posts` (mirrors `incident_failed_posts` exactly — same `(source,
external_id)` PK, same reason it exists: a post that never resolves must not be re-logged on every
poll, and `findLatestExternalId` must consider both tables so `since_id` still advances past
unresolvable posts).

New shared types (`@pyrmap/shared`):

```ts
export type AlertPrecision = 'locality' | 'regional_unit';

// [lon, lat] pairs; Polygon rings are exterior+holes, MultiPolygon is one level up (a list of
// Polygon ring-sets) — same shape convention already used by domain/greeceBoundary.ts.
export interface GeoJsonPolygon {
  type: 'Polygon';
  coordinates: number[][][];
}
export interface GeoJsonMultiPolygon {
  type: 'MultiPolygon';
  coordinates: number[][][][];
}
export type AlertAreaPolygon = GeoJsonPolygon | GeoJsonMultiPolygon;

export interface CivilProtectionAlert {
  id: number;
  source: string;
  text: string;
  url: string;
  publishedAt: string;
  latitude: number;
  longitude: number;
  precision: AlertPrecision;
  areaPolygon: AlertAreaPolygon | null;
}
```

`FiresResponse` gains `alerts: CivilProtectionAlert[]`.

New port `CivilProtectionAlertRepository` (own file), mirroring `IncidentReportRepository`:
`findLatestExternalId`, `recordFailedPostIfNew`, `insertAlerts`, `findAlertsSince`,
`updateAlertLocation` (also nulls `area_polygon` and sets `precision='locality'` — a hand-placed
point has no known boundary), `hideAlert`, `deleteAlert`, `recordFetchLog`. New adapter
`SqliteCivilProtectionAlertRepository` implementing it, same connection-sharing convention as
`SqliteIncidentReportRepository`.

## Ingestion & parsing

New adapter `Alert112XClient`, mirroring `PyrosvestikiXClient` exactly (same X API v2 mechanics,
`exclude=retweets` only, `since_id`/`start_time+end_time` dual methods). `@112Greece`'s numeric
user id is resolved once via a single `GET /2/users/by/username/112Greece` lookup call, hardcoded
as a constant afterward (same pattern as `PYROSVESTIKI_USER_ID`). Reuses the existing
`X_BEARER_TOKEN` — no new env var.

New `domain/alert112Parsing.ts`:

- `isAlert112Post(text)`: true iff the text contains the literal Greek header `Ενεργοποίηση`
  (never `Activation`). This single check both identifies a real 112 activation and skips the
  English-language duplicate the account always also posts — the account's English post uses
  "Activation" instead, so filtering on the Greek word alone gets us free-of-charge deduplication
  without any cross-language timestamp matching.
- `extractAlertAreas(text)`: parses the pattern `στην περιοχή #<Locality> της
  {Περιφερειακής Ενότητας|Περιφέρειας} #<Region>` (locality optional, region required for a
  match). Hashtags have `#` stripped and `_` replaced with a space (`#Πάτημα_Κορωπίου` →
  `Πάτημα Κορωπίου`). No hazard-type classification or filtering — every activation is stored
  regardless of cause (fire, flood, extreme weather, ...), per explicit user decision.

New `services/alert112IngestService.ts`, mirroring `incidentIngestService.ts`'s
`processIncidentPost`/`ingestIncidentReports` shape as its own small file (not a shared generic
abstraction — matches the existing `ingestService.ts`/`alertIngestService.ts` precedent of
parallel per-source files rather than a forced-generic one). Same never-throws / `fetch_log` /
per-day-failure-log conventions (`services/incidentFailureLog.ts`'s pattern, reused for a
`source='ALERT_112_X'` log stream) as every other ingest path.

## Geocoding & area polygons

**Point resolution** (for the pin): reuse `NominatimClient` → offline gazetteer fallback exactly as
`incident_reports` does today (`geocodeGreekLocation(settlement, regionGenitive)`). The hashtag
names are nominative, dictionary-form Greek, which Nominatim already handles natively; no new
declension logic is expected, and any gap is logged through the same no-geocode failure path.

**Area polygon** (best-effort):

1. If a locality was named and resolved to a point, also query Nominatim for that same place with
   `polygon_geojson=1`, filtered to the trusted place/admin `addresstype` allowlist already
   established for point geocoding (`docs/DECISIONS.md`, 2026-07-22). If the result carries real
   boundary geometry (not just a point node — common for small OSM-mapped hamlets), use it.
2. If no locality was named at all, or the named locality has no boundary geometry, fall back to
   the **regional unit's** pre-bundled polygon (matched via the same regional-unit gazetteer used
   for the region-genitive lookup).
3. If even the regional-unit/periphery name doesn't match our 54-entry gazetteer (e.g. a bare
   periphery name not covered by it), store the alert with `area_polygon = null` — point pin only.
   Documented as a known, acceptable gap; not fixed in this round.

**Regional-unit polygons**: one-time fetch of all 54 units' boundaries via Nominatim (same
technique as the existing country-outline `greeceBoundary.json`, `docs/DECISIONS.md` 2026-07-22),
bundled as a new static `domain/data/greeceRegionalUnitBoundaries.json`. Unlike the country
boundary (which needed full coastline precision for near-shore islands), these request Nominatim's
simplified polygon output to keep the bundle small — highlighting doesn't need survey-grade
precision.

## API, push notifications, scheduler

- New cron job `pollAlerts` at the same `* * * * *` cadence as `pollIncidents` (same urgency
  argument; `since_id` makes idle polls free per `docs/DECISIONS.md` 2026-07-20).
- `FiresResponse` (`GET /api/fires`) gains `alerts: CivilProtectionAlert[]`, fetched the same
  combined way `incidents` already is — no new read endpoint.
- New `routes/alerts.ts`, mirroring `routes/incidents.ts` exactly: `PATCH /api/alerts/:id/location`,
  `POST /api/alerts/:id/hide`, `DELETE /api/alerts/:id`, same admin-tier auth gating, same
  `updateBus.publish()` on every mutation.
- `notifyNewAlerts()` added to `pushNotificationService.ts`, same one-push-per-new-row pattern as
  `notifyNewIncidents`, wired into the scheduler identically.
- SSE: no changes needed — the existing `/api/events` "refresh" signal already causes clients to
  refetch `/api/fires`, which now includes alerts.

## Frontend

- New `Alert112Marker.tsx`: a distinct icon (siren/warning triangle) — deliberately different from
  the existing fire-flame satellite circles and the incident-report megaphone pin, so it reads as
  "official emergency alert" rather than "someone reported a fire."
- New `Alert112AreaLayer.tsx`: renders `areaPolygon` (when present) via Leaflet's built-in
  `GeoJSON` layer (already available through the existing `leaflet`/`react-leaflet` dependency, no
  new package), semi-transparent fill, a border color distinct from the EFFIS overlays.
- New Layers-panel toggle ("112 Alerts"), same collapsed/localStorage persistence pattern as
  existing toggles.
- `IncidentEditControls`-equivalent component for alerts: drag/manual-coordinate-entry/place-search
  relocation (clears `areaPolygon`, sets `precision='locality'`) and hide-forever/delete-forever,
  gated behind edit mode + the existing single-user auth session, same as incident reports today.

## Testing

- `alert112Parsing.test.ts`: `isAlert112Post` (Greek header required, English variant rejected),
  `extractAlertAreas` (locality+regional-unit, locality+periphery, locality-only, region-only,
  underscore-to-space conversion), using real post text captured from the account.
- `Alert112XClient.test.ts`: mirrors `PyrosvestikiXClient.test.ts`.
- `alert112IngestService.test.ts`: mirrors `incidentIngestService.test.ts`, including the
  once-ever failure-logging behavior.
- `SqliteCivilProtectionAlertRepository.test.ts`: mirrors
  `SqliteIncidentReportRepository.test.ts`.
- Polygon fallback chain: unit tests for "locality polygon found" / "locality has no polygon, uses
  regional-unit fallback" / "no locality named, uses regional-unit directly" / "regional unit not
  in gazetteer, no polygon" using injected fake Nominatim responses (no real network calls in
  tests, per `CLAUDE.md`'s testing rules).
- Route tests for `routes/alerts.ts` mirroring `incidents.test.ts`.
- `notifyNewAlerts` test mirroring the existing push notification tests.

## Known, accepted gaps (not fixed in this round)

- A named locality with no OSM boundary geometry gets a point pin only, not a regional-unit
  fallback highlight (explicit user decision, this round).
- A regional-unit/periphery name outside our 54-entry gazetteer (e.g. an uncommon periphery-level
  reference) gets a point pin only, no polygon.
- No hazard-type icon differentiation (fire vs. flood vs. other) — a single generic alert marker
  style for all 112 activations, regardless of cause.
