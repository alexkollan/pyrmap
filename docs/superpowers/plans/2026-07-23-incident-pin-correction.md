# Incident Pin Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the app's single authenticated operator correct a mis-geocoded incident pin (drag, type coordinates, or search a place name) or remove it (hidden-forever vs. deleted-forever), since the existing ingest/rescan pipeline never revisits an already-stored post.

**Architecture:** Three new mutating routes (`PATCH .../location`, `POST .../hide`, `DELETE`) plus one new read route (`GET /api/geocode/search`), all in the existing auth-protected Fastify route group. Each mutation calls `updateBus.publish()` on success, reusing the existing SSE (`/api/events`) refresh mechanism — the frontend never needs bespoke optimistic state, it just refetches `/api/fires` (which excludes hidden rows) like it already does after any rescan/ingest. Frontend adds an `editMode` toggle; only in that mode do incident pins become draggable and their popups gain manual-entry/search/hide/delete controls.

**Tech Stack:** Fastify (routes), better-sqlite3 (repository), Nominatim (search), React + react-leaflet (frontend), Vitest (tests). No new dependencies.

## Global Constraints

- Tests must not hit the real FIRMS or Nominatim APIs — use `vi.fn()` fake `fetch` / fake ports, per `CLAUDE.md` §4.
- `pnpm -r build && pnpm test` must pass before every commit — no exceptions.
- SQL lives only in `packages/server/src/adapters/sqlite/`.
- Schema changes only via a new migration appended to `migrations.ts` — never edit a committed one.
- Every port interface/domain function gets a 1–3 line doc comment stating contract + units.
- Soft file-size limit: 300 lines. Split before a file grows past it.
- Conventional Commits (`feat|fix|test|chore|refactor|docs(scope): message`), one commit per working unit.
- No new npm dependencies for this feature.

---

## Task 1: `LocationSearchResult` shared type

**Files:**
- Modify: `packages/shared/src/types.ts`

**Interfaces:**
- Produces: `LocationSearchResult { displayName: string; latitude: number; longitude: number }`, importable from `@pyrmap/shared` (re-exported via `packages/shared/src/index.ts`'s existing `export * from './types.js'`).

- [ ] **Step 1: Add the type**

Append to `packages/shared/src/types.ts` (after the existing `IncidentReport` interface, i.e. after line 39):

```ts
/** One candidate result from a free-text place-name search (Nominatim), for a human to pick from — unlike IncidentReport's geocoding, this is not type-filtered. */
export interface LocationSearchResult {
  displayName: string;
  latitude: number;
  longitude: number;
}
```

- [ ] **Step 2: Build shared package**

Run: `pnpm --filter @pyrmap/shared build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types.ts
git commit -m "feat(shared): add LocationSearchResult type for incident pin search-correction"
```

---

## Task 2: Repository — hide / delete / update-location, and hiding filters `/api/fires`

**Files:**
- Modify: `packages/server/src/adapters/sqlite/migrations.ts`
- Modify: `packages/server/src/ports/IncidentReportRepository.ts`
- Modify: `packages/server/src/adapters/sqlite/SqliteIncidentReportRepository.ts`
- Test: `packages/server/test/SqliteIncidentReportRepository.test.ts`

**Interfaces:**
- Consumes: existing `SqliteIncidentReportRepository` constructor `(dbPath: string)`, existing `NewIncidentReportRow` shape (unchanged), existing `insertIncidentReports`.
- Produces (on `IncidentReportRepository`, implemented by `SqliteIncidentReportRepository`):
  - `updateIncidentReportLocation(id: number, latitude: number, longitude: number): boolean`
  - `hideIncidentReport(id: number): boolean`
  - `deleteIncidentReport(id: number): boolean`
  - `findIncidentReportsSince` now excludes rows where `hidden = 1` (signature unchanged).

- [ ] **Step 1: Append the migration**

In `packages/server/src/adapters/sqlite/migrations.ts`, add a new array entry after the `push_subscriptions` migration (currently the last entry, ending at line 67):

```ts
  `
  ALTER TABLE incident_reports ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
  `,
```

- [ ] **Step 2: Write the failing repository tests**

Append to `packages/server/test/SqliteIncidentReportRepository.test.ts` (after the existing `findExternalIdsSince` describe block):

```ts
function insertOne(repo: SqliteIncidentReportRepository, externalId: string) {
  repo.insertIncidentReports([
    {
      externalId,
      source: 'A',
      text: 'Πυρκαγιά στο Χ.',
      url: 'https://x.com/pyrosvestiki/status/' + externalId,
      publishedAt: '2026-07-23T10:00:00Z',
      latitude: 38.0,
      longitude: 23.0,
      precision: 'regional_unit',
    },
  ]);
  return repo.findIncidentReportsSince('2026-01-01T00:00:00Z')[0]!.id;
}

describe('updateIncidentReportLocation', () => {
  it('updates latitude/longitude and bumps precision to settlement', () => {
    const id = insertOne(repo, '100');
    expect(repo.updateIncidentReportLocation(id, 40.73, 22.92)).toBe(true);

    const [report] = repo.findIncidentReportsSince('2026-01-01T00:00:00Z');
    expect(report).toMatchObject({ latitude: 40.73, longitude: 22.92, precision: 'settlement' });
  });

  it('returns false for an unknown id and touches nothing', () => {
    expect(repo.updateIncidentReportLocation(999999, 1, 1)).toBe(false);
  });
});

describe('hideIncidentReport', () => {
  it('marks a row hidden so it is excluded from findIncidentReportsSince but a re-insert of the same external_id is still ignored', () => {
    const id = insertOne(repo, '200');
    expect(repo.hideIncidentReport(id)).toBe(true);
    expect(repo.findIncidentReportsSince('2026-01-01T00:00:00Z')).toEqual([]);

    const inserted = repo.insertIncidentReports([
      {
        externalId: '200',
        source: 'A',
        text: 'Πυρκαγιά στο Χ.',
        url: 'https://x.com/pyrosvestiki/status/200',
        publishedAt: '2026-07-23T10:00:00Z',
        latitude: 1,
        longitude: 1,
        precision: 'settlement',
      },
    ]);
    expect(inserted).toEqual([]); // still blocked — hidden, not gone
  });

  it('returns false for an unknown id', () => {
    expect(repo.hideIncidentReport(999999)).toBe(false);
  });
});

describe('deleteIncidentReport', () => {
  it('removes the row entirely, so the same external_id can be re-inserted afterwards', () => {
    const id = insertOne(repo, '300');
    expect(repo.deleteIncidentReport(id)).toBe(true);
    expect(repo.findIncidentReportsSince('2026-01-01T00:00:00Z')).toEqual([]);

    const inserted = repo.insertIncidentReports([
      {
        externalId: '300',
        source: 'A',
        text: 'Πυρκαγιά στο Χ.',
        url: 'https://x.com/pyrosvestiki/status/300',
        publishedAt: '2026-07-23T11:00:00Z',
        latitude: 2,
        longitude: 2,
        precision: 'settlement',
      },
    ]);
    expect(inserted).toHaveLength(1); // gone for real — re-insertable
  });

  it('returns false for an unknown id', () => {
    expect(repo.deleteIncidentReport(999999)).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @pyrmap/server test -- SqliteIncidentReportRepository`
Expected: FAIL — `repo.updateIncidentReportLocation is not a function` (and similarly for the other two methods).

- [ ] **Step 4: Add the port methods**

In `packages/server/src/ports/IncidentReportRepository.ts`, add to the `IncidentReportRepository` interface (after `findExternalIdsSince`, before `recordFetchLog`):

```ts
  /** Corrects a mis-geocoded report's coordinates and marks it settlement-precision (a human placed it exactly). False if id doesn't exist. */
  updateIncidentReportLocation(id: number, latitude: number, longitude: number): boolean;
  /** Marks a report hidden forever: excluded from findIncidentReportsSince, but the row (and its external_id) stays, permanently blocking re-insertion. False if id doesn't exist. */
  hideIncidentReport(id: number): boolean;
  /** Removes a report entirely — unlike hideIncidentReport, its external_id can be re-inserted by a future poll/rescan. False if id doesn't exist. */
  deleteIncidentReport(id: number): boolean;
```

- [ ] **Step 5: Implement in SqliteIncidentReportRepository**

In `packages/server/src/adapters/sqlite/SqliteIncidentReportRepository.ts`:

Change the `findIncidentReportsSince` method (currently lines 71-76) to exclude hidden rows:

```ts
  findIncidentReportsSince(sinceIso: string): IncidentReport[] {
    const rows = this.db
      .prepare(`SELECT * FROM incident_reports WHERE published_at >= ? AND hidden = 0 ORDER BY published_at DESC`)
      .all(sinceIso) as IncidentReportRow[];
    return rows.map(rowToIncidentReport);
  }
```

Add the three new methods (after `findExternalIdsSince`, before `recordFetchLog`):

```ts
  updateIncidentReportLocation(id: number, latitude: number, longitude: number): boolean {
    return (
      this.db
        .prepare(`UPDATE incident_reports SET latitude = ?, longitude = ?, precision = 'settlement' WHERE id = ?`)
        .run(latitude, longitude, id).changes === 1
    );
  }

  hideIncidentReport(id: number): boolean {
    return this.db.prepare('UPDATE incident_reports SET hidden = 1 WHERE id = ?').run(id).changes === 1;
  }

  deleteIncidentReport(id: number): boolean {
    return this.db.prepare('DELETE FROM incident_reports WHERE id = ?').run(id).changes === 1;
  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @pyrmap/server test -- SqliteIncidentReportRepository`
Expected: PASS, all tests in the file green.

- [ ] **Step 7: Run the full server build+test**

Run: `pnpm --filter @pyrmap/server build && pnpm --filter @pyrmap/server test`
Expected: build succeeds; all existing tests still pass (nothing else queries `incident_reports` directly, but this confirms no regression).

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/adapters/sqlite/migrations.ts packages/server/src/ports/IncidentReportRepository.ts packages/server/src/adapters/sqlite/SqliteIncidentReportRepository.ts packages/server/test/SqliteIncidentReportRepository.test.ts
git commit -m "feat(server): add incident-report hide/delete/update-location to the repository"
```

---

## Task 3: `NominatimClient.search()` — unfiltered multi-result place search

**Files:**
- Create: `packages/server/src/ports/LocationSearchSource.ts`
- Modify: `packages/server/src/adapters/nominatim/NominatimClient.ts`
- Test: `packages/server/test/NominatimClient.test.ts`

**Interfaces:**
- Consumes: `NominatimClient`'s existing private throttle (`lastCallAt`, `MIN_INTERVAL_MS`), existing constructor `(fetchImpl, now, sleep)`.
- Produces: `LocationSearchSource { search(query: string): Promise<LocationSearchResult[]> }`, implemented by `NominatimClient` (in addition to its existing `GeocodingSource`).

- [ ] **Step 1: Create the port**

Create `packages/server/src/ports/LocationSearchSource.ts`:

```ts
import type { LocationSearchResult } from '@pyrmap/shared';

/** Free-text place-name search returning multiple raw candidates for a human to pick from — unlike
 * GeocodingSource, results are NOT restricted to "trusted" address types, since a human (not an
 * automated pipeline) is the one judging each result's name before choosing. */
export interface LocationSearchSource {
  search(query: string): Promise<LocationSearchResult[]>;
}
```

- [ ] **Step 2: Write the failing tests**

Append to `packages/server/test/NominatimClient.test.ts` (imports need `LocationSearchResult`; add `import type { LocationSearchResult } from '@pyrmap/shared';` near the top, and append this new `describe` block at the end, before the final closing of the file):

```ts
describe('NominatimClient.search', () => {
  it('returns every result unfiltered by addresstype, unlike geocode()', async () => {
    // Same fixture geocode() rejects entirely (all untrusted types) — search() must still surface them,
    // since a human is choosing, not an automated pipeline.
    const client = new NominatimClient(fakeFetch(REAL_ALL_UNTRUSTED_RESULT));
    const results = await client.search('Αττική');
    expect(results).toEqual<LocationSearchResult[]>([
      { displayName: 'Αττική', latitude: 37.9995238, longitude: 23.7228379 },
      { displayName: 'Αττική', latitude: 37.9960777, longitude: 23.7224191 },
      { displayName: 'Αττική', latitude: 37.9946543, longitude: 23.7994025 },
    ]);
  });

  it('returns an empty array when Nominatim finds nothing', async () => {
    const client = new NominatimClient(fakeFetch([]));
    expect(await client.search('nonexistent')).toEqual([]);
  });

  it('returns an empty array (never throws) on a non-2xx response or network error', async () => {
    const client = new NominatimClient(fakeFetch({}, 503));
    expect(await client.search('anything')).toEqual([]);

    const throwing = new NominatimClient(
      vi.fn(async () => {
        throw new Error('network down');
      }) as unknown as typeof fetch,
    );
    expect(await throwing.search('anything')).toEqual([]);
  });

  it('shares the same request throttle as geocode()', async () => {
    let currentTime = 1_700_000_000_000;
    const now = vi.fn(() => currentTime);
    const sleep = vi.fn(async () => undefined);
    const client = new NominatimClient(fakeFetch(REAL_VILLAGE_RESULT), now, sleep);

    await client.geocode('a');
    currentTime += 50;
    await client.search('b');
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep.mock.calls[0]![0]).toBeGreaterThan(1000);
  });
});
```

Note: the `name` field in the existing fixtures (`REAL_VILLAGE_RESULT`, `REAL_ALL_UNTRUSTED_RESULT`, etc.) is used as each result's `displayName` — real Nominatim `jsonv2` responses put this in `display_name`, so the implementation step below reads `display_name`, and the fixtures need that field. Add it to the two fixtures this test touches: in `REAL_ALL_UNTRUSTED_RESULT`, add `display_name: 'Αττική',` to each of the 3 entries; in `REAL_VILLAGE_RESULT`'s single entry, add `display_name: 'Βορίζια',`.

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @pyrmap/server test -- NominatimClient`
Expected: FAIL — `client.search is not a function`.

- [ ] **Step 4: Implement `search()`**

In `packages/server/src/adapters/nominatim/NominatimClient.ts`:

Add the import and extend the result interface (near the top, after the existing imports):

```ts
import type { LocationSearchResult } from '@pyrmap/shared';
import type { LocationSearchSource } from '../../ports/LocationSearchSource.js';
```

Change `interface NominatimResult` (currently lines 29-33) to add the display name field:

```ts
interface NominatimResult {
  lat: string;
  lon: string;
  addresstype?: string;
  display_name?: string;
}
```

Change the class declaration to also implement the new port:

```ts
export class NominatimClient implements GeocodingSource, LocationSearchSource {
```

Add a private shared helper and the new `search` method (after the existing `geocode` method, before the closing `}` of the class). First, extract the throttle+fetch logic that both methods need — replace the body of `geocode` so both methods call one private `fetchResults`:

```ts
  private async fetchResults(query: string): Promise<NominatimResult[]> {
    const waitMs = this.lastCallAt + MIN_INTERVAL_MS - this.now();
    if (waitMs > 0) await this.sleep(waitMs);
    this.lastCallAt = this.now();

    const params = new URLSearchParams({
      q: query,
      format: 'jsonv2',
      countrycodes: 'gr',
      limit: String(RESULT_LIMIT),
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(`${API_URL}?${params.toString()}`, {
        headers: { 'User-Agent': USER_AGENT },
        signal: controller.signal,
      });
      if (!response.ok) return [];
      return (await response.json()) as NominatimResult[];
    } catch {
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }

  async geocode(query: string): Promise<GeocodedLocation | null> {
    const results = await this.fetchResults(query);

    for (const result of results) {
      const addressType = result.addresstype ?? '';
      const precision: IncidentPrecision | null = SETTLEMENT_ADDRESS_TYPES.has(addressType)
        ? 'settlement'
        : REGION_ADDRESS_TYPES.has(addressType)
          ? 'regional_unit'
          : null;
      if (!precision) continue;

      const latitude = Number(result.lat);
      const longitude = Number(result.lon);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;

      return { latitude, longitude, precision };
    }

    return null;
  }

  /** Unlike geocode(), returns every result with no addresstype filtering — for a human to choose from, not an automated pipeline. */
  async search(query: string): Promise<LocationSearchResult[]> {
    const results = await this.fetchResults(query);
    const found: LocationSearchResult[] = [];
    for (const result of results) {
      const latitude = Number(result.lat);
      const longitude = Number(result.lon);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
      found.push({ displayName: result.display_name ?? '', latitude, longitude });
    }
    return found;
  }
```

This replaces the old `geocode` method body (which previously contained the fetch/throttle logic directly) — delete the old inline throttle/fetch code from `geocode` since it now lives in `fetchResults`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @pyrmap/server test -- NominatimClient`
Expected: PASS, all tests in the file green (including the pre-existing `geocode` tests — confirms the refactor didn't change its behavior).

- [ ] **Step 6: Full server build+test**

Run: `pnpm --filter @pyrmap/server build && pnpm --filter @pyrmap/server test`
Expected: both succeed.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/ports/LocationSearchSource.ts packages/server/src/adapters/nominatim/NominatimClient.ts packages/server/test/NominatimClient.test.ts
git commit -m "feat(server): add NominatimClient.search() for unfiltered, human-picked place search"
```

---

## Task 4: Routes — location correction, hide, delete, and search

**Files:**
- Create: `packages/server/src/routes/incidents.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/index.ts`
- Test: `packages/server/test/incidents.test.ts` (create)

**Interfaces:**
- Consumes: `IncidentReportRepository` (Task 2's new methods), `LocationSearchSource` (Task 3), `UpdateBus.publish(): void` (existing, see `packages/server/src/jobs/updateBus.ts`), existing `buildApp` positional-argument signature (see below).
- Produces: `incidentEditRoutes(repository: IncidentReportRepository, searchSource: LocationSearchSource | undefined, updateBus: UpdateBus)` — a Fastify plugin factory, registered inside `buildApp`'s existing protected route group.

- [ ] **Step 1: Write the failing route tests**

Create `packages/server/test/incidents.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { SqliteFireRepository } from '../src/adapters/sqlite/SqliteFireRepository.js';
import { SqliteIncidentReportRepository } from '../src/adapters/sqlite/SqliteIncidentReportRepository.js';
import type { AuthConfig } from '../src/routes/auth.js';
import type { LocationSearchSource } from '../src/ports/LocationSearchSource.js';

const AUTH: AuthConfig = { username: 'alex', password: 'secret-pw', sessionSecret: 'test-secret' };

async function setup(auth: AuthConfig | null = null, searchSource?: LocationSearchSource) {
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'pyrmap-incidents-route-test-'));
  const fireRepo = new SqliteFireRepository(path.join(tmpDir, 'fires.db'));
  const incidentRepo = new SqliteIncidentReportRepository(path.join(tmpDir, 'incidents.db'));
  incidentRepo.insertIncidentReports([
    {
      externalId: '1',
      source: 'A',
      text: 'Πυρκαγιά στο Χ.',
      url: 'https://x.com/pyrosvestiki/status/1',
      publishedAt: '2026-07-23T10:00:00Z',
      latitude: 38.13,
      longitude: 22.42,
      precision: 'regional_unit',
    },
  ]);
  const [{ id }] = incidentRepo.findIncidentReportsSince('2026-01-01T00:00:00Z');

  const app = await buildApp(
    { logLevel: 'silent' },
    fireRepo,
    undefined,
    '/nonexistent',
    incidentRepo,
    undefined,
    auth,
    undefined,
    undefined,
    undefined,
    searchSource,
  );

  return {
    app,
    id,
    cleanup: () => {
      fireRepo.close();
      incidentRepo.close();
      rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

describe('PATCH /api/incidents/:id/location', () => {
  it('updates coordinates and publishes an update', async () => {
    const { app, id, cleanup } = await setup();
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/incidents/${id}/location`,
      payload: { latitude: 40.73, longitude: 22.92 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id, latitude: 40.73, longitude: 22.92, precision: 'settlement' });
    cleanup();
  });

  it('404s for an unknown id', async () => {
    const { app, cleanup } = await setup();
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/incidents/999999/location',
      payload: { latitude: 1, longitude: 1 },
    });
    expect(response.statusCode).toBe(404);
    cleanup();
  });

  it('400s on a non-finite coordinate', async () => {
    const { app, id, cleanup } = await setup();
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/incidents/${id}/location`,
      payload: { latitude: 'not-a-number', longitude: 1 },
    });
    expect(response.statusCode).toBe(400);
    cleanup();
  });

  it('requires a session when auth is enabled', async () => {
    const { app, id, cleanup } = await setup(AUTH);
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/incidents/${id}/location`,
      payload: { latitude: 1, longitude: 1 },
    });
    expect(response.statusCode).toBe(401);
    cleanup();
  });
});

describe('POST /api/incidents/:id/hide', () => {
  it('hides the report so it no longer appears in /api/fires', async () => {
    const { app, id, cleanup } = await setup();
    const hideResponse = await app.inject({ method: 'POST', url: `/api/incidents/${id}/hide` });
    expect(hideResponse.statusCode).toBe(200);

    const firesResponse = await app.inject({ method: 'GET', url: '/api/fires?hours=999' });
    expect(firesResponse.json().incidents).toEqual([]);
    cleanup();
  });

  it('404s for an unknown id', async () => {
    const { app, cleanup } = await setup();
    const response = await app.inject({ method: 'POST', url: '/api/incidents/999999/hide' });
    expect(response.statusCode).toBe(404);
    cleanup();
  });
});

describe('DELETE /api/incidents/:id', () => {
  it('removes the report entirely', async () => {
    const { app, id, cleanup } = await setup();
    const deleteResponse = await app.inject({ method: 'DELETE', url: `/api/incidents/${id}` });
    expect(deleteResponse.statusCode).toBe(200);

    const firesResponse = await app.inject({ method: 'GET', url: '/api/fires?hours=999' });
    expect(firesResponse.json().incidents).toEqual([]);
    cleanup();
  });

  it('404s for an unknown id', async () => {
    const { app, cleanup } = await setup();
    const response = await app.inject({ method: 'DELETE', url: '/api/incidents/999999' });
    expect(response.statusCode).toBe(404);
    cleanup();
  });
});

describe('GET /api/geocode/search', () => {
  it('returns results from the configured search source', async () => {
    const searchSource: LocationSearchSource = {
      search: vi.fn(async () => [{ displayName: 'Ωραιόκαστρο, Θεσσαλονίκη', latitude: 40.73, longitude: 22.92 }]),
    };
    const { app, cleanup } = await setup(null, searchSource);
    const response = await app.inject({ method: 'GET', url: '/api/geocode/search?q=Ωραιόκαστρο' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      results: [{ displayName: 'Ωραιόκαστρο, Θεσσαλονίκη', latitude: 40.73, longitude: 22.92 }],
    });
    expect(searchSource.search).toHaveBeenCalledWith('Ωραιόκαστρο');
    cleanup();
  });

  it('returns an empty result set when no search source is configured', async () => {
    const { app, cleanup } = await setup();
    const response = await app.inject({ method: 'GET', url: '/api/geocode/search?q=anything' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ results: [] });
    cleanup();
  });

  it('400s on a missing or empty q', async () => {
    const { app, cleanup } = await setup();
    const response = await app.inject({ method: 'GET', url: '/api/geocode/search' });
    expect(response.statusCode).toBe(400);
    cleanup();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @pyrmap/server test -- incidents`
Expected: FAIL — 404s everywhere (routes don't exist yet) and a TypeScript error on `buildApp`'s extra `searchSource` argument once Step 4/5 below are also in place; for now expect route-not-found failures.

- [ ] **Step 3: Check `UpdateBus`'s shape**

Read `packages/server/src/jobs/updateBus.ts` to confirm the exact publish method name before wiring it into the new routes (the plan assumes `publish(): void` based on its use in `app.ts`/`eventsRoutes` — confirm this matches before proceeding; if the real name differs, use the real one in Step 4).

- [ ] **Step 4: Create the routes file**

Create `packages/server/src/routes/incidents.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import type { IncidentReport } from '@pyrmap/shared';
import type { IncidentReportRepository } from '../ports/IncidentReportRepository.js';
import type { LocationSearchSource } from '../ports/LocationSearchSource.js';
import type { UpdateBus } from '../jobs/updateBus.js';

interface IdParams {
  id: number;
}

interface LocationBody {
  latitude: number;
  longitude: number;
}

interface SearchQuery {
  q: string;
}

/**
 * Manual correction for mis-geocoded incident reports (docs/superpowers/specs/2026-07-23-incident-pin-correction-design.md):
 * reposition a pin (drag/manual entry/search-pick all funnel into the PATCH below), or remove one
 * — hidden forever (its external_id keeps blocking re-insertion) or deleted forever (re-insertable
 * by a future rescan). Every mutation publishes an update so connected clients refetch via the
 * existing SSE mechanism (see jobs/updateBus.ts) — no bespoke frontend state needed.
 */
export function incidentEditRoutes(
  repository: IncidentReportRepository,
  searchSource: LocationSearchSource | undefined,
  updateBus: UpdateBus,
) {
  return async function registerIncidentEditRoutes(app: FastifyInstance): Promise<void> {
    app.patch<{ Params: IdParams; Body: LocationBody }>(
      '/api/incidents/:id/location',
      {
        schema: {
          params: {
            type: 'object',
            properties: { id: { type: 'integer' } },
            required: ['id'],
          },
          body: {
            type: 'object',
            properties: {
              latitude: { type: 'number', minimum: -90, maximum: 90 },
              longitude: { type: 'number', minimum: -180, maximum: 180 },
            },
            required: ['latitude', 'longitude'],
            additionalProperties: false,
          },
        },
      },
      async (request, reply) => {
        const { id } = request.params;
        const { latitude, longitude } = request.body;
        const updated = repository.updateIncidentReportLocation(id, latitude, longitude);
        if (!updated) {
          reply.code(404);
          return { error: 'Not Found' };
        }
        updateBus.publish();
        const [report] = repository.findIncidentReportsSince('1970-01-01T00:00:00Z').filter((r) => r.id === id);
        return report as IncidentReport;
      },
    );

    app.post<{ Params: IdParams }>(
      '/api/incidents/:id/hide',
      { schema: { params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] } } },
      async (request, reply) => {
        const hidden = repository.hideIncidentReport(request.params.id);
        if (!hidden) {
          reply.code(404);
          return { error: 'Not Found' };
        }
        updateBus.publish();
        return { ok: true };
      },
    );

    app.delete<{ Params: IdParams }>(
      '/api/incidents/:id',
      { schema: { params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] } } },
      async (request, reply) => {
        const deleted = repository.deleteIncidentReport(request.params.id);
        if (!deleted) {
          reply.code(404);
          return { error: 'Not Found' };
        }
        updateBus.publish();
        return { ok: true };
      },
    );

    app.get<{ Querystring: SearchQuery }>(
      '/api/geocode/search',
      {
        schema: {
          querystring: {
            type: 'object',
            properties: { q: { type: 'string', minLength: 1 } },
            required: ['q'],
            additionalProperties: false,
          },
        },
      },
      async (request) => {
        const results = searchSource ? await searchSource.search(request.query.q) : [];
        return { results };
      },
    );
  };
}
```

Note: the `PATCH .../location` handler's re-fetch of the updated row (`findIncidentReportsSince('1970-01-01T00:00:00Z').filter(...)`) is deliberately simple rather than adding a new repository method just to fetch-by-id — this port has no `findById`, and adding one only for a response payload isn't worth a new method; revisit only if this becomes a real bottleneck (it's a single-row scan over one repository call, on a manual, human-paced action).

- [ ] **Step 5: Wire the route into `app.ts`**

In `packages/server/src/app.ts`:

Add imports (after the existing `pushPublicRoutes, pushRoutes` import line):

```ts
import { incidentEditRoutes } from './routes/incidents.js';
import type { LocationSearchSource } from './ports/LocationSearchSource.js';
```

Change the `buildApp` signature (currently ending `getScheduler?: () => Scheduler | null,`) to add one more optional trailing parameter:

```ts
  getScheduler?: () => Scheduler | null,
  locationSearchSource?: LocationSearchSource,
): Promise<FastifyInstance> {
```

Inside the protected route group (the `await app.register(async (protectedApp) => { ... })` block), after the existing `if (getScheduler) { ... }` block, add:

```ts
    if (incidentRepository) {
      await protectedApp.register(incidentEditRoutes(incidentRepository, locationSearchSource, updateBus));
    }
```

- [ ] **Step 6: Wire it into `index.ts`**

In `packages/server/src/index.ts`, update the `buildApp(...)` call (currently 10 positional args ending with `() => scheduler,`) to pass the existing `geocodingSource` as the new 11th argument:

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
    geocodingSource,
  );
```

(`geocodingSource` is already declared earlier in this file as `const geocodingSource = incidentIngestion ? new NominatimClient() : undefined;` — `NominatimClient` now implements `LocationSearchSource` too, per Task 3, so this is already the right type with no further change needed there.)

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter @pyrmap/server test -- incidents`
Expected: PASS, all tests in `incidents.test.ts` green.

- [ ] **Step 8: Full server build+test**

Run: `pnpm --filter @pyrmap/server build && pnpm --filter @pyrmap/server test`
Expected: both succeed, no regressions (in particular re-check `rescan.test.ts` and any other test calling `buildApp` positionally still passes, since a new optional trailing parameter was added — it should be backward compatible).

- [ ] **Step 9: Commit**

```bash
git add packages/server/src/routes/incidents.ts packages/server/src/app.ts packages/server/src/index.ts packages/server/test/incidents.test.ts
git commit -m "feat(server): add incident correction routes (location/hide/delete) and place search"
```

---

## Task 5: Frontend API client functions

**Files:**
- Modify: `packages/web/src/api/client.ts`

**Interfaces:**
- Consumes: `LocationSearchResult` from `@pyrmap/shared` (Task 1), `IncidentReport` from `@pyrmap/shared` (existing).
- Produces: `updateIncidentLocation(id, latitude, longitude): Promise<IncidentReport>`, `hideIncident(id): Promise<void>`, `deleteIncident(id): Promise<void>`, `searchLocations(query): Promise<LocationSearchResult[]>`.

- [ ] **Step 1: Add the functions**

Append to `packages/web/src/api/client.ts` (add `IncidentReport, LocationSearchResult` to the existing `import type { FiresResponse } from '@pyrmap/shared';` line, making it `import type { FiresResponse, IncidentReport, LocationSearchResult } from '@pyrmap/shared';`):

```ts
export async function updateIncidentLocation(id: number, latitude: number, longitude: number): Promise<IncidentReport> {
  const response = await fetch(`/api/incidents/${id}/location`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ latitude, longitude }),
  });
  if (!response.ok) {
    throw new Error(`PATCH /api/incidents/${id}/location failed: HTTP ${response.status}`);
  }
  return (await response.json()) as IncidentReport;
}

export async function hideIncident(id: number): Promise<void> {
  const response = await fetch(`/api/incidents/${id}/hide`, { method: 'POST' });
  if (!response.ok) {
    throw new Error(`POST /api/incidents/${id}/hide failed: HTTP ${response.status}`);
  }
}

export async function deleteIncident(id: number): Promise<void> {
  const response = await fetch(`/api/incidents/${id}`, { method: 'DELETE' });
  if (!response.ok) {
    throw new Error(`DELETE /api/incidents/${id} failed: HTTP ${response.status}`);
  }
}

export async function searchLocations(query: string): Promise<LocationSearchResult[]> {
  const response = await fetch(`/api/geocode/search?q=${encodeURIComponent(query)}`);
  if (!response.ok) {
    throw new Error(`GET /api/geocode/search failed: HTTP ${response.status}`);
  }
  const body = (await response.json()) as { results: LocationSearchResult[] };
  return body.results;
}
```

- [ ] **Step 2: Build web package**

Run: `pnpm --filter @pyrmap/web build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/api/client.ts
git commit -m "feat(web): add API client functions for incident pin correction"
```

---

## Task 6: `IncidentEditControls` + draggable `IncidentMarker`

**Files:**
- Create: `packages/web/src/components/IncidentEditControls.tsx`
- Modify: `packages/web/src/components/IncidentMarker.tsx`
- Modify: `packages/web/src/index.css`

**Interfaces:**
- Consumes: `updateIncidentLocation`, `hideIncident`, `deleteIncident`, `searchLocations` (Task 5); `IncidentReport`, `LocationSearchResult` from `@pyrmap/shared`.
- Produces: `IncidentEditControls` component (props: `incident: IncidentReport`), rendered inside `IncidentMarker`'s popup only when `editMode` is true. `IncidentMarker` gains an `editMode: boolean` prop.

- [ ] **Step 1: Create `IncidentEditControls.tsx`**

Create `packages/web/src/components/IncidentEditControls.tsx`:

```tsx
import { useState } from 'react';
import type { IncidentReport, LocationSearchResult } from '@pyrmap/shared';
import { deleteIncident, hideIncident, searchLocations, updateIncidentLocation } from '../api/client.js';

/**
 * Correction controls shown inside an incident pin's popup while the map is in edit mode: manual
 * lat/lon entry, place-name search-and-pick, and hide/delete-forever — see
 * docs/superpowers/specs/2026-07-23-incident-pin-correction-design.md for the semantics of hide
 * vs. delete. All three ways of choosing new coordinates (this component's inputs, dragging the
 * marker itself, or picking a search result) call the same PATCH endpoint.
 */
export function IncidentEditControls({ incident }: { incident: IncidentReport }): JSX.Element {
  const [lat, setLat] = useState(String(incident.latitude));
  const [lon, setLon] = useState(String(incident.longitude));
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LocationSearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch {
      setError('Action failed — nothing changed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  function handleSaveCoordinates(): void {
    const parsedLat = Number(lat);
    const parsedLon = Number(lon);
    if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLon)) {
      setError('Latitude/longitude must be numbers.');
      return;
    }
    void run(() => updateIncidentLocation(incident.id, parsedLat, parsedLon).then(() => undefined));
  }

  function handleSearch(): void {
    if (!query.trim()) return;
    void run(() => searchLocations(query).then(setResults));
  }

  function handlePickResult(result: LocationSearchResult): void {
    void run(() => updateIncidentLocation(incident.id, result.latitude, result.longitude).then(() => undefined));
  }

  function handleHide(): void {
    if (!confirm('Hide this pin? It will be hidden forever, even if the same post is scanned again — this cannot be undone.')) return;
    void run(() => hideIncident(incident.id));
  }

  function handleDelete(): void {
    if (!confirm('Delete this pin forever? Unlike Hide, a future re-scan may re-add it if it fetches this same post again.')) return;
    void run(() => deleteIncident(incident.id));
  }

  return (
    <div className="incident-edit-controls">
      <div className="incident-edit-row">
        <input
          type="number"
          step="any"
          value={lat}
          onChange={(event) => setLat(event.target.value)}
          aria-label="Latitude"
          disabled={busy}
        />
        <input
          type="number"
          step="any"
          value={lon}
          onChange={(event) => setLon(event.target.value)}
          aria-label="Longitude"
          disabled={busy}
        />
        <button type="button" onClick={handleSaveCoordinates} disabled={busy}>
          Save
        </button>
      </div>
      <div className="incident-edit-row">
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search a place name…"
          aria-label="Search place name"
          disabled={busy}
        />
        <button type="button" onClick={handleSearch} disabled={busy}>
          Search
        </button>
      </div>
      {results.length > 0 && (
        <ul className="incident-search-results">
          {results.map((result, index) => (
            <li key={index}>
              <button type="button" onClick={() => handlePickResult(result)} disabled={busy}>
                {result.displayName}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="incident-edit-row">
        <button type="button" onClick={handleHide} disabled={busy}>
          Hide
        </button>
        <button type="button" onClick={handleDelete} disabled={busy}>
          Delete forever
        </button>
      </div>
      {error && <div className="incident-edit-error">{error}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Wire it into `IncidentMarker`**

In `packages/web/src/components/IncidentMarker.tsx`:

Add imports (after the existing imports):

```ts
import { useState } from 'react';
import { IncidentEditControls } from './IncidentEditControls.js';
import { updateIncidentLocation } from '../api/client.js';
```

Change the component signature and body. Replace:

```tsx
export function IncidentMarker({ incident }: { incident: IncidentReport }): JSX.Element {
  const coarse = incident.precision === 'regional_unit';
  const color = ageToColor(hoursSince(incident.publishedAt), INCIDENT_MAX_AGE_HOURS);
  const icon = divIcon({
    className: `incident-marker-icon${coarse ? ' incident-marker-coarse' : ''}`,
    html: pinSvg(color),
    iconSize: [26, 34],
    iconAnchor: [13, 34],
    popupAnchor: [0, -30],
  });

  return (
    <Marker position={[incident.latitude, incident.longitude]} icon={icon}>
```

with:

```tsx
export function IncidentMarker({ incident, editMode }: { incident: IncidentReport; editMode: boolean }): JSX.Element {
  const coarse = incident.precision === 'regional_unit';
  const color = ageToColor(hoursSince(incident.publishedAt), INCIDENT_MAX_AGE_HOURS);
  const icon = divIcon({
    className: `incident-marker-icon${coarse ? ' incident-marker-coarse' : ''}`,
    html: pinSvg(color),
    iconSize: [26, 34],
    iconAnchor: [13, 34],
    popupAnchor: [0, -30],
  });
  const [dragError, setDragError] = useState<string | null>(null);

  return (
    <Marker
      position={[incident.latitude, incident.longitude]}
      icon={icon}
      draggable={editMode}
      eventHandlers={
        editMode
          ? {
              dragend: (event: { target: LeafletMarkerInstance }) => {
                const marker = event.target;
                const { lat, lng } = marker.getLatLng();
                updateIncidentLocation(incident.id, lat, lng).catch(() => {
                  setDragError('Move failed — try again.');
                  marker.setLatLng([incident.latitude, incident.longitude]);
                });
              },
            }
          : {}
      }
    >
```

Add `import type { Marker as LeafletMarkerInstance } from 'leaflet';` to the top imports (the type of the actual Leaflet marker instance a drag event's `target` refers to — distinct from react-leaflet's `Marker` component already imported by name).

Change the `Popup` body to add the edit controls and drag-error message. Replace:

```tsx
      <Popup>
        <div className="fire-popup">
          <strong>Reported fire (Fire Service, unverified by satellite)</strong>
          <div>
            {formatAthensTime(incident.publishedAt)} ({formatRelativeTime(incident.publishedAt)})
          </div>
          <div lang="el">{incident.text}</div>
          <div className="fire-popup-caveat">
            <div>{PRECISION_LABEL[incident.precision]}</div>
          </div>
          <div>
            <a href={incident.url} target="_blank" rel="noreferrer">
              View original post ↗
            </a>
          </div>
        </div>
      </Popup>
```

with:

```tsx
      <Popup>
        <div className="fire-popup">
          <strong>Reported fire (Fire Service, unverified by satellite)</strong>
          <div>
            {formatAthensTime(incident.publishedAt)} ({formatRelativeTime(incident.publishedAt)})
          </div>
          <div lang="el">{incident.text}</div>
          <div className="fire-popup-caveat">
            <div>{PRECISION_LABEL[incident.precision]}</div>
          </div>
          <div>
            <a href={incident.url} target="_blank" rel="noreferrer">
              View original post ↗
            </a>
          </div>
          {editMode && <IncidentEditControls incident={incident} />}
          {dragError && <div className="incident-edit-error">{dragError}</div>}
        </div>
      </Popup>
```

- [ ] **Step 3: Add CSS**

Append to `packages/web/src/index.css`:

```css
.incident-edit-controls {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border-color, #ccc);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.incident-edit-row {
  display: flex;
  gap: 4px;
}

.incident-edit-row input[type='number'] {
  width: 5.5em;
}

.incident-edit-row input[type='text'] {
  flex: 1;
}

.incident-search-results {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 6em;
  overflow-y: auto;
}

.incident-search-results button {
  width: 100%;
  text-align: left;
}

.incident-edit-error {
  color: #c0392b;
  font-size: 0.9em;
}
```

(If `--border-color` isn't an existing CSS variable in this file, check `index.css` for whatever border/divider color variable or literal is already used elsewhere — e.g. in `.fire-popup-caveat` — and use that instead, to stay visually consistent rather than introducing a new undefined variable.)

- [ ] **Step 4: Build web package**

Run: `pnpm --filter @pyrmap/web build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/IncidentEditControls.tsx packages/web/src/components/IncidentMarker.tsx packages/web/src/index.css
git commit -m "feat(web): make incident pins draggable and add manual/search correction controls in edit mode"
```

---

## Task 7: Edit-mode toggle — `StatusBar` → `MapApp` → `FireMap` → `IncidentMarker`

**Files:**
- Modify: `packages/web/src/components/StatusBar.tsx`
- Modify: `packages/web/src/components/FireMap.tsx`
- Modify: `packages/web/src/MapApp.tsx`

**Interfaces:**
- Consumes: `IncidentMarker`'s new `editMode` prop (Task 6).
- Produces: `StatusBar` gains `editMode: boolean; onToggleEditMode: () => void` props; `FireMap` gains `editMode: boolean` prop; `MapApp` owns the `editMode` state.

- [ ] **Step 1: Add the toggle button to `StatusBar`**

In `packages/web/src/components/StatusBar.tsx`, add to `StatusBarProps` (after `onToggleViewMode: () => void;`):

```ts
  editMode: boolean;
  onToggleEditMode: () => void;
```

Add to the function's destructured parameters (after `onToggleViewMode,`):

```ts
  editMode,
  onToggleEditMode,
```

Add a button (after the existing view-mode toggle button):

```tsx
      <button type="button" onClick={onToggleEditMode} aria-label="Toggle pin edit mode">
        {editMode ? 'Done editing' : 'Edit pins'}
      </button>
```

- [ ] **Step 2: Thread `editMode` through `FireMap`**

In `packages/web/src/components/FireMap.tsx`, add `editMode: boolean;` to the props interface (near `incidents: IncidentReport[];`), add `editMode` to the destructured function parameters, and change:

```tsx
      {prefs.reportedIncidents &&
        incidents.map((incident) => <IncidentMarker key={incident.id} incident={incident} />)}
```

to:

```tsx
      {prefs.reportedIncidents &&
        incidents.map((incident) => <IncidentMarker key={incident.id} incident={incident} editMode={editMode} />)}
```

- [ ] **Step 3: Own the state in `MapApp`**

In `packages/web/src/MapApp.tsx`, add state (after `const [cooldownUntil, setCooldownUntil] = useState(loadRescanCooldownUntil);`):

```ts
  const [editMode, setEditMode] = useState(false);
```

Pass it to `StatusBar` (inside the existing `<StatusBar ... />` call, after `onToggleViewMode={toggleViewMode}`):

```tsx
        editMode={editMode}
        onToggleEditMode={() => setEditMode((prev) => !prev)}
```

Pass it to `FireMap` (inside the existing `<FireMap ... />` call, after `viewMode={viewMode}`):

```tsx
        editMode={editMode}
```

- [ ] **Step 4: Build web package**

Run: `pnpm --filter @pyrmap/web build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/StatusBar.tsx packages/web/src/components/FireMap.tsx packages/web/src/MapApp.tsx
git commit -m "feat(web): add an Edit-pins toggle gating incident-marker drag and correction controls"
```

---

## Task 8: Decision log, full verification, and manual browser check

**Files:**
- Modify: `docs/DECISIONS.md`

**Interfaces:** None (final integration/verification task).

- [ ] **Step 1: Full monorepo build and test**

Run: `pnpm -r build && pnpm test`
Expected: both succeed with zero failures across every package.

- [ ] **Step 2: Manual browser verification**

Start the dev server against mock fire data plus a real incident report to click on:

```bash
FIRMS_MOCK=1 pnpm --filter @pyrmap/server dev:mock
```

If there's no existing incident report to test against in mock mode, temporarily insert one directly via a short Node script against a throwaway SQLite file pointed at by `DB_PATH`, or use the `run` skill if this project has one configured, to launch the app and confirm in a real browser:
1. Click "Edit pins" — pins become draggable, popups show the new controls; clicking it again ("Done editing") turns both off.
2. Drag a pin — it moves and the change persists across a refresh.
3. Manually type new coordinates and Save — pin moves accordingly.
4. Search a real Greek place name, pick a result — pin moves there.
5. Hide a pin — it disappears and does not come back after refresh.
6. Delete a different pin — it disappears; confirm dialogs are worded correctly for both actions.

If this sandboxed environment cannot render a real browser (a prior session hit a missing `libasound.so.2` headless-Chromium dependency it couldn't install without sudo — see `docs/DECISIONS.md` 2026-07-22), state that explicitly rather than silently skipping this step, and report exactly what was verified by code/tests alone vs. what still needs the user's own visual confirmation before relying on it.

- [ ] **Step 3: Log the decision**

Append to `docs/DECISIONS.md`:

```
2026-07-23 | server,web | incident pins can be manually corrected (drag/manual coords/place search) or removed (hide-forever vs delete-forever), all gated behind the existing single-user auth session | explicit user request after the Derveni/Oraiokastro live miss — ingestion/rescan never revisit an already-stored external_id, so a fixed parser alone can't undo an already-wrong pin
```

- [ ] **Step 4: Commit**

```bash
git add docs/DECISIONS.md
git commit -m "docs(repo): log incident-pin-correction decision"
```

---

## Self-Review Notes (for whoever executes this plan)

- Do not push to `main` after finishing — pushing triggers a real production deploy (Portainer webhook). Stop after Task 8 and report status; the user pushes explicitly when ready.
- If `packages/server/src/jobs/updateBus.ts`'s publish method (Task 4, Step 3) turns out not to be named `publish`, use whatever it actually is throughout Task 4 — the design's intent (call it on every successful mutation) is what matters, not the exact method name assumed here.
