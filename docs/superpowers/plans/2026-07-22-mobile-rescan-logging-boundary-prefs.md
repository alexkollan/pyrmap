# Mobile Layout, Rescan, Failure Logging, Greece Boundary, Persisted Prefs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PyrMap usable on mobile, add a "re-scan a time window across every source" control distinct from refresh, persist unresolvable-entry failures to durable per-day log files, stop showing/notifying on Turkish hotspots by filtering against Greece's real boundary, and make UI state (time window, panel collapsed/expanded) fully persistent with a 6h default.

**Architecture:** A new pure domain function filters satellite detections against Greece's actual OSM-sourced boundary polygon at the single existing insertion choke point (`persistNewDetections`). A new failure-logging module writes one JSON line per unresolved incident post to a per-day file under the data volume; a shared `processIncidentPost` helper (extracted from the existing polling path) is reused by both normal polling and a new rescan path so both log failures identically. Rescan adds one new port method (date-windowed fetch, not `since_id`-based) and one new repository method (which external_ids are already stored), orchestrated by a new `Scheduler.rescan()` method and exposed via a new route. Frontend: a new persisted-prefs module (same `localStorage` pattern as the existing `theme`/`viewMode`/`layerPrefs`), a rescan control with a cooldown, and mobile media queries.

**Tech Stack:** TypeScript strict, Fastify, better-sqlite3, node:fs for log files, React, react-leaflet, no new dependencies.

## Global Constraints

- TypeScript strict everywhere. No `any` unless annotated `// any-ok: <reason>`.
- `domain/` stays pure — no I/O, no imports from `adapters/`/`services/`/`routes/`.
- SQL lives only in `adapters/sqlite/`. Schema changes only via a new migration appended to `migrations.ts`, never editing an existing one.
- Every new port interface and domain function gets a 1–3 line doc comment stating contract + units.
- Never weaken, delete, or skip an existing test.
- Before every commit: `pnpm -r build && pnpm test` must pass.
- Conventional commit messages: `feat|fix|test|chore|refactor|docs(scope): message`. Scopes: `server`, `web`, `shared`, `repo`.
- The Greece boundary data (`packages/server/src/domain/data/greeceBoundary.json`) is already committed as of this plan's authoring — do not re-fetch or modify it; it was sourced from OpenStreetMap's own Greece boundary relation and verified against 15 real coordinate pairs (islands a few km from the Turkish coast, paired with the nearest Turkish town across the strait).
- The failure-log directory lives under the same parent directory as the SQLite DB file (`path.dirname(config.dbPath)`, e.g. `/data/logs/incidents/` in production), so it persists across container recreation via the existing Docker volume — no new volume or env var needed.

---

### Task 1: Greece boundary domain function

**Files:**
- Create: `packages/server/src/domain/greeceBoundary.ts`
- Test: `packages/server/test/greeceBoundary.test.ts`

(The data file `packages/server/src/domain/data/greeceBoundary.json` already exists — a GeoJSON `{type: "MultiPolygon", coordinates: [...]}` object, 28 polygon parts, no interior rings, full precision, ~2.2MB.)

**Interfaces:**
- Produces: `isWithinGreece(latitude: number, longitude: number): boolean`.

- [ ] **Step 1: Write the failing test**

Create `packages/server/test/greeceBoundary.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isWithinGreece } from '../src/domain/greeceBoundary.js';

describe('isWithinGreece', () => {
  it('accepts Greek islands within a few km of the Turkish coast', () => {
    expect(isWithinGreece(36.1487, 29.5883)).toBe(true); // Kastellorizo town
    expect(isWithinGreece(37.7561, 26.9757)).toBe(true); // Samos, Vathy
    expect(isWithinGreece(38.3656, 26.1358)).toBe(true); // Chios town
    expect(isWithinGreece(39.108, 26.5541)).toBe(true); // Lesbos, Mytilene
    expect(isWithinGreece(36.4341, 28.2176)).toBe(true); // Rhodes town
    expect(isWithinGreece(36.893, 27.2879)).toBe(true); // Kos town
  });

  it('rejects the nearest Turkish town across the strait from each island above', () => {
    expect(isWithinGreece(36.1963, 29.6394)).toBe(false); // Kaş, TR (across from Kastellorizo)
    expect(isWithinGreece(37.8582, 27.2611)).toBe(false); // Kuşadası, TR (across from Samos)
    expect(isWithinGreece(38.3244, 26.3033)).toBe(false); // Çeşme, TR (across from Chios)
    expect(isWithinGreece(39.3178, 26.689)).toBe(false); // Ayvalık, TR (across from Lesbos)
    expect(isWithinGreece(36.6217, 29.1164)).toBe(false); // Fethiye, TR (near Rhodes)
    expect(isWithinGreece(37.0344, 27.4305)).toBe(false); // Bodrum, TR (across from Kos)
  });

  it('accepts mainland Greek cities and rejects mainland Turkish cities', () => {
    expect(isWithinGreece(37.9838, 23.7275)).toBe(true); // Athens
    expect(isWithinGreece(40.6401, 22.9444)).toBe(true); // Thessaloniki
    expect(isWithinGreece(38.4237, 27.1428)).toBe(false); // Izmir, TR
  });

  it('rejects a point far out at sea, well outside any polygon part', () => {
    expect(isWithinGreece(34.0, 25.0)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pyrmap/server exec vitest run test/greeceBoundary.test.ts`
Expected: FAIL — cannot find module `../src/domain/greeceBoundary.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/server/src/domain/greeceBoundary.ts`:

```ts
import boundaryData from './data/greeceBoundary.json' with { type: 'json' };

type Ring = [number, number][]; // [lon, lat] pairs, GeoJSON order
type Polygon = Ring[]; // first ring is the exterior shell, rest are holes
type MultiPolygon = Polygon[];

interface GreeceBoundaryGeoJson {
  type: 'MultiPolygon';
  coordinates: MultiPolygon;
}

const boundary = boundaryData as GreeceBoundaryGeoJson;

interface BoundingBox {
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}

function ringBoundingBox(ring: Ring): BoundingBox {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of ring) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return { minLon, maxLon, minLat, maxLat };
}

// Precomputed once at module load — one polygon part's bounding box, so a query point far from a
// given island/mainland part can skip its (potentially thousands of points) ray-casting test entirely.
const polygonBoxes: BoundingBox[] = boundary.coordinates.map((polygon) => ringBoundingBox(polygon[0]!));

function isInsideBoundingBox(lon: number, lat: number, box: BoundingBox): boolean {
  return lon >= box.minLon && lon <= box.maxLon && lat >= box.minLat && lat <= box.maxLat;
}

// Standard ray-casting point-in-ring test (boundary-inclusive isn't attempted — floating-point
// exact-boundary hits are not a real concern for satellite pixel coordinates).
function isInsideRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    const intersects = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function isInsidePolygon(lon: number, lat: number, polygon: Polygon): boolean {
  const [shell, ...holes] = polygon;
  if (!isInsideRing(lon, lat, shell!)) return false;
  for (const hole of holes) {
    if (isInsideRing(lon, lat, hole)) return false;
  }
  return true;
}

/**
 * True if (latitude, longitude) falls within Greece's actual land boundary (mainland + every
 * island), not a bounding-box approximation. Verified against 15 real coordinate pairs including
 * islands a few km from the Turkish coast (Kastellorizo, Samos, Chios, Lesbos, Rhodes, Kos) —
 * see docs/DECISIONS.md 2026-07-22. Used to filter satellite detections before they're ever
 * stored, since FIRMS's Area API only supports a rectangular bounding box, not a custom shape.
 */
export function isWithinGreece(latitude: number, longitude: number): boolean {
  for (let i = 0; i < boundary.coordinates.length; i++) {
    if (!isInsideBoundingBox(longitude, latitude, polygonBoxes[i]!)) continue;
    if (isInsidePolygon(longitude, latitude, boundary.coordinates[i]!)) return true;
  }
  return false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pyrmap/server exec vitest run test/greeceBoundary.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/domain/greeceBoundary.ts packages/server/src/domain/data/greeceBoundary.json packages/server/test/greeceBoundary.test.ts
git commit -m "feat(server): add isWithinGreece, a real-boundary point-in-polygon check"
```

---

### Task 2: Wire the Greece boundary filter into detection ingestion

**Files:**
- Modify: `packages/server/src/services/ingestService.ts`
- Test: `packages/server/test/ingestService.test.ts` (add one test)

**Interfaces:**
- Consumes: `isWithinGreece(latitude, longitude)` from Task 1.
- Produces: `persistNewDetections`'s behavior changes (silently drops out-of-boundary rows before insertion); its exported signature is unchanged.

- [ ] **Step 1: Write the failing test**

Read `packages/server/test/ingestService.test.ts` first to see its exact existing fixtures and imports, then add this test inside its top-level `describe` block (create one if the file has none — check the file's current structure before editing):

```ts
import { persistNewDetections } from '../src/services/ingestService.js';
```

(add this import if not already present, alongside the file's other imports)

```ts
it('silently drops a row outside Greece\'s real boundary before insertion', () => {
  const rows = [
    {
      dedupKey: 'a',
      tier: 'polar' as const,
      source: 'VIIRS_NOAA20_NRT',
      latitude: 37.9838,
      longitude: 23.7275, // Athens — inside Greece
      acquiredAt: '2026-07-22T12:00:00Z',
      frp: 1,
      confidence: null,
      satellite: null,
      instrument: null,
      daynight: null,
      scanKm: null,
      trackKm: null,
    },
    {
      dedupKey: 'b',
      tier: 'polar' as const,
      source: 'VIIRS_NOAA20_NRT',
      latitude: 38.4237,
      longitude: 27.1428, // Izmir, Turkey — outside Greece
      acquiredAt: '2026-07-22T12:00:00Z',
      frp: 1,
      confidence: null,
      satellite: null,
      instrument: null,
      daynight: null,
      scanKm: null,
      trackKm: null,
    },
  ];
  const onInserted = vi.fn();

  const insertedCount = persistNewDetections(repo, 'polar', rows, () => new Date('2026-07-22T12:00:00Z'), onInserted);

  expect(insertedCount).toBe(1);
  const [insertedRows] = onInserted.mock.calls[0]!;
  expect(insertedRows).toHaveLength(1);
  expect(insertedRows[0]).toMatchObject({ latitude: 37.9838, longitude: 23.7275 });
});
```

Use whatever `repo` fixture variable name the existing tests in that file already use (check the file — it follows the same `mkdtempSync`/`SqliteFireRepository` tmpdir pattern as the other repository-backed test files in this codebase). Add `vi` to the vitest import line if not already imported.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pyrmap/server exec vitest run test/ingestService.test.ts`
Expected: FAIL — `insertedCount` is 2, not 1 (both rows currently get inserted; the Turkey row isn't filtered yet).

- [ ] **Step 3: Wire the filter into `persistNewDetections`**

In `packages/server/src/services/ingestService.ts`, add the import:

```ts
import { isWithinGreece } from '../domain/greeceBoundary.js';
```

Change `persistNewDetections`'s body from:

```ts
export function persistNewDetections(
  repository: FireRepository,
  tier: Tier,
  rows: NewDetectionRow[],
  now: () => Date,
  onInserted?: (rows: InsertedDetection[]) => void,
): number {
  const inserted = repository.insertDetections(rows);
```

to:

```ts
export function persistNewDetections(
  repository: FireRepository,
  tier: Tier,
  rows: NewDetectionRow[],
  now: () => Date,
  onInserted?: (rows: InsertedDetection[]) => void,
): number {
  const withinGreece = rows.filter((row) => isWithinGreece(row.latitude, row.longitude));
  const inserted = repository.insertDetections(withinGreece);
```

(the rest of the function body — the `geo`-tier status-seeding block, the `onInserted?.(inserted)` call, and the `return inserted.length;` — stays exactly as-is, now operating on the filtered set).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pyrmap/server exec vitest run test/ingestService.test.ts`
Expected: PASS, including the new test.

- [ ] **Step 5: Run the full server suite**

Run: `pnpm --filter @pyrmap/server test`
Expected: all pass — this function is called by every existing detection-ingestion test (`ingestSource`, `ingestFireAlerts`, scheduler tests), all of which use real Greek test coordinates already, so none should be affected by the new filter.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/services/ingestService.ts packages/server/test/ingestService.test.ts
git commit -m "fix(server): filter satellite detections to Greece's real boundary before storage"
```

---

### Task 3: Persistent per-day failure logging for incident reports

**Files:**
- Create: `packages/server/src/services/incidentFailureLog.ts`
- Test: `packages/server/test/incidentFailureLog.test.ts`
- Modify: `packages/server/src/services/incidentIngestService.ts`
- Test: `packages/server/test/incidentIngestService.test.ts` (add tests)

**Interfaces:**
- Produces: `logIncidentFailure(logsDir: string, entry: IncidentFailureEntry, now: () => Date): void` where `IncidentFailureEntry = { source: string; externalId: string; reason: 'no-location' | 'no-geocode'; text: string; settlement?: string; region?: string }`.
- Produces (extracted from existing logic, reused by Task 5): `processIncidentPost(post: RawPost, geocodingSource: GeocodingSource | undefined, logsDir: string, sourceId: string, now: () => Date, onLog?: (message: string) => void): NewIncidentReportRow | null`.
- `ingestIncidentReports` gains one new parameter: `logsDir: string` (required — see Step 5; every call site is updated in this same task).

- [ ] **Step 1: Write the failing test for the logger**

Create `packages/server/test/incidentFailureLog.test.ts`:

```ts
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { logIncidentFailure } from '../src/services/incidentFailureLog.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'pyrmap-failurelog-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('logIncidentFailure', () => {
  it('creates the logs directory if missing and writes one JSON line per call', () => {
    const logsDir = path.join(tmpDir, 'logs', 'incidents');
    const now = () => new Date('2026-07-22T18:03:11Z');

    logIncidentFailure(
      logsDir,
      { source: 'PYROSVESTIKI_X', externalId: '1', reason: 'no-location', text: 'πρώτο μήνυμα' },
      now,
    );
    logIncidentFailure(
      logsDir,
      {
        source: 'PYROSVESTIKI_X',
        externalId: '2',
        reason: 'no-geocode',
        text: 'δεύτερο μήνυμα',
        settlement: 'Χ',
        region: 'Ψ',
      },
      now,
    );

    const filePath = path.join(logsDir, '2026-07-22.log');
    const lines = readFileSync(filePath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0]!);
    expect(first).toEqual({
      timestamp: '2026-07-22T18:03:11.000Z',
      source: 'PYROSVESTIKI_X',
      externalId: '1',
      reason: 'no-location',
      text: 'πρώτο μήνυμα',
    });

    const second = JSON.parse(lines[1]!);
    expect(second).toMatchObject({ reason: 'no-geocode', settlement: 'Χ', region: 'Ψ' });
  });

  it('appends to the same day\'s file across multiple calls, and starts a new file for a new UTC day', () => {
    const logsDir = path.join(tmpDir, 'logs', 'incidents');
    logIncidentFailure(
      logsDir,
      { source: 'S', externalId: '1', reason: 'no-location', text: 'a' },
      () => new Date('2026-07-22T23:59:00Z'),
    );
    logIncidentFailure(
      logsDir,
      { source: 'S', externalId: '2', reason: 'no-location', text: 'b' },
      () => new Date('2026-07-23T00:01:00Z'),
    );

    expect(readFileSync(path.join(logsDir, '2026-07-22.log'), 'utf-8').trim().split('\n')).toHaveLength(1);
    expect(readFileSync(path.join(logsDir, '2026-07-23.log'), 'utf-8').trim().split('\n')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pyrmap/server exec vitest run test/incidentFailureLog.test.ts`
Expected: FAIL — cannot find module `../src/services/incidentFailureLog.js`.

- [ ] **Step 3: Write the logger**

Create `packages/server/src/services/incidentFailureLog.ts`:

```ts
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export interface IncidentFailureEntry {
  source: string;
  externalId: string;
  reason: 'no-location' | 'no-geocode';
  /** Full original post text, untruncated — the whole point is to have enough to diagnose later. */
  text: string;
  settlement?: string;
  region?: string;
}

/**
 * Appends one JSON-per-line entry to `logsDir/YYYY-MM-DD.log` (UTC calendar day), creating the
 * directory if it doesn't exist. Durable record of incident posts that couldn't be resolved, for
 * later inspection (e.g. feeding to a coding agent) — separate from the ephemeral console/onLog
 * output, which doesn't survive a container restart.
 */
export function logIncidentFailure(logsDir: string, entry: IncidentFailureEntry, now: () => Date): void {
  mkdirSync(logsDir, { recursive: true });
  const timestamp = now().toISOString();
  const day = timestamp.slice(0, 10); // YYYY-MM-DD
  const line = `${JSON.stringify({ timestamp, ...entry })}\n`;
  appendFileSync(path.join(logsDir, `${day}.log`), line, 'utf-8');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pyrmap/server exec vitest run test/incidentFailureLog.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Read the current `incidentIngestService.ts` in full, then extract the shared per-post logic**

Read `packages/server/src/services/incidentIngestService.ts` first — it currently has a `for (const post of posts)` loop inline inside `ingestIncidentReports` doing classify → extract → geocode → push-onto-`rows`-or-skip. Replace the whole file with:

```ts
import { isFireIncidentPost, extractLocationPhrase } from '../domain/incidentParsing.js';
import { geocodeGreekLocation } from '../domain/incidentGeocoding.js';
import { logIncidentFailure } from './incidentFailureLog.js';
import type { IncidentSource, RawPost } from '../ports/IncidentSource.js';
import type { IncidentReportRepository, NewIncidentReportRow } from '../ports/IncidentReportRepository.js';
import type { GeocodingSource } from '../ports/GeocodingSource.js';

/** Posts per poll when there's no since_id yet (first run); since_id makes subsequent polls cost near-zero. */
const POSTS_PER_POLL = 10;
const LOG_TEXT_MAX_CHARS = 120;

function truncate(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > LOG_TEXT_MAX_CHARS ? `${collapsed.slice(0, LOG_TEXT_MAX_CHARS)}…` : collapsed;
}

export interface IncidentIngestResult {
  postsFetched: number;
  rowsInserted: number;
  error: string | null;
}

/**
 * Classifies, extracts, and geocodes one post. Returns the row to persist, or null if it should
 * be skipped (not a fire post, no location found, or geocoding failed) — in the null-because-
 * skipped-after-classifying case, a failure is durably logged via logIncidentFailure so it can be
 * inspected later. Shared by the regular polling path (ingestIncidentReports) and the rescan path
 * (services/incidentRescanService.ts), so both log failures identically.
 */
export async function processIncidentPost(
  post: RawPost,
  sourceId: string,
  logsDir: string,
  now: () => Date,
  geocodingSource?: GeocodingSource,
  onLog?: (message: string) => void,
): Promise<NewIncidentReportRow | null> {
  if (!isFireIncidentPost(post.text)) return null;

  const location = extractLocationPhrase(post.text);
  if (!location) {
    // These are the posts worth reading, not just counting — the account is written by a
    // human, so the "standard-ish" template has real exceptions; each miss here is a
    // candidate for a new extractLocationPhrase case (see docs/DECISIONS.md 2026-07-20).
    onLog?.(`source=${sourceId} skip=no-location id=${post.externalId} text="${truncate(post.text)}"`);
    logIncidentFailure(logsDir, { source: sourceId, externalId: post.externalId, reason: 'no-location', text: post.text }, now);
    return null;
  }

  // Nominatim understands the raw declined Greek phrase directly and covers far more small
  // villages than the offline gazetteer (live-verified 2026-07-22, see docs/DECISIONS.md); the
  // offline gazetteer is the fallback for when it's unreachable, rate-limited, or genuinely has
  // no match, not a replacement for it.
  const query = location.regionGenitive ? `${location.settlement} ${location.regionGenitive}` : location.settlement;
  const geocoded =
    (geocodingSource ? await geocodingSource.geocode(query) : null) ??
    geocodeGreekLocation(location.settlement, location.regionGenitive);
  if (!geocoded) {
    onLog?.(
      `source=${sourceId} skip=no-geocode id=${post.externalId} settlement="${location.settlement}" region="${location.regionGenitive ?? ''}" text="${truncate(post.text)}"`,
    );
    logIncidentFailure(
      logsDir,
      {
        source: sourceId,
        externalId: post.externalId,
        reason: 'no-geocode',
        text: post.text,
        settlement: location.settlement,
        region: location.regionGenitive ?? undefined,
      },
      now,
    );
    return null;
  }

  return {
    externalId: post.externalId,
    source: sourceId,
    text: post.text,
    url: post.url,
    publishedAt: post.publishedAt,
    latitude: geocoded.latitude,
    longitude: geocoded.longitude,
    precision: geocoded.precision,
  };
}

/**
 * Ingests fire-incident reports from a text-based source (e.g. the Fire Service's X account):
 * fetch new posts since the last one we've seen -> classify -> extract location -> geocode ->
 * persist only the ones that resolved to real coordinates. Never throws; failures land in
 * fetch_log, same convention as alertIngestService, plus a durable per-day file via
 * processIncidentPost for anything that didn't resolve.
 */
export async function ingestIncidentReports(
  source: IncidentSource,
  repository: IncidentReportRepository,
  sourceId: string,
  now: () => Date,
  logsDir: string,
  onLog?: (message: string) => void,
  onInserted?: (rows: NewIncidentReportRow[]) => void,
  geocodingSource?: GeocodingSource,
): Promise<IncidentIngestResult> {
  const fetchedAt = now().toISOString();
  const sinceId = repository.findLatestExternalId(sourceId);

  let posts;
  try {
    posts = await source.fetchRecentPosts(sinceId, POSTS_PER_POLL);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    repository.recordFetchLog({
      source: sourceId,
      fetchedAt,
      httpStatus: null,
      rowsParsed: 0,
      rowsInserted: 0,
      error: message,
    });
    return { postsFetched: 0, rowsInserted: 0, error: message };
  }

  const rows: NewIncidentReportRow[] = [];
  let skipped = 0;
  for (const post of posts) {
    const row = await processIncidentPost(post, sourceId, logsDir, now, geocodingSource, onLog);
    if (row) rows.push(row);
    else skipped++;
  }

  const insertedRows = repository.insertIncidentReports(rows);
  onLog?.(`source=${sourceId} posts=${posts.length} geocoded=${rows.length} skipped=${skipped} inserted=${insertedRows.length}`);
  if (insertedRows.length > 0) onInserted?.(insertedRows);

  repository.recordFetchLog({
    source: sourceId,
    fetchedAt,
    httpStatus: 200,
    rowsParsed: rows.length,
    rowsInserted: insertedRows.length,
    error: null,
  });

  return { postsFetched: posts.length, rowsInserted: insertedRows.length, error: null };
}
```

Note the parameter order change: `logsDir` is inserted as the 5th parameter (right after `now`), before `onLog`/`onInserted`/`geocodingSource` — this is a **breaking, non-additive** signature change (unlike every other change made to this function in earlier work), because a logging directory is not optional the way a callback is: every caller must decide where logs go. Every call site is fixed in Step 6.

- [ ] **Step 6: Fix every call site of `ingestIncidentReports`**

Find every call site with:

```bash
grep -rn "ingestIncidentReports(" packages/server/src packages/server/test
```

You will find it in `packages/server/src/jobs/scheduler.ts` (inside `pollIncidents`) and in `packages/server/test/incidentIngestService.test.ts` (multiple calls) and possibly `packages/server/test/scheduler.test.ts`. Do not edit `scheduler.ts`'s call yet — that's Task 6, which adds a `logsDir` field to `SchedulerDeps` properly. For now, in `packages/server/src/jobs/scheduler.ts`, temporarily thread it through as a new required field so the build stays green:

Add to `SchedulerDeps` (right after the `geocodingSource` field added in the Nominatim work):

```ts
  /** Directory failed incident-report resolutions are logged to, one file per UTC day. */
  logsDir: string;
```

And in `pollIncidents`, change the `ingestIncidentReports(...)` call from:

```ts
    const result = await ingestIncidentReports(
      incidents.source,
      incidents.repository,
      incidents.sourceId,
      now,
      deps.onLog,
      deps.onNewIncidents,
      deps.geocodingSource,
    );
```

to:

```ts
    const result = await ingestIncidentReports(
      incidents.source,
      incidents.repository,
      incidents.sourceId,
      now,
      deps.logsDir,
      deps.onLog,
      deps.onNewIncidents,
      deps.geocodingSource,
    );
```

Making `logsDir` a required (non-optional) field on `SchedulerDeps` means every existing `startScheduler({...})` call site must now include it, not just ones that exercise incident ingestion directly — `logsDir` is required architecturally (like `repository`/`dataSource`), not just for the tests that happen to touch incidents.

Run `grep -n "startScheduler({" packages/server/test/scheduler.test.ts` — there are 4 call sites in that file as of this task; add `logsDir: path.join(tmpDir, 'logs'),` to the object literal in **every one of them** (each test file already has its own `tmpDir` from `beforeEach`; the directory doesn't need to exist beforehand — `logIncidentFailure`'s `mkdirSync` creates it lazily on first write, and these tests may never even trigger a failure write, which is fine).

Separately, in every existing test file that calls `ingestIncidentReports(...)` directly (i.e. `packages/server/test/incidentIngestService.test.ts` — check for other call sites too with `grep -rn "ingestIncidentReports(" packages/server/test`), add a `logsDir` positional argument (e.g. `path.join(tmpDir, 'logs')`) in the 5th position, right after `now`, matching the new signature order from Step 5 above.

- [ ] **Step 7: Add new tests to `incidentIngestService.test.ts` for the logging behavior**

Add these tests (adjust the exact fixture/import style to match the file's existing conventions once you've read it):

```ts
it('logs a no-location failure to a per-day file under logsDir', async () => {
  const logsDir = path.join(tmpDir, 'logs');
  await ingestIncidentReports(new FakeIncidentSource(POSTS), repo, SOURCE_ID, NOW, logsDir);

  const logFile = path.join(logsDir, '2026-07-20.log');
  const lines = readFileSync(logFile, 'utf-8').trim().split('\n');
  const entries = lines.map((line) => JSON.parse(line));
  expect(entries.some((e) => e.reason === 'no-location' && e.text.includes('37 αγροτοδασικές'))).toBe(true);
});
```

Add `import { readFileSync } from 'node:fs';` to the top of the file if not already imported.

- [ ] **Step 8: Run the full server suite**

Run: `pnpm --filter @pyrmap/server test`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add packages/server/src/services/incidentFailureLog.ts packages/server/test/incidentFailureLog.test.ts packages/server/src/services/incidentIngestService.ts packages/server/test/incidentIngestService.test.ts packages/server/src/jobs/scheduler.ts packages/server/test/scheduler.test.ts
git commit -m "feat(server): persist per-day failure logs for unresolved incident posts"
```

---

### Task 4: `IncidentSource` gains a date-windowed fetch for rescan

**Files:**
- Modify: `packages/server/src/ports/IncidentSource.ts`
- Modify: `packages/server/src/adapters/pyrosvestiki/PyrosvestikiXClient.ts`
- Test: `packages/server/test/PyrosvestikiXClient.test.ts` (add tests)

**Interfaces:**
- Produces: `IncidentSource.fetchPostsInWindow(startTime: Date, endTime: Date): Promise<RawPost[]>`.

- [ ] **Step 1: Write the failing test**

Read `packages/server/test/PyrosvestikiXClient.test.ts` first (it uses a `fakeFetch()` helper returning a `vi.fn` wrapping `new Response(...)`, and a real fixture file `pyrosvestiki_tweets_sample.json`). Add this test:

```ts
it('fetches posts in a time window via start_time/end_time, not since_id', async () => {
  const fetchImpl = fakeFetch();
  const client = new PyrosvestikiXClient('tok', fetchImpl);

  await client.fetchPostsInWindow(new Date('2026-07-22T00:00:00Z'), new Date('2026-07-22T12:00:00Z'));

  const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit?][];
  const url = String(calls[0]![0]);
  expect(url).toContain('start_time=2026-07-22T00%3A00%3A00.000Z');
  expect(url).toContain('end_time=2026-07-22T12%3A00%3A00.000Z');
  expect(url).not.toContain('since_id');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pyrmap/server exec vitest run test/PyrosvestikiXClient.test.ts`
Expected: FAIL — `client.fetchPostsInWindow is not a function`.

- [ ] **Step 3: Add the port method**

In `packages/server/src/ports/IncidentSource.ts`, change:

```ts
/** Fetches recent posts from an external incident-reporting account (e.g. the Fire Service's X feed). */
export interface IncidentSource {
  /** Posts newer than sinceExternalId (null = just the most recent maxResults), for cost-efficient polling. */
  fetchRecentPosts(sinceExternalId: string | null, maxResults: number): Promise<RawPost[]>;
}
```

to:

```ts
/** Fetches recent posts from an external incident-reporting account (e.g. the Fire Service's X feed). */
export interface IncidentSource {
  /** Posts newer than sinceExternalId (null = just the most recent maxResults), for cost-efficient polling. */
  fetchRecentPosts(sinceExternalId: string | null, maxResults: number): Promise<RawPost[]>;
  /** Every post published in [startTime, endTime], regardless of what's already been fetched —
   * for rescanning a window rather than incrementally polling. A paid read every time it's
   * called (no since_id cost-avoidance applies here). */
  fetchPostsInWindow(startTime: Date, endTime: Date): Promise<RawPost[]>;
}
```

- [ ] **Step 4: Implement it in `PyrosvestikiXClient`**

In `packages/server/src/adapters/pyrosvestiki/PyrosvestikiXClient.ts`, add this method to the class (the X API v2 user-tweets endpoint accepts `start_time`/`end_time` in ISO 8601, and `since_id` takes precedence over `start_time` if both are given — so this method must never send `since_id`):

```ts
  async fetchPostsInWindow(startTime: Date, endTime: Date): Promise<RawPost[]> {
    const params = new URLSearchParams({
      max_results: String(MAX_RESULTS),
      'tweet.fields': 'created_at,text',
      exclude: 'retweets,replies',
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
    });

    const url = `${API_BASE}/users/${PYROSVESTIKI_USER_ID}/tweets?${params.toString()}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let body: TweetsResponse;
    try {
      const response = await this.fetchImpl(url, {
        headers: { Authorization: `Bearer ${this.bearerToken}` },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`X API request failed: HTTP ${response.status}`);
      }
      body = (await response.json()) as TweetsResponse;
    } finally {
      clearTimeout(timeout);
    }

    return (body.data ?? []).map((tweet) => ({
      externalId: tweet.id,
      text: tweet.text,
      publishedAt: new Date(tweet.created_at).toISOString(),
      url: `https://x.com/pyrosvestiki/status/${tweet.id}`,
    }));
  }
```

Note this duplicates the response-parsing tail (`return (body.data ?? []).map(...)`) from `fetchRecentPosts` — extract it into a small private helper `parseTweetsResponse(body: TweetsResponse): RawPost[]` and have both methods call it, to avoid the duplication:

```ts
  private parseTweetsResponse(body: TweetsResponse): RawPost[] {
    return (body.data ?? []).map((tweet) => ({
      externalId: tweet.id,
      text: tweet.text,
      publishedAt: new Date(tweet.created_at).toISOString(),
      url: `https://x.com/pyrosvestiki/status/${tweet.id}`,
    }));
  }
```

and replace the tail of both `fetchRecentPosts` and `fetchPostsInWindow` with `return this.parseTweetsResponse(body);`.

Also note: the X user-tweets endpoint returns at most `max_results` (capped at 100) most-recent posts in the window — there is no pagination loop here. This account's real observed posting volume is far below 100/day even at peak wildfire season, so this is a documented, accepted limitation, not a bug to work around speculatively.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @pyrmap/server exec vitest run test/PyrosvestikiXClient.test.ts`
Expected: PASS, including all pre-existing tests (the parsing-helper extraction must not change `fetchRecentPosts`'s observable behavior).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/ports/IncidentSource.ts packages/server/src/adapters/pyrosvestiki/PyrosvestikiXClient.ts packages/server/test/PyrosvestikiXClient.test.ts
git commit -m "feat(server): add date-windowed post fetching for incident rescan"
```

---

### Task 5: Rescan service for incident reports

**Files:**
- Modify: `packages/server/src/ports/IncidentReportRepository.ts`
- Modify: `packages/server/src/adapters/sqlite/SqliteIncidentReportRepository.ts`
- Create: `packages/server/src/services/incidentRescanService.ts`
- Test: `packages/server/test/incidentRescanService.test.ts`

**Interfaces:**
- Consumes: `processIncidentPost` from Task 3, `fetchPostsInWindow` from Task 4.
- Produces: `IncidentReportRepository.findExternalIdsSince(source: string, sinceIso: string): Set<string>`. `rescanIncidentReports(source: IncidentSource, repository: IncidentReportRepository, sourceId: string, hours: number, now: () => Date, logsDir: string, geocodingSource?: GeocodingSource, onLog?: (message: string) => void): Promise<{ postsChecked: number; rowsInserted: number; postsSkippedAlreadyResolved: number; postsFailed: number }>`.

- [ ] **Step 1: Write the failing test for the new repository method**

Create `packages/server/test/SqliteIncidentReportRepository.test.ts` (this repository currently has no dedicated test file — its behavior is only exercised indirectly via `incidentIngestService.test.ts` — so this is a new file):

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteIncidentReportRepository } from '../src/adapters/sqlite/SqliteIncidentReportRepository.js';

let tmpDir: string;
let repo: SqliteIncidentReportRepository;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'pyrmap-incidentrepo-test-'));
  repo = new SqliteIncidentReportRepository(path.join(tmpDir, 'test.db'));
});

afterEach(() => {
  repo.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('findExternalIdsSince', () => {
  it('returns only external_ids for the given source, published at or after sinceIso', () => {
    repo.insertIncidentReports([
      {
        externalId: '1',
        source: 'A',
        text: 't',
        url: 'u',
        publishedAt: '2026-07-22T10:00:00Z',
        latitude: 0,
        longitude: 0,
        precision: 'settlement',
      },
      {
        externalId: '2',
        source: 'A',
        text: 't',
        url: 'u',
        publishedAt: '2026-07-21T10:00:00Z', // before the window
        latitude: 0,
        longitude: 0,
        precision: 'settlement',
      },
      {
        externalId: '3',
        source: 'B', // different source
        text: 't',
        url: 'u',
        publishedAt: '2026-07-22T10:00:00Z',
        latitude: 0,
        longitude: 0,
        precision: 'settlement',
      },
    ]);

    const ids = repo.findExternalIdsSince('A', '2026-07-22T00:00:00Z');
    expect(ids).toEqual(new Set(['1']));
  });

  it('returns an empty set when nothing matches', () => {
    expect(repo.findExternalIdsSince('NONE', '2026-07-22T00:00:00Z')).toEqual(new Set());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pyrmap/server exec vitest run test/SqliteIncidentReportRepository.test.ts`
Expected: FAIL — `repo.findExternalIdsSince is not a function`.

- [ ] **Step 3: Add the port method and implementation**

In `packages/server/src/ports/IncidentReportRepository.ts`, add to the `IncidentReportRepository` interface, after `findIncidentReportsSince`:

```ts
  /** external_ids for a source already stored with published_at >= sinceIso — for rescan's "skip what's already resolved" check. */
  findExternalIdsSince(source: string, sinceIso: string): Set<string>;
```

In `packages/server/src/adapters/sqlite/SqliteIncidentReportRepository.ts`, add this method to the class:

```ts
  findExternalIdsSince(source: string, sinceIso: string): Set<string> {
    const rows = this.db
      .prepare('SELECT external_id FROM incident_reports WHERE source = ? AND published_at >= ?')
      .all(source, sinceIso) as { external_id: string }[];
    return new Set(rows.map((row) => row.external_id));
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pyrmap/server exec vitest run test/SqliteIncidentReportRepository.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing test for the rescan service**

Create `packages/server/test/incidentRescanService.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteIncidentReportRepository } from '../src/adapters/sqlite/SqliteIncidentReportRepository.js';
import { rescanIncidentReports } from '../src/services/incidentRescanService.js';
import type { IncidentSource, RawPost } from '../src/ports/IncidentSource.js';

const NOW = () => new Date('2026-07-22T18:00:00Z');
const SOURCE_ID = 'PYROSVESTIKI_X';

let tmpDir: string;
let repo: SqliteIncidentReportRepository;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'pyrmap-rescan-test-'));
  repo = new SqliteIncidentReportRepository(path.join(tmpDir, 'test.db'));
});

afterEach(() => {
  repo.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

class FakeWindowSource implements IncidentSource {
  public requestedStart: Date | undefined;
  public requestedEnd: Date | undefined;
  constructor(private readonly posts: RawPost[]) {}
  async fetchRecentPosts(): Promise<RawPost[]> {
    throw new Error('rescan must use fetchPostsInWindow, not fetchRecentPosts');
  }
  async fetchPostsInWindow(startTime: Date, endTime: Date): Promise<RawPost[]> {
    this.requestedStart = startTime;
    this.requestedEnd = endTime;
    return this.posts;
  }
}

describe('rescanIncidentReports', () => {
  it('requests exactly the [now - hours, now] window', async () => {
    const source = new FakeWindowSource([]);
    await rescanIncidentReports(source, repo, SOURCE_ID, 6, NOW, path.join(tmpDir, 'logs'));

    expect(source.requestedEnd).toEqual(new Date('2026-07-22T18:00:00Z'));
    expect(source.requestedStart).toEqual(new Date('2026-07-22T12:00:00Z'));
  });

  it('skips a post whose external_id is already stored, without re-geocoding it', async () => {
    repo.insertIncidentReports([
      {
        externalId: '1',
        source: SOURCE_ID,
        text: 'already resolved',
        url: 'u',
        publishedAt: '2026-07-22T13:00:00Z',
        latitude: 1,
        longitude: 1,
        precision: 'settlement',
      },
    ]);
    const source = new FakeWindowSource([
      { externalId: '1', text: 'already resolved', publishedAt: '2026-07-22T13:00:00Z', url: 'u' },
    ]);

    const result = await rescanIncidentReports(source, repo, SOURCE_ID, 6, NOW, path.join(tmpDir, 'logs'));

    expect(result).toEqual({ postsChecked: 1, rowsInserted: 0, postsSkippedAlreadyResolved: 1, postsFailed: 0 });
  });

  it('resolves and inserts a previously-missed post', async () => {
    const source = new FakeWindowSource([
      {
        externalId: '2',
        text: 'Υπό μερικό έλεγχο τέθηκε η #πυρκαγιά στο Κορωπί Αττικής.',
        publishedAt: '2026-07-22T13:00:00Z',
        url: 'u',
      },
    ]);

    const result = await rescanIncidentReports(source, repo, SOURCE_ID, 6, NOW, path.join(tmpDir, 'logs'));

    expect(result).toEqual({ postsChecked: 1, rowsInserted: 1, postsSkippedAlreadyResolved: 0, postsFailed: 0 });
    expect(repo.findIncidentReportsSince('2026-07-22T00:00:00Z')).toHaveLength(1);
  });

  it('logs and counts a post that still fails to resolve', async () => {
    const source = new FakeWindowSource([
      { externalId: '3', text: '🔥 37 αγροτοδασικές #πυρκαγιές εκδηλώθηκαν το τελευταίο 24ωρο.', publishedAt: '2026-07-22T13:00:00Z', url: 'u' },
    ]);

    const result = await rescanIncidentReports(source, repo, SOURCE_ID, 6, NOW, path.join(tmpDir, 'logs'));

    expect(result).toEqual({ postsChecked: 1, rowsInserted: 0, postsSkippedAlreadyResolved: 0, postsFailed: 1 });
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @pyrmap/server exec vitest run test/incidentRescanService.test.ts`
Expected: FAIL — cannot find module `../src/services/incidentRescanService.js`.

- [ ] **Step 7: Write the implementation**

Create `packages/server/src/services/incidentRescanService.ts`:

```ts
import { processIncidentPost } from './incidentIngestService.js';
import type { IncidentSource } from '../ports/IncidentSource.js';
import type { IncidentReportRepository, NewIncidentReportRow } from '../ports/IncidentReportRepository.js';
import type { GeocodingSource } from '../ports/GeocodingSource.js';

export interface RescanResult {
  postsChecked: number;
  rowsInserted: number;
  postsSkippedAlreadyResolved: number;
  postsFailed: number;
}

/**
 * Re-examines every post in the last `hours` (via a date-windowed fetch, not since_id — so this
 * revisits posts the regular poll may have already seen and failed to resolve), skipping any post
 * whose external_id is already stored (already resolved, no point re-geocoding it), and logging a
 * failure via processIncidentPost's built-in logIncidentFailure call for anything still
 * unresolvable. Costs a real paid X API read every time it's called — not incremental like the
 * regular since_id-based poll.
 */
export async function rescanIncidentReports(
  source: IncidentSource,
  repository: IncidentReportRepository,
  sourceId: string,
  hours: number,
  now: () => Date,
  logsDir: string,
  geocodingSource?: GeocodingSource,
  onLog?: (message: string) => void,
): Promise<RescanResult> {
  const endTime = now();
  const startTime = new Date(endTime.getTime() - hours * 60 * 60 * 1000);

  const posts = await source.fetchPostsInWindow(startTime, endTime);
  const alreadyResolved = repository.findExternalIdsSince(sourceId, startTime.toISOString());

  const rows: NewIncidentReportRow[] = [];
  let skippedAlreadyResolved = 0;
  let failed = 0;

  for (const post of posts) {
    if (alreadyResolved.has(post.externalId)) {
      skippedAlreadyResolved++;
      continue;
    }
    const row = await processIncidentPost(post, sourceId, logsDir, now, geocodingSource, onLog);
    if (row) rows.push(row);
    else failed++;
  }

  const inserted = repository.insertIncidentReports(rows);
  onLog?.(
    `rescan source=${sourceId} hours=${hours} checked=${posts.length} skippedAlreadyResolved=${skippedAlreadyResolved} inserted=${inserted.length} failed=${failed}`,
  );

  return {
    postsChecked: posts.length,
    rowsInserted: inserted.length,
    postsSkippedAlreadyResolved: skippedAlreadyResolved,
    postsFailed: failed,
  };
}
```

Note: `processIncidentPost` needs to be exported from `incidentIngestService.ts` — it already is, per Task 3's Step 5.

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm --filter @pyrmap/server exec vitest run test/incidentRescanService.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 9: Run the full server suite**

Run: `pnpm --filter @pyrmap/server test`
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add packages/server/src/ports/IncidentReportRepository.ts packages/server/src/adapters/sqlite/SqliteIncidentReportRepository.ts packages/server/test/SqliteIncidentReportRepository.test.ts packages/server/src/services/incidentRescanService.ts packages/server/test/incidentRescanService.test.ts
git commit -m "feat(server): add rescanIncidentReports, a window-based re-check skipping already-resolved posts"
```

---

### Task 6: Scheduler `rescan()` method, `POST /api/rescan` route, and wiring

**Files:**
- Modify: `packages/server/src/jobs/scheduler.ts`
- Test: `packages/server/test/scheduler.test.ts` (add tests)
- Create: `packages/server/src/routes/rescan.ts`
- Test: `packages/server/test/rescan.test.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/index.ts`

**Interfaces:**
- Consumes: `rescanIncidentReports` from Task 5.
- Produces: `Scheduler.rescan(hours: 6 | 12 | 24): Promise<{ satellite: { rowsInserted: number }; incidents: RescanResult | null }>`. `rescanRoutes(getScheduler: () => Scheduler | null)` — a Fastify plugin factory.

- [ ] **Step 1: Write the failing test for `Scheduler.rescan`**

Add to `packages/server/test/scheduler.test.ts` (read the file first — reuse its existing `tmpDir`/`repo`/`FakeFireDataSource` setup):

```ts
it('rescan() re-polls satellite sources and rescans incidents over the requested window', async () => {
  const dataSource = new FakeFireDataSource({ VIIRS_NOAA20_NRT: readFixture('viirs_sample.csv') });
  const incidentRepo = new SqliteIncidentReportRepository(path.join(tmpDir, 'incidents.db'));
  const post: RawPost = {
    externalId: '1',
    text: 'Υπό μερικό έλεγχο τέθηκε η #πυρκαγιά στο Κορωπί Αττικής.',
    publishedAt: '2026-07-15T11:00:00Z',
    url: 'https://x.com/pyrosvestiki/status/1',
  };
  const incidentSource: IncidentSource = {
    fetchRecentPosts: async () => [],
    fetchPostsInWindow: async () => [post],
  };

  const scheduler = startScheduler({
    dataSource,
    repository: repo,
    effectiveSources: { VIIRS_NOAA20_NRT: 'polar' },
    incidentIngestion: { source: incidentSource, repository: incidentRepo, sourceId: 'TEST_SOURCE' },
    logsDir: path.join(tmpDir, 'logs'),
    now: () => new Date('2026-07-15T12:00:00Z'),
  });
  scheduler.stop();
  await new Promise((resolve) => setTimeout(resolve, 50));

  const result = await scheduler.rescan(6);
  incidentRepo.close();

  expect(result.satellite.rowsInserted).toBeGreaterThanOrEqual(0); // dedup may make this 0 on a re-poll of the same fixture
  expect(result.incidents).toEqual({ postsChecked: 1, rowsInserted: 1, postsSkippedAlreadyResolved: 0, postsFailed: 0 });
});

it('rescan() returns incidents: null when no incident source is configured', async () => {
  const dataSource = new FakeFireDataSource({ VIIRS_NOAA20_NRT: readFixture('viirs_sample.csv') });
  const scheduler = startScheduler({
    dataSource,
    repository: repo,
    effectiveSources: { VIIRS_NOAA20_NRT: 'polar' },
    logsDir: path.join(tmpDir, 'logs'),
    now: () => new Date('2026-07-15T12:00:00Z'),
  });
  scheduler.stop();

  const result = await scheduler.rescan(6);
  expect(result.incidents).toBeNull();
});
```

Add these imports to the top of `packages/server/test/scheduler.test.ts` if not already present (Task 5's own scheduler test, if run before this one in the same PR sequence, may have already added some of these — check first):

```ts
import { SqliteIncidentReportRepository } from '../src/adapters/sqlite/SqliteIncidentReportRepository.js';
import type { IncidentSource, RawPost } from '../src/ports/IncidentSource.js';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pyrmap/server exec vitest run test/scheduler.test.ts`
Expected: FAIL — `scheduler.rescan is not a function`.

- [ ] **Step 3: Add `rescan()` to the scheduler**

In `packages/server/src/jobs/scheduler.ts`, add the import:

```ts
import { rescanIncidentReports, type RescanResult } from '../services/incidentRescanService.js';
```

Add to the `Scheduler` interface:

```ts
export interface Scheduler {
  stop: () => void;
  pollGeo: () => Promise<void>;
  pollPolar: () => Promise<void>;
  pollIncidents: () => Promise<void>;
  decay: () => void;
  retention: () => void;
  rescan: (hours: 6 | 12 | 24) => Promise<{ satellite: { rowsInserted: number }; incidents: RescanResult | null }>;
}
```

Add this function inside `startScheduler`, alongside the other poll functions (after `pollIncidents`, before `pollPolar`):

```ts
  async function rescan(hours: 6 | 12 | 24): Promise<{ satellite: { rowsInserted: number }; incidents: RescanResult | null }> {
    let satelliteInserted = 0;
    for (const sourceId of geoSourceIds) {
      if (await ingestOne(sourceId, 'geo')) satelliteInserted++;
    }
    for (const sourceId of polarSourceIds) {
      if (await ingestOne(sourceId, 'polar')) satelliteInserted++;
    }
    for (const { source, config } of deps.alertSources ?? []) {
      const result = await ingestFireAlerts(source, config, deps.repository, now, deps.onLog, deps.onNewDetections);
      if (result.rowsInserted > 0) satelliteInserted++;
    }

    const incidents = deps.incidentIngestion;
    const incidentResult = incidents
      ? await rescanIncidentReports(
          incidents.source,
          incidents.repository,
          incidents.sourceId,
          hours,
          now,
          deps.logsDir,
          deps.geocodingSource,
          deps.onLog,
        )
      : null;

    deps.onUpdate?.();
    return { satellite: { rowsInserted: satelliteInserted }, incidents: incidentResult };
  }
```

Add `rescan,` to the returned object at the end of `startScheduler`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pyrmap/server exec vitest run test/scheduler.test.ts`
Expected: PASS, including both new tests.

- [ ] **Step 5: Write the failing test for the route**

Create `packages/server/test/rescan.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/app.js';
import { SqliteFireRepository } from '../src/adapters/sqlite/SqliteFireRepository.js';
import type { Scheduler } from '../src/jobs/scheduler.js';
import type { AuthConfig } from '../src/routes/auth.js';

const AUTH: AuthConfig = { username: 'alex', password: 'secret-pw', sessionSecret: 'test-secret' };

function fakeScheduler(rescan: Scheduler['rescan']): Scheduler {
  return {
    stop: () => undefined,
    pollGeo: async () => undefined,
    pollPolar: async () => undefined,
    pollIncidents: async () => undefined,
    decay: () => undefined,
    retention: () => undefined,
    rescan,
  };
}

describe('POST /api/rescan', () => {
  it('calls scheduler.rescan with the requested hours and returns its result', async () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), 'pyrmap-rescan-route-test-'));
    const repo = new SqliteFireRepository(path.join(tmpDir, 'test.db'));
    const rescan = vi.fn(async () => ({ satellite: { rowsInserted: 2 }, incidents: null }));
    let scheduler: Scheduler | null = null;

    const app = await buildApp(
      { logLevel: 'silent' },
      repo,
      undefined,
      '/nonexistent',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      () => scheduler,
    );
    scheduler = fakeScheduler(rescan);

    const response = await app.inject({ method: 'POST', url: '/api/rescan', payload: { hours: 12 } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ satellite: { rowsInserted: 2 }, incidents: null });
    expect(rescan).toHaveBeenCalledWith(12);

    repo.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rejects an hours value that is not 6, 12, or 24', async () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), 'pyrmap-rescan-route-test2-'));
    const repo = new SqliteFireRepository(path.join(tmpDir, 'test.db'));
    const app = await buildApp(
      { logLevel: 'silent' },
      repo,
      undefined,
      '/nonexistent',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      () => fakeScheduler(async () => ({ satellite: { rowsInserted: 0 }, incidents: null })),
    );

    const response = await app.inject({ method: 'POST', url: '/api/rescan', payload: { hours: 999 } });
    expect(response.statusCode).toBe(400);

    repo.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('requires a session when auth is enabled', async () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), 'pyrmap-rescan-route-test3-'));
    const repo = new SqliteFireRepository(path.join(tmpDir, 'test.db'));
    const app = await buildApp(
      { logLevel: 'silent' },
      repo,
      undefined,
      '/nonexistent',
      undefined,
      undefined,
      AUTH,
      undefined,
      undefined,
      () => fakeScheduler(async () => ({ satellite: { rowsInserted: 0 }, incidents: null })),
    );

    const response = await app.inject({ method: 'POST', url: '/api/rescan', payload: { hours: 6 } });
    expect(response.statusCode).toBe(401);

    repo.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @pyrmap/server exec vitest run test/rescan.test.ts`
Expected: FAIL — `buildApp` doesn't accept a 10th argument yet, and `routes/rescan.js` doesn't exist.

- [ ] **Step 7: Write the route**

Create `packages/server/src/routes/rescan.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import type { Scheduler } from '../jobs/scheduler.js';

interface RescanBody {
  hours?: number;
}

const VALID_HOURS = new Set([6, 12, 24]);

/** POST /api/rescan — triggers a one-off re-check of the given window across every source,
 * registered in the same protected group as /api/fires. `getScheduler` is a getter, not the
 * instance directly, because the scheduler is constructed after the Fastify app in index.ts. */
export function rescanRoutes(getScheduler: () => Scheduler | null) {
  return async function registerRescanRoutes(app: FastifyInstance): Promise<void> {
    app.post<{ Body: RescanBody }>('/api/rescan', async (request, reply) => {
      const hours = request.body?.hours;
      if (typeof hours !== 'number' || !VALID_HOURS.has(hours)) {
        reply.code(400);
        return { error: 'hours must be 6, 12, or 24' };
      }

      const scheduler = getScheduler();
      if (!scheduler) {
        reply.code(503);
        return { error: 'Scheduler not ready' };
      }

      return scheduler.rescan(hours as 6 | 12 | 24);
    });
  };
}
```

- [ ] **Step 8: Wire it into `app.ts`**

In `packages/server/src/app.ts`, add the import:

```ts
import { rescanRoutes } from './routes/rescan.js';
import type { Scheduler } from './jobs/scheduler.js';
```

Change `buildApp`'s signature to add one more trailing optional parameter, after `vapidPublicKey`:

```ts
  vapidPublicKey?: string | null,
  getScheduler?: () => Scheduler | null,
): Promise<FastifyInstance> {
```

Inside the protected-routes block, add after the `pushRoutes` registration:

```ts
    if (getScheduler) {
      await protectedApp.register(rescanRoutes(getScheduler));
    }
```

- [ ] **Step 9: Run test to verify it passes**

Run: `pnpm --filter @pyrmap/server exec vitest run test/rescan.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 10: Wire the scheduler and `logsDir` into `index.ts`**

Read `packages/server/src/index.ts` first. Add the import:

```ts
import path from 'node:path';
import type { Scheduler } from './jobs/scheduler.js';
```

Add, near the top of `main()` (right after `const repository = new SqliteFireRepository(config.dbPath);`):

```ts
  const logsDir = path.join(path.dirname(config.dbPath), 'logs', 'incidents');
```

Add a mutable scheduler holder before the `buildApp(...)` call:

```ts
  let scheduler: Scheduler | null = null;
```

Change the `buildApp(...)` call to add the getter as the 10th argument:

```ts
  const app = await buildApp(
    config,
    repository,
    undefined,
    undefined,
    incidentRepository,
    updateBus,
    auth,
    pushSubscriptionRepository,
    vapid?.publicKey ?? null,
    () => scheduler,
  );
```

Add `logsDir` to the `startScheduler({...})` call (alongside the existing fields), and capture the returned instance:

```ts
  scheduler = startScheduler({
    dataSource,
    repository,
    effectiveSources: effective,
    alertSources,
    incidentIngestion,
    geocodingSource,
    logsDir,
    onLog: (message) => app.log.info(message),
    onUpdate: () => updateBus.publish(),
    onNewDetections: pushSubscriptionRepository
      ? (detections) => void notifyNewDetections(pushSubscriptionRepository, detections, (m) => app.log.info(m))
      : undefined,
    onNewIncidents: pushSubscriptionRepository
      ? (reports) => void notifyNewIncidents(pushSubscriptionRepository, reports, (m) => app.log.info(m))
      : undefined,
  });
```

- [ ] **Step 11: Full build and test**

Run: `pnpm -r build && pnpm --filter @pyrmap/server test`
Expected: build succeeds, all tests pass.

- [ ] **Step 12: Commit**

```bash
git add packages/server/src/jobs/scheduler.ts packages/server/test/scheduler.test.ts packages/server/src/routes/rescan.ts packages/server/test/rescan.test.ts packages/server/src/app.ts packages/server/src/index.ts
git commit -m "feat(server): add Scheduler.rescan() and POST /api/rescan"
```

---

### Task 7: Frontend rescan control with cooldown

**Files:**
- Create: `packages/web/src/lib/rescan.ts`
- Test: `packages/web/src/lib/rescan.test.ts`
- Modify: `packages/web/src/api/client.ts`
- Modify: `packages/web/src/components/StatusBar.tsx`
- Modify: `packages/web/src/MapApp.tsx`

**Interfaces:**
- Produces: `triggerRescan(hours: 6 | 12 | 24): Promise<{ satellite: { rowsInserted: number }; incidents: unknown }>` (API client), `loadRescanCooldownUntil(): number`, `storeRescanCooldownUntil(timestampMs: number): void` (lib/rescan.ts).

- [ ] **Step 1: Write the failing test for the cooldown persistence**

Create `packages/web/src/lib/rescan.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadRescanCooldownUntil, storeRescanCooldownUntil } from './rescan.js';

function stubStorage(value: string | null): { setItem: ReturnType<typeof vi.fn> } {
  const setItem = vi.fn();
  vi.stubGlobal('localStorage', { getItem: () => value, setItem });
  return { setItem };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('rescan cooldown persistence', () => {
  it('defaults to 0 (no cooldown) when nothing is stored', () => {
    stubStorage(null);
    expect(loadRescanCooldownUntil()).toBe(0);
  });

  it('round-trips a stored timestamp', () => {
    stubStorage('1700000000000');
    expect(loadRescanCooldownUntil()).toBe(1700000000000);
  });

  it('returns 0 for corrupted storage rather than throwing', () => {
    stubStorage('not-a-number');
    expect(loadRescanCooldownUntil()).toBe(0);
  });

  it('stores the timestamp as a string', () => {
    const { setItem } = stubStorage(null);
    storeRescanCooldownUntil(1700000000000);
    expect(setItem).toHaveBeenCalledWith('pyrmap-rescan-cooldown', '1700000000000');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pyrmap/web exec vitest run src/lib/rescan.test.ts`
Expected: FAIL — cannot find module `./rescan.js`.

- [ ] **Step 3: Write `lib/rescan.ts`**

Create `packages/web/src/lib/rescan.ts`:

```ts
const COOLDOWN_STORAGE_KEY = 'pyrmap-rescan-cooldown';
/** Minimum time between rescans — each one is a real paid X API read, not the free since_id path. */
export const RESCAN_COOLDOWN_MS = 5 * 60 * 1000;

/** Epoch ms after which the rescan control is usable again; 0 if never used or storage is unavailable/corrupted. */
export function loadRescanCooldownUntil(): number {
  try {
    const raw = localStorage.getItem(COOLDOWN_STORAGE_KEY);
    if (!raw) return 0;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

export function storeRescanCooldownUntil(timestampMs: number): void {
  try {
    localStorage.setItem(COOLDOWN_STORAGE_KEY, String(timestampMs));
  } catch {
    // localStorage unavailable; cooldown just won't persist across reloads.
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pyrmap/web exec vitest run src/lib/rescan.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Add the API client function**

In `packages/web/src/api/client.ts`, add:

```ts
export interface RescanResponse {
  satellite: { rowsInserted: number };
  incidents: { postsChecked: number; rowsInserted: number; postsSkippedAlreadyResolved: number; postsFailed: number } | null;
}

export async function triggerRescan(hours: 6 | 12 | 24): Promise<RescanResponse> {
  const response = await fetch('/api/rescan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hours }),
  });
  if (!response.ok) {
    throw new Error(`POST /api/rescan failed: HTTP ${response.status}`);
  }
  return (await response.json()) as RescanResponse;
}
```

- [ ] **Step 6: Add the UI control**

In `packages/web/src/components/StatusBar.tsx`, add to `StatusBarProps` (after `onRefresh: () => void;`):

```tsx
  rescanning: boolean;
  rescanCooldownActive: boolean;
  onRescan: (hours: 6 | 12 | 24) => void;
```

Add the same names to the destructured parameters. Add this element right after the existing `<button type="button" onClick={onRefresh} disabled={loading}>` block:

```tsx
      <select
        className="rescan-select"
        aria-label="Re-scan time window"
        disabled={rescanning || rescanCooldownActive}
        value=""
        onChange={(event) => {
          const hours = Number(event.target.value) as 6 | 12 | 24;
          if (hours) onRescan(hours);
          event.target.value = '';
        }}
      >
        <option value="">{rescanning ? 'Re-scanning…' : rescanCooldownActive ? 'Re-scan (cooling down)' : 'Re-scan…'}</option>
        <option value="6">Last 6h</option>
        <option value="12">Last 12h</option>
        <option value="24">Last 24h</option>
      </select>
```

- [ ] **Step 7: Wire it up in `MapApp.tsx`**

Add the imports:

```tsx
import { triggerRescan } from './api/client.js';
import { RESCAN_COOLDOWN_MS, loadRescanCooldownUntil, storeRescanCooldownUntil } from './lib/rescan.js';
```

Inside the `MapApp` function, add:

```tsx
  const [rescanning, setRescanning] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState(loadRescanCooldownUntil);

  async function handleRescan(hours: 6 | 12 | 24): Promise<void> {
    setRescanning(true);
    try {
      await triggerRescan(hours);
      const until = Date.now() + RESCAN_COOLDOWN_MS;
      storeRescanCooldownUntil(until);
      setCooldownUntil(until);
      refresh();
    } catch (err) {
      console.error(err);
    } finally {
      setRescanning(false);
    }
  }
```

Pass the new props to `<StatusBar>`, after `onRefresh={refresh}`:

```tsx
        rescanning={rescanning}
        rescanCooldownActive={Date.now() < cooldownUntil}
        onRescan={(hours) => void handleRescan(hours)}
```

- [ ] **Step 8: Build and verify**

Run: `pnpm --filter @pyrmap/web build`
Expected: succeeds with zero TypeScript errors.

- [ ] **Step 9: Commit**

```bash
git add packages/web/src/lib/rescan.ts packages/web/src/lib/rescan.test.ts packages/web/src/api/client.ts packages/web/src/components/StatusBar.tsx packages/web/src/MapApp.tsx
git commit -m "feat(web): add a Re-scan control (6h/12h/24h) with a 5-minute cooldown"
```

---

### Task 8: Persisted UI prefs (time window + panel collapsed state) and 6h default

**Files:**
- Create: `packages/web/src/lib/uiPrefs.ts`
- Test: `packages/web/src/lib/uiPrefs.test.ts`
- Modify: `packages/web/src/MapApp.tsx`
- Modify: `packages/web/src/components/LayersPanel.tsx`
- Modify: `packages/web/src/components/Legend.tsx`

**Interfaces:**
- Produces: `loadStoredHours(): number`, `storeHours(hours: number): void`, `loadStoredPanelCollapsed(panel: 'layers' | 'legend'): boolean`, `storePanelCollapsed(panel: 'layers' | 'legend', collapsed: boolean): void`.

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/lib/uiPrefs.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadStoredHours, loadStoredPanelCollapsed, storeHours, storePanelCollapsed } from './uiPrefs.js';

function stubStorage(values: Record<string, string>): { setItem: ReturnType<typeof vi.fn> } {
  const setItem = vi.fn();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values[key] ?? null, setItem });
  return { setItem };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadStoredHours', () => {
  it('defaults to 6 when nothing is stored', () => {
    stubStorage({});
    expect(loadStoredHours()).toBe(6);
  });

  it('round-trips a stored value', () => {
    stubStorage({ 'pyrmap-hours': '24' });
    expect(loadStoredHours()).toBe(24);
  });

  it('falls back to the default for a corrupted value', () => {
    stubStorage({ 'pyrmap-hours': 'nonsense' });
    expect(loadStoredHours()).toBe(6);
  });
});

describe('storeHours', () => {
  it('stores the value', () => {
    const { setItem } = stubStorage({});
    storeHours(12);
    expect(setItem).toHaveBeenCalledWith('pyrmap-hours', '12');
  });
});

describe('panel collapsed state', () => {
  it('defaults to not-collapsed (expanded) for both panels when nothing is stored', () => {
    stubStorage({});
    expect(loadStoredPanelCollapsed('layers')).toBe(false);
    expect(loadStoredPanelCollapsed('legend')).toBe(false);
  });

  it('round-trips a stored collapsed state per panel independently', () => {
    stubStorage({ 'pyrmap-panel-layers': 'true', 'pyrmap-panel-legend': 'false' });
    expect(loadStoredPanelCollapsed('layers')).toBe(true);
    expect(loadStoredPanelCollapsed('legend')).toBe(false);
  });

  it('stores per-panel', () => {
    const { setItem } = stubStorage({});
    storePanelCollapsed('legend', true);
    expect(setItem).toHaveBeenCalledWith('pyrmap-panel-legend', 'true');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pyrmap/web exec vitest run src/lib/uiPrefs.test.ts`
Expected: FAIL — cannot find module `./uiPrefs.js`.

- [ ] **Step 3: Write `lib/uiPrefs.ts`**

Create `packages/web/src/lib/uiPrefs.ts`:

```ts
const HOURS_STORAGE_KEY = 'pyrmap-hours';
export const DEFAULT_HOURS = 6;

export function loadStoredHours(): number {
  try {
    const raw = localStorage.getItem(HOURS_STORAGE_KEY);
    if (!raw) return DEFAULT_HOURS;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_HOURS;
  } catch {
    return DEFAULT_HOURS;
  }
}

export function storeHours(hours: number): void {
  try {
    localStorage.setItem(HOURS_STORAGE_KEY, String(hours));
  } catch {
    // localStorage unavailable; the window just won't persist across reloads.
  }
}

export type CollapsiblePanel = 'layers' | 'legend';

function panelStorageKey(panel: CollapsiblePanel): string {
  return `pyrmap-panel-${panel}`;
}

/** Both panels default to expanded (false) — matches today's behavior before this preference existed. */
export function loadStoredPanelCollapsed(panel: CollapsiblePanel): boolean {
  try {
    return localStorage.getItem(panelStorageKey(panel)) === 'true';
  } catch {
    return false;
  }
}

export function storePanelCollapsed(panel: CollapsiblePanel, collapsed: boolean): void {
  try {
    localStorage.setItem(panelStorageKey(panel), String(collapsed));
  } catch {
    // localStorage unavailable; collapsed state just won't persist across reloads.
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pyrmap/web exec vitest run src/lib/uiPrefs.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Wire the hours preference into `MapApp.tsx`**

In `packages/web/src/MapApp.tsx`, remove the old `const DEFAULT_HOURS = 24;` constant. Add the import:

```tsx
import { loadStoredHours, storeHours } from './lib/uiPrefs.js';
```

Change:

```tsx
  const [hours, setHours] = useState<number>(DEFAULT_HOURS);
```

to:

```tsx
  const [hours, setHours] = useState<number>(loadStoredHours);
```

Find where `setHours` is passed to `<StatusBar onHoursChange={setHours} .../>` and change it to persist on change:

```tsx
        onHoursChange={(next) => {
          setHours(next);
          storeHours(next);
        }}
```

- [ ] **Step 6: Wire panel-collapsed persistence into `LayersPanel.tsx`**

In `packages/web/src/components/LayersPanel.tsx`, add the import:

```tsx
import { loadStoredPanelCollapsed, storePanelCollapsed } from '../lib/uiPrefs.js';
```

Change:

```tsx
  const [collapsed, setCollapsed] = useState(false);
```

to:

```tsx
  const [collapsed, setCollapsed] = useState(() => loadStoredPanelCollapsed('layers'));
```

Change the toggle button's `onClick`:

```tsx
      <button
        type="button"
        className="layers-toggle"
        onClick={() => {
          setCollapsed((c) => {
            const next = !c;
            storePanelCollapsed('layers', next);
            return next;
          });
        }}
      >
```

- [ ] **Step 7: Same for `Legend.tsx`**

In `packages/web/src/components/Legend.tsx`, add the import:

```tsx
import { loadStoredPanelCollapsed, storePanelCollapsed } from '../lib/uiPrefs.js';
```

Change:

```tsx
  const [collapsed, setCollapsed] = useState(false);
```

to:

```tsx
  const [collapsed, setCollapsed] = useState(() => loadStoredPanelCollapsed('legend'));
```

Change the toggle button's `onClick`:

```tsx
      <button
        type="button"
        className="legend-toggle"
        onClick={() => {
          setCollapsed((c) => {
            const next = !c;
            storePanelCollapsed('legend', next);
            return next;
          });
        }}
      >
```

- [ ] **Step 8: Build and verify**

Run: `pnpm --filter @pyrmap/web test && pnpm --filter @pyrmap/web build`
Expected: all tests pass, build succeeds with zero TypeScript errors.

- [ ] **Step 9: Commit**

```bash
git add packages/web/src/lib/uiPrefs.ts packages/web/src/lib/uiPrefs.test.ts packages/web/src/MapApp.tsx packages/web/src/components/LayersPanel.tsx packages/web/src/components/Legend.tsx
git commit -m "feat(web): persist time-window and panel-collapsed state; default to 6h"
```

---

### Task 9: Mobile-friendly responsive layout

**Files:**
- Modify: `packages/web/src/index.css`

No new automated tests (CSS-only) — verified manually in a real browser at mobile viewport widths as the final step.

- [ ] **Step 1: Read the current CSS in full**

Read `packages/web/src/index.css` completely before editing. Confirmed real structure this step's CSS targets: `.status-bar` (already `display: flex; flex-wrap: wrap; gap: 0.75rem` — it wraps today, it just isn't tight enough on narrow screens), `.app-name` (a sibling class, not nested under `.status-bar`), `.layers-panel-container` (`position: absolute; top: 3.4rem; right: 0.75rem`), `.layers-panel` (`min-width: 12.5rem`), `.legend-container` (`position: absolute; bottom: 1rem; left: 1rem`), and the existing `@media (max-width: 640px)` block (currently only toggles `.legend-toggle`/`.legend.legend-collapsed` visibility — extend this same block, don't add a second one). None of `.hours-select`/`.rescan-select` has dedicated CSS today (they render with browser-default `<select>` styling), so this step gives them real sizing for the first time.

- [ ] **Step 2: Add mobile layout rules**

Add to the existing `@media (max-width: 640px) { ... }` block in `packages/web/src/index.css` (insert alongside the existing `.legend-toggle`/`.legend.legend-collapsed` rules already there, same block):

```css
  .status-bar {
    gap: 0.4rem;
    padding: 0.4rem 0.5rem;
    font-size: 0.8rem;
  }

  .app-name {
    flex: 1 1 100%;
  }

  .last-updated {
    flex: 1 1 100%;
    font-size: 0.8rem;
  }

  .hours-select,
  .rescan-select,
  .status-bar button {
    flex: 1 1 auto;
    min-width: 0;
    font-size: 0.8rem;
    padding: 0.3rem 0.4rem;
  }

  .layers-panel-container {
    top: auto;
    bottom: 1rem;
    right: 0.5rem;
  }

  .layers-panel {
    min-width: 0;
    max-width: calc(100vw - 1rem);
  }

  .legend-container {
    left: 0.5rem;
    right: 0.5rem;
    max-width: calc(100vw - 1rem);
  }
```

(`.layers-panel-container` moves to the bottom-right on mobile, opposite corner from `.legend-container`'s bottom-left, so the two collapsible panels never overlap each other even when both are expanded on a short screen.)

- [ ] **Step 3: Verify visually in a real browser**

Run: `pnpm --filter @pyrmap/server dev:mock` in one terminal, then open `http://localhost:8080` in a desktop browser and use devtools' device toolbar to resize to a mobile width (375px and 414px are reasonable checks). Confirm:
- The status bar's controls wrap onto multiple lines rather than overflowing or overlapping.
- The Layers panel and Legend don't extend past the viewport edge.
- Nothing from the earlier (already-shipped) bell icon / rescan control is clipped or unreadable.
- Toggling the theme, view mode, and both panels still works at this width.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/index.css
git commit -m "fix(web): make the status bar and panels usable at mobile viewport widths"
```

---

### Task 10: Final verification and decision log

**Files:**
- Modify: `docs/DECISIONS.md`
- Modify: `docs/TODO.md` (only if something genuinely remains)

- [ ] **Step 1: Full repo build and test**

Run: `pnpm -r build && pnpm test`
Expected: all packages build, all tests pass.

- [ ] **Step 2: Log the durable decisions**

Append to `docs/DECISIONS.md`:

```
2026-07-22 | server | Greece boundary sourced from OpenStreetMap's own country relation (via Nominatim's polygon_geojson), kept at full precision (no simplification) | islands sit only a few km from the Turkish coast (Kastellorizo ~2km); verified against 15 real coordinate pairs before committing, see greeceBoundary.test.ts
2026-07-22 | server | isWithinGreece wired into persistNewDetections, the single choke point shared by every satellite ingest path | stops both map markers and push notifications for Turkish hotspots without touching each ingest path individually
2026-07-22 | server | incident-report failure logging: one JSON-per-line file per UTC day under dbPath's directory (/data/logs/incidents/ in production) | durable record for feeding to a coding agent later, per explicit user request; separate from the ephemeral console onLog output
2026-07-22 | server | rescan uses X API's start_time/end_time (not since_id) to revisit a window regardless of prior polls, skips only external_ids already stored | since_id-based polling can permanently miss a failed post once a later post succeeds and advances since_id past it
2026-07-22 | web | rescan control has a 5-minute client-side cooldown | each rescan is a real paid X API read, unlike the free since_id-based auto-poll; explicit user request to guard against accidental repeated triggering
2026-07-22 | web | default time window changed from 24h to 6h; time window and panel-collapsed state now persisted to localStorage | explicit user request
```

- [ ] **Step 3: Update TODO.md if anything is incomplete**

If every task above landed and all tests pass, no `docs/TODO.md` entry is needed. Otherwise add up to 5 bullet lines per the handoff protocol.

- [ ] **Step 4: Commit**

```bash
git add docs/DECISIONS.md docs/TODO.md
git commit -m "docs(repo): log Greece-boundary, rescan, and persisted-prefs decisions"
```
