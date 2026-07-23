# 112 Civil Protection Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest `@112Greece`'s official civil-protection alerts (X/Twitter), geocode the named area to a point + best-effort boundary polygon, and surface them on the map as a distinct pin + area-highlight layer, with push notifications — without changing any existing detection/incident behavior.

**Architecture:** A fully parallel domain concept to `incident_reports` (own table/port/adapter/ingest-service/X-client/marker/layer-toggle), reusing existing infrastructure wherever the shape matches exactly (the same `X_BEARER_TOKEN`, the same `NominatimClient` instance extended with one new method, the same offline gazetteer, the same failure-log file format, the same push/scheduler/route wiring patterns).

**Tech Stack:** Same as the rest of the server package — Fastify, better-sqlite3, node-cron, X API v2 (app-only bearer), OpenStreetMap Nominatim (no key). Frontend: React + react-leaflet (GeoJSON layer, no new dependency).

## Global Constraints

- `pnpm -r build && pnpm test` must pass before every commit (CLAUDE.md §2) — no exceptions.
- No SQL outside `adapters/sqlite/`. No direct DB/HTTP inside `domain/`. Ports are interfaces; adapters implement them; services orchestrate (CLAUDE.md §3).
- All cross-package shared types live in `@pyrmap/shared`; never duplicate a type across packages.
- TypeScript strict; no `any` without `// any-ok: <reason>`; no `@ts-ignore`.
- Schema changes only via a **new** migration appended to `migrations.ts` — never edit a committed one.
- Tests must not hit the real FIRMS/X/Nominatim APIs — use fixtures and injected fakes. Tests must not depend on wall-clock time — inject `now`.
- Soft limit 300 lines/file.
- Every port interface and domain function gets a 1–3 line doc comment stating contract + units.
- Conventional Commits (`feat|fix|test|chore|refactor|docs(scope): message`), one commit per working unit.
- `@112Greece`'s numeric X user id is **`1187287012442804225`** (resolved via one live `GET /2/users/by/username/112Greece` call during planning — hardcode it, same pattern as `PYROSVESTIKI_USER_ID`).
- The regional-unit boundary polygon bundle has already been generated (52/54 regional units resolved via live Nominatim queries during planning) and is sitting at `/home/alex/.claude/jobs/aa58b45b/tmp/greeceRegionalUnitBoundaries.json` — Task 5 copies it into the repo, it is not regenerated.

---

### Task 1: Shared types & constants

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/constants.ts`
- Test: `packages/shared/src/types.test.ts` (new — this file doesn't exist yet; shared has no existing type-level tests, so this is a small new smoke test file, not a pattern break)

**Interfaces:**
- Produces: `AlertPrecision`, `GeoJsonPolygon`, `GeoJsonMultiPolygon`, `AlertAreaPolygon`, `CivilProtectionAlert`, `ALERT_112_SOURCE_ID`. `FiresResponse.alerts: CivilProtectionAlert[]`.

- [ ] **Step 1: Add the new types to `packages/shared/src/types.ts`**

Add after the existing `IncidentReport`-related block (after line 39, before `LocationSearchResult`):

```ts
/** How precisely a 112 alert's location was resolved: a named local area, or only the containing regional unit. */
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

/** An official civil-protection "112 activation" alert (e.g. @112Greece on X), geocoded from free
 * Greek text — structurally different from IncidentReport: any hazard type (not fire-only), and
 * carries a best-effort area polygon rather than just a point. */
export interface CivilProtectionAlert {
  id: number;
  source: string;
  text: string; // raw original Greek post text
  url: string;
  publishedAt: string; // ISO 8601 UTC
  latitude: number;
  longitude: number;
  precision: AlertPrecision;
  areaPolygon: AlertAreaPolygon | null;
}
```

Then modify `FiresResponse` (currently lines 48-53) to add the new field:

```ts
export interface FiresResponse {
  generatedAt: string; // ISO 8601 UTC
  polar: Detection[];
  geo: GeoDetection[];
  incidents: IncidentReport[];
  alerts: CivilProtectionAlert[];
}
```

- [ ] **Step 2: Add the source id constant to `packages/shared/src/constants.ts`**

Add after `PYROSVESTIKI_SOURCE_ID` (currently line 27):

```ts
/** Source id for @112Greece's official civil-protection "112 activation" alerts (X), geocoded from free text — any hazard type, not fire-specific. */
export const ALERT_112_SOURCE_ID = 'ALERT_112_X';
```

- [ ] **Step 3: Write a small smoke test**

Create `packages/shared/src/types.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { CivilProtectionAlert, GeoJsonPolygon } from './types.js';
import { ALERT_112_SOURCE_ID } from './constants.js';

describe('CivilProtectionAlert shape', () => {
  it('accepts a value with a null area polygon (point-only pin)', () => {
    const alert: CivilProtectionAlert = {
      id: 1,
      source: ALERT_112_SOURCE_ID,
      text: 't',
      url: 'u',
      publishedAt: '2026-07-23T00:00:00Z',
      latitude: 38.0,
      longitude: 23.0,
      precision: 'locality',
      areaPolygon: null,
    };
    expect(alert.areaPolygon).toBeNull();
  });

  it('accepts a value with a real Polygon area', () => {
    const polygon: GeoJsonPolygon = { type: 'Polygon', coordinates: [[[23.0, 38.0], [23.1, 38.0], [23.1, 38.1], [23.0, 38.0]]] };
    const alert: CivilProtectionAlert = {
      id: 2,
      source: ALERT_112_SOURCE_ID,
      text: 't',
      url: 'u',
      publishedAt: '2026-07-23T00:00:00Z',
      latitude: 38.05,
      longitude: 23.05,
      precision: 'locality',
      areaPolygon: polygon,
    };
    expect(alert.areaPolygon?.type).toBe('Polygon');
  });
});
```

- [ ] **Step 4: Build and run**

Run: `pnpm --filter @pyrmap/shared build && pnpm --filter @pyrmap/shared test`
Expected: build succeeds, both new tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/constants.ts packages/shared/src/types.test.ts
git commit -m "feat(shared): add CivilProtectionAlert types for the 112 alerts layer"
```

---

### Task 2: Migration, port, and SQLite adapter for civil protection alerts

**Files:**
- Modify: `packages/server/src/adapters/sqlite/migrations.ts`
- Create: `packages/server/src/ports/CivilProtectionAlertRepository.ts`
- Create: `packages/server/src/adapters/sqlite/SqliteCivilProtectionAlertRepository.ts`
- Test: `packages/server/test/SqliteCivilProtectionAlertRepository.test.ts`

**Interfaces:**
- Consumes: `AlertPrecision`, `CivilProtectionAlert`, `AlertAreaPolygon` from `@pyrmap/shared`.
- Produces: `NewAlertRow`, `AlertFetchLogEntry`, `CivilProtectionAlertRepository` interface; `SqliteCivilProtectionAlertRepository` class implementing it. Later tasks (ingest service, routes, index.ts) depend on these exact method names.

- [ ] **Step 1: Append the migration**

Add to the end of the `MIGRATIONS` array in `packages/server/src/adapters/sqlite/migrations.ts` (after the `incident_failed_posts` entry, before the closing `];`):

```ts
  `
  CREATE TABLE civil_protection_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id TEXT NOT NULL UNIQUE,
    source TEXT NOT NULL,
    text TEXT NOT NULL,
    url TEXT NOT NULL,
    published_at TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    precision TEXT NOT NULL CHECK (precision IN ('locality','regional_unit')),
    area_polygon TEXT,
    hidden INTEGER NOT NULL DEFAULT 0,
    ingested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );
  CREATE INDEX idx_civil_protection_alerts_published ON civil_protection_alerts (published_at);

  CREATE TABLE alert_failed_posts (
    source TEXT NOT NULL,
    external_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    text TEXT NOT NULL,
    first_seen_at TEXT NOT NULL,
    PRIMARY KEY (source, external_id)
  );
  `,
```

- [ ] **Step 2: Write the port**

Create `packages/server/src/ports/CivilProtectionAlertRepository.ts`:

```ts
import type { AlertAreaPolygon, AlertPrecision, CivilProtectionAlert } from '@pyrmap/shared';

export interface NewAlertRow {
  externalId: string;
  source: string;
  text: string;
  url: string;
  publishedAt: string; // ISO 8601 UTC
  latitude: number;
  longitude: number;
  precision: AlertPrecision;
  areaPolygon: AlertAreaPolygon | null;
}

export interface AlertFetchLogEntry {
  source: string;
  fetchedAt: string; // ISO 8601 UTC
  httpStatus: number | null;
  rowsParsed: number;
  rowsInserted: number;
  error: string | null;
}

/** Persists geocoded 112 alerts and fetch history. SQL lives only in the sqlite adapter implementing this port. */
export interface CivilProtectionAlertRepository {
  /** INSERT OR IGNORE on external_id; returns only the rows that were newly inserted. */
  insertAlerts(rows: NewAlertRow[]): NewAlertRow[];
  /** The largest external_id fully dealt with for a source (inserted OR permanently logged as a
   * failure), for since_id-style incremental polling. Null if none yet. Must include failed posts
   * too — see IncidentReportRepository.findLatestExternalId's doc comment for why. */
  findLatestExternalId(source: string): string | null;
  /** Records that (source, externalId) failed to resolve, if not already recorded. Returns true
   * the first time (caller should durably log it), false otherwise — one failure log entry per
   * unique post, ever. */
  recordFailedPostIfNew(source: string, externalId: string, reason: string, text: string, seenAtIso: string): boolean;
  /** Alerts with published_at >= sinceIso, newest first, excluding hidden ones. */
  findAlertsSince(sinceIso: string): CivilProtectionAlert[];
  /** external_ids for a source already stored with published_at >= sinceIso — for rescan's "skip what's already resolved" check. */
  findExternalIdsSince(source: string, sinceIso: string): Set<string>;
  /** Corrects a mis-geocoded alert's coordinates, clears its area polygon (a hand-placed point has
   * no known boundary), and marks it locality-precision. False if id doesn't exist. */
  updateAlertLocation(id: number, latitude: number, longitude: number): boolean;
  /** Marks an alert hidden forever: excluded from findAlertsSince, but the row (and its external_id) stays, permanently blocking re-insertion. False if id doesn't exist. */
  hideAlert(id: number): boolean;
  /** Removes an alert entirely — unlike hideAlert, its external_id can be re-inserted by a future poll/rescan. False if id doesn't exist. */
  deleteAlert(id: number): boolean;
  /** Shares the fetch_log table with FireRepository/IncidentReportRepository — same shape, so /api/status picks these up automatically. */
  recordFetchLog(entry: AlertFetchLogEntry): void;
  /** Deletes alerts with published_at < cutoffIso. Returns rows deleted. */
  deleteAlertsBefore(cutoffIso: string): number;
  close(): void;
}
```

- [ ] **Step 3: Write the SQLite adapter**

Create `packages/server/src/adapters/sqlite/SqliteCivilProtectionAlertRepository.ts`:

```ts
import Database, { type Database as DatabaseType } from 'better-sqlite3';
import type { AlertAreaPolygon, AlertPrecision, CivilProtectionAlert } from '@pyrmap/shared';
import type {
  AlertFetchLogEntry,
  CivilProtectionAlertRepository,
  NewAlertRow,
} from '../../ports/CivilProtectionAlertRepository.js';
import { runMigrations } from './migrations.js';

interface AlertRow {
  id: number;
  source: string;
  text: string;
  url: string;
  published_at: string;
  latitude: number;
  longitude: number;
  precision: string;
  area_polygon: string | null;
}

function rowToAlert(row: AlertRow): CivilProtectionAlert {
  return {
    id: row.id,
    source: row.source,
    text: row.text,
    url: row.url,
    publishedAt: row.published_at,
    latitude: row.latitude,
    longitude: row.longitude,
    precision: row.precision as AlertPrecision,
    areaPolygon: row.area_polygon ? (JSON.parse(row.area_polygon) as AlertAreaPolygon) : null,
  };
}

/** Own connection to the same DB file as the other repositories (WAL mode makes that safe) — kept
 * separate since 112 alerts are a structurally different concept (any hazard, official source,
 * area polygon) from incident_reports, mirroring why incident_reports itself is separate from
 * detections (docs/superpowers/specs/2026-07-23-112-civil-protection-alerts-design.md). */
export class SqliteCivilProtectionAlertRepository implements CivilProtectionAlertRepository {
  private readonly db: DatabaseType;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    runMigrations(this.db);
  }

  insertAlerts(rows: NewAlertRow[]): NewAlertRow[] {
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO civil_protection_alerts
        (external_id, source, text, url, published_at, latitude, longitude, precision, area_polygon)
      VALUES (@externalId, @source, @text, @url, @publishedAt, @latitude, @longitude, @precision, @areaPolygon)
    `);

    const insertedRows: NewAlertRow[] = [];
    const runAll = this.db.transaction((batch: NewAlertRow[]) => {
      for (const row of batch) {
        const params = { ...row, areaPolygon: row.areaPolygon ? JSON.stringify(row.areaPolygon) : null };
        if (insert.run(params).changes === 1) insertedRows.push(row);
      }
    });
    runAll(rows);

    return insertedRows;
  }

  findLatestExternalId(source: string): string | null {
    const row = this.db
      .prepare(
        `SELECT external_id FROM (
           SELECT external_id FROM civil_protection_alerts WHERE source = ?
           UNION ALL
           SELECT external_id FROM alert_failed_posts WHERE source = ?
         ) ORDER BY CAST(external_id AS INTEGER) DESC LIMIT 1`,
      )
      .get(source, source) as { external_id: string } | undefined;
    return row?.external_id ?? null;
  }

  recordFailedPostIfNew(source: string, externalId: string, reason: string, text: string, seenAtIso: string): boolean {
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO alert_failed_posts (source, external_id, reason, text, first_seen_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(source, externalId, reason, text, seenAtIso);
    return result.changes === 1;
  }

  findAlertsSince(sinceIso: string): CivilProtectionAlert[] {
    const rows = this.db
      .prepare(`SELECT * FROM civil_protection_alerts WHERE published_at >= ? AND hidden = 0 ORDER BY published_at DESC`)
      .all(sinceIso) as AlertRow[];
    return rows.map(rowToAlert);
  }

  findExternalIdsSince(source: string, sinceIso: string): Set<string> {
    const rows = this.db
      .prepare('SELECT external_id FROM civil_protection_alerts WHERE source = ? AND published_at >= ?')
      .all(source, sinceIso) as { external_id: string }[];
    return new Set(rows.map((row) => row.external_id));
  }

  updateAlertLocation(id: number, latitude: number, longitude: number): boolean {
    return (
      this.db
        .prepare(
          `UPDATE civil_protection_alerts SET latitude = ?, longitude = ?, precision = 'locality', area_polygon = NULL WHERE id = ?`,
        )
        .run(latitude, longitude, id).changes === 1
    );
  }

  hideAlert(id: number): boolean {
    return this.db.prepare('UPDATE civil_protection_alerts SET hidden = 1 WHERE id = ?').run(id).changes === 1;
  }

  deleteAlert(id: number): boolean {
    return this.db.prepare('DELETE FROM civil_protection_alerts WHERE id = ?').run(id).changes === 1;
  }

  recordFetchLog(entry: AlertFetchLogEntry): void {
    this.db
      .prepare(
        `INSERT INTO fetch_log (source, fetched_at, http_status, rows_parsed, rows_inserted, error)
         VALUES (@source, @fetchedAt, @httpStatus, @rowsParsed, @rowsInserted, @error)`,
      )
      .run(entry);
  }

  deleteAlertsBefore(cutoffIso: string): number {
    return this.db.prepare('DELETE FROM civil_protection_alerts WHERE published_at < ?').run(cutoffIso).changes;
  }

  close(): void {
    this.db.close();
  }
}
```

- [ ] **Step 4: Write the failing tests first, then verify they pass**

Create `packages/server/test/SqliteCivilProtectionAlertRepository.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteCivilProtectionAlertRepository } from '../src/adapters/sqlite/SqliteCivilProtectionAlertRepository.js';
import type { NewAlertRow } from '../src/ports/CivilProtectionAlertRepository.js';

let tmpDir: string;
let repo: SqliteCivilProtectionAlertRepository;

const BASE_ROW: NewAlertRow = {
  externalId: '1',
  source: 'ALERT_112_X',
  text: 't',
  url: 'u',
  publishedAt: '2026-07-23T10:00:00Z',
  latitude: 38.0,
  longitude: 23.0,
  precision: 'locality',
  areaPolygon: null,
};

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'pyrmap-alertrepo-test-'));
  repo = new SqliteCivilProtectionAlertRepository(path.join(tmpDir, 'test.db'));
});

afterEach(() => {
  repo.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('SqliteCivilProtectionAlertRepository', () => {
  it('inserts a row with a null area polygon and reads it back', () => {
    repo.insertAlerts([BASE_ROW]);
    const [found] = repo.findAlertsSince('2026-07-23T00:00:00Z');
    expect(found).toMatchObject({ latitude: 38.0, longitude: 23.0, precision: 'locality', areaPolygon: null });
  });

  it('inserts a row with a real polygon and round-trips it through JSON', () => {
    const polygon = { type: 'Polygon' as const, coordinates: [[[23.0, 38.0], [23.1, 38.0], [23.1, 38.1], [23.0, 38.0]]] };
    repo.insertAlerts([{ ...BASE_ROW, areaPolygon: polygon }]);
    const [found] = repo.findAlertsSince('2026-07-23T00:00:00Z');
    expect(found!.areaPolygon).toEqual(polygon);
  });

  it('ignores a duplicate external_id', () => {
    repo.insertAlerts([BASE_ROW]);
    const second = repo.insertAlerts([BASE_ROW]);
    expect(second).toHaveLength(0);
    expect(repo.findAlertsSince('2026-07-23T00:00:00Z')).toHaveLength(1);
  });

  it('findLatestExternalId considers both stored alerts and failed posts', () => {
    repo.insertAlerts([{ ...BASE_ROW, externalId: '100' }]);
    repo.recordFailedPostIfNew('ALERT_112_X', '200', 'no-location', 't', '2026-07-23T10:01:00Z');
    expect(repo.findLatestExternalId('ALERT_112_X')).toBe('200');
  });

  it('recordFailedPostIfNew returns true once, then false for the same (source, externalId)', () => {
    expect(repo.recordFailedPostIfNew('ALERT_112_X', '1', 'no-location', 't', '2026-07-23T10:00:00Z')).toBe(true);
    expect(repo.recordFailedPostIfNew('ALERT_112_X', '1', 'no-location', 't', '2026-07-23T10:00:00Z')).toBe(false);
  });

  it('updateAlertLocation clears the area polygon and sets locality precision', () => {
    const polygon = { type: 'Polygon' as const, coordinates: [[[23.0, 38.0], [23.1, 38.0], [23.1, 38.1], [23.0, 38.0]]] };
    repo.insertAlerts([{ ...BASE_ROW, precision: 'regional_unit', areaPolygon: polygon }]);
    const [before] = repo.findAlertsSince('2026-07-23T00:00:00Z');
    expect(repo.updateAlertLocation(before!.id, 39.0, 24.0)).toBe(true);
    const [after] = repo.findAlertsSince('2026-07-23T00:00:00Z');
    expect(after).toMatchObject({ latitude: 39.0, longitude: 24.0, precision: 'locality', areaPolygon: null });
  });

  it('updateAlertLocation returns false for a nonexistent id', () => {
    expect(repo.updateAlertLocation(999, 1, 1)).toBe(false);
  });

  it('hideAlert excludes the row from findAlertsSince but keeps blocking its external_id', () => {
    repo.insertAlerts([BASE_ROW]);
    const [before] = repo.findAlertsSince('2026-07-23T00:00:00Z');
    expect(repo.hideAlert(before!.id)).toBe(true);
    expect(repo.findAlertsSince('2026-07-23T00:00:00Z')).toHaveLength(0);
    expect(repo.insertAlerts([BASE_ROW])).toHaveLength(0);
  });

  it('deleteAlert removes the row entirely, allowing the same external_id to be re-inserted', () => {
    repo.insertAlerts([BASE_ROW]);
    const [before] = repo.findAlertsSince('2026-07-23T00:00:00Z');
    expect(repo.deleteAlert(before!.id)).toBe(true);
    expect(repo.insertAlerts([BASE_ROW])).toHaveLength(1);
  });

  it('findExternalIdsSince filters by source and sinceIso', () => {
    repo.insertAlerts([
      { ...BASE_ROW, externalId: '1', source: 'A', publishedAt: '2026-07-22T10:00:00Z' },
      { ...BASE_ROW, externalId: '2', source: 'A', publishedAt: '2026-07-23T10:00:00Z' },
      { ...BASE_ROW, externalId: '3', source: 'B', publishedAt: '2026-07-23T10:00:00Z' },
    ]);
    expect(repo.findExternalIdsSince('A', '2026-07-23T00:00:00Z')).toEqual(new Set(['2']));
  });

  it('deleteAlertsBefore removes only rows older than the cutoff', () => {
    repo.insertAlerts([
      { ...BASE_ROW, externalId: '1', publishedAt: '2026-07-01T00:00:00Z' },
      { ...BASE_ROW, externalId: '2', publishedAt: '2026-07-23T00:00:00Z' },
    ]);
    expect(repo.deleteAlertsBefore('2026-07-15T00:00:00Z')).toBe(1);
    expect(repo.findAlertsSince('2026-01-01T00:00:00Z')).toHaveLength(1);
  });
});
```

- [ ] **Step 5: Run tests, build, verify**

Run: `pnpm --filter @pyrmap/server build && pnpm --filter @pyrmap/server test -- SqliteCivilProtectionAlertRepository`
Expected: build succeeds, all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/adapters/sqlite/migrations.ts packages/server/src/ports/CivilProtectionAlertRepository.ts packages/server/src/adapters/sqlite/SqliteCivilProtectionAlertRepository.ts packages/server/test/SqliteCivilProtectionAlertRepository.test.ts
git commit -m "feat(server): add civil_protection_alerts table, port, and SQLite adapter"
```

---

### Task 3: Parsing domain — `isAlert112Post` / `extractAlertAreas`

**Files:**
- Create: `packages/server/src/domain/alert112Parsing.ts`
- Test: `packages/server/test/alert112Parsing.test.ts`

**Interfaces:**
- Produces: `isAlert112Post(text: string): boolean`, `extractAlertAreas(text: string): AlertAreas | null`, `interface AlertAreas { locality: string | null; regionGenitive: string }`. Consumed by Task 7 (geocoding orchestration) and Task 8 (ingest service).

- [ ] **Step 1: Write the domain module**

Create `packages/server/src/domain/alert112Parsing.ts`:

```ts
// Greek letters incl. accented forms, plus underscore (hashtags join multi-word place names with
// "_" since X hashtags can't contain spaces, e.g. "#Πάτημα_Κορωπίου").
const GREEK_WORD = 'Α-Ωα-ωΆΈΉΊΌΎΏΪΫάέήίόύώϊϋΐΰ';
const HASHTAG = `#([${GREEK_WORD}_]+)`;
// "Περιφερειακής Ενότητας" (regional unit, genitive) or "Περιφέρειας" (periphery, genitive) — the
// account uses whichever is the natural containing administrative level for the named area (a
// periphery for island groups/Attica-wide alerts, a regional unit otherwise).
const CONTAINER = '(?:Περιφερειακής\\s+Ενότητας|Περιφέρειας)';

const LOCALITY_AND_REGION_RE = new RegExp(`στην\\s+περιοχή\\s+${HASHTAG}\\s+της\\s+${CONTAINER}\\s+${HASHTAG}`, 'u');
const REGION_ONLY_RE = new RegExp(`${CONTAINER}\\s+${HASHTAG}`, 'u');

/**
 * True iff the post is a real 112 activation, written in Greek. @112Greece posts every alert
 * twice — once in Greek, once in English ("Activation" instead of "Ενεργοποίηση") — within the
 * same minute; requiring the literal Greek header word both identifies a genuine activation AND
 * skips the English duplicate for free, with no cross-language timestamp matching needed.
 */
export function isAlert112Post(text: string): boolean {
  return /Ενεργοποίηση/u.test(text);
}

export interface AlertAreas {
  /** The specific local area named (hashtag, underscores expanded to spaces), or null if the post only names a containing region. */
  locality: string | null;
  /** The containing regional unit or periphery name, in genitive case as written (hashtag, underscores expanded to spaces). */
  regionGenitive: string;
}

function unhashtag(raw: string): string {
  return raw.replace(/_/g, ' ');
}

/**
 * Extracts the alert's area from the standard "στην περιοχή #X της {Περιφερειακής
 * Ενότητας|Περιφέρειας} #Y" template. Falls back to a region-only match (no "στην περιοχή"
 * clause at all) when the post names only the containing region — the caller then geocodes to
 * that region's centroid/polygon instead of a specific locality. Returns null when neither
 * pattern is found (the caller's signal to skip the post as unresolvable, same convention as
 * incidentParsing.ts's extractLocationPhrase).
 */
export function extractAlertAreas(text: string): AlertAreas | null {
  const withLocality = LOCALITY_AND_REGION_RE.exec(text);
  if (withLocality) {
    return { locality: unhashtag(withLocality[1]!), regionGenitive: unhashtag(withLocality[2]!) };
  }

  const regionOnly = REGION_ONLY_RE.exec(text);
  if (regionOnly) {
    return { locality: null, regionGenitive: unhashtag(regionOnly[1]!) };
  }

  return null;
}
```

- [ ] **Step 2: Write tests using the real post text from the user's paste**

Create `packages/server/test/alert112Parsing.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { extractAlertAreas, isAlert112Post } from '../src/domain/alert112Parsing.js';

// Real posts from @112Greece, pasted live by the user 2026-07-23.
const GREEK_DERVENI =
  '⚠️Ενεργοποίηση 1⃣1⃣2⃣\n\n🆘 Πυρκαγιά στην περιοχή #Δερβένι της Περιφερειακής Ενότητας #Θεσσαλονίκης\n\n‼️ Καπνοί κατευθύνονται στην περιοχή\n\n‼️ Παραμείνετε σε εσωτερικούς χώρου, κλείστε πόρτες & παράθυρα\n\n‼️ Παραμείνετε σε ετοιμότητα και ακολουθείτε τις οδηγίες των Αρχών\n\nℹ️';
const ENGLISH_DERVENI =
  '⚠️Activation 1⃣1⃣2⃣\n\n🆘 Fire in #Derveni area of the regional unit of #Thessaloniki\n\n‼️ The smoke is heading towards your area\n\n‼️ Stay indoors, close doors & windows\n\n‼️ Stay alert and follow the instructions of the Authorities\n\nℹ️ https://civilprotection.gov.gr/112/odigies-prostasias\n\n@pyrosvestiki';
const GREEK_KALLIGATA =
  '⚠️ Ενεργοποίηση 1️⃣1️⃣2️⃣\n\n🆘 Πυρκαγιά στην περιοχή #Καλλιγάτα της Περιφερειακής Ενότητας #Κεφαλληνίας\n\n‼️ Παραμείνετε σε ετοιμότητα και ακολουθείτε τις οδηγίες των Αρχών \n\nℹ️ https://civilprotection.gov.gr/112/odigies-prostasias\n\n@pyrosvestiki\n\n\n@hellenicpolice';
const GREEK_PATIMA_KOROPIOU =
  '⚠️Ενεργοποίηση 1⃣1⃣2⃣\n\n🆘 Πυρκαγιά στην περιοχή #Πάτημα_Κορωπίου της Περιφέρειας #Αττικής\n\n‼️ Παραμείνετε σε ετοιμότητα και ακολουθείτε τις οδηγίες των Αρχών\n\nℹ️ https://civilprotection.gov.gr/112/odigies-prostasias\n\n@pyrosvestiki';

describe('isAlert112Post', () => {
  it('accepts the Greek activation post', () => {
    expect(isAlert112Post(GREEK_DERVENI)).toBe(true);
  });

  it('rejects the English duplicate of the same alert', () => {
    expect(isAlert112Post(ENGLISH_DERVENI)).toBe(false);
  });

  it('rejects unrelated text with no activation header', () => {
    expect(isAlert112Post('Καλημέρα σε όλους')).toBe(false);
  });
});

describe('extractAlertAreas', () => {
  it('extracts locality + regional unit from the standard template', () => {
    expect(extractAlertAreas(GREEK_DERVENI)).toEqual({ locality: 'Δερβένι', regionGenitive: 'Θεσσαλονίκης' });
  });

  it('extracts locality + regional unit with the double-emoji header variant', () => {
    expect(extractAlertAreas(GREEK_KALLIGATA)).toEqual({ locality: 'Καλλιγάτα', regionGenitive: 'Κεφαλληνίας' });
  });

  it('extracts locality + periphery (not regional unit) when the post uses "Περιφέρειας"', () => {
    expect(extractAlertAreas(GREEK_PATIMA_KOROPIOU)).toEqual({ locality: 'Πάτημα Κορωπίου', regionGenitive: 'Αττικής' });
  });

  it('expands an underscore-joined multi-word hashtag to spaces', () => {
    const { locality } = extractAlertAreas(GREEK_PATIMA_KOROPIOU)!;
    expect(locality).not.toContain('_');
  });

  it('falls back to region-only when there is no "στην περιοχή #X" clause', () => {
    const text = '⚠️Ενεργοποίηση 1⃣1⃣2⃣\n\n🆘 Έκτακτο δελτίο για την Περιφερειακή Ενότητα #Ηλείας\n\nℹ️';
    expect(extractAlertAreas(text)).toEqual({ locality: null, regionGenitive: 'Ηλείας' });
  });

  it('returns null when neither pattern matches', () => {
    expect(extractAlertAreas('⚠️Ενεργοποίηση 1⃣1⃣2⃣\n\n🆘 Γενική ενημέρωση χωρίς συγκεκριμένη περιοχή.')).toBeNull();
  });
});
```

- [ ] **Step 3: Run and verify**

Run: `pnpm --filter @pyrmap/server test -- alert112Parsing`
Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/domain/alert112Parsing.ts packages/server/test/alert112Parsing.test.ts
git commit -m "feat(server): parse 112 activation posts into locality/region areas"
```

---

### Task 4: Additive export from `incidentGeocoding.ts` — `findRegionalUnit`

**Files:**
- Modify: `packages/server/src/domain/incidentGeocoding.ts`
- Test: `packages/server/test/incidentGeocoding.test.ts` (append, do not remove/change any existing test)

**Interfaces:**
- Produces: `export interface RegionalUnit { nominative: string | null; genitives: string[]; lat: number; lon: number }` (promote the existing internal interface to exported), `export function findRegionalUnit(name: string): RegionalUnit | null`. Consumed by Task 7.

- [ ] **Step 1: Export the existing `RegionalUnit` interface and add `findRegionalUnit`**

In `packages/server/src/domain/incidentGeocoding.ts`, change line 5 from:

```ts
interface RegionalUnit {
```

to:

```ts
export interface RegionalUnit {
```

Then add this new function right after the `regionByName` map is built (after line 41, before the `settlementsByName` block):

```ts
/**
 * Looks up a regional unit by its genitive or nominative name (accent-insensitive), independent
 * of the full settlement-geocoding pipeline — used when a caller needs to know WHICH unit matched
 * (e.g. to key a pre-bundled boundary polygon by its nominative name), not just its coordinates.
 */
export function findRegionalUnit(name: string): RegionalUnit | null {
  return regionByName.get(foldAccents(name)) ?? null;
}
```

- [ ] **Step 2: Add a test, appended to the existing file — do not modify any existing test**

Append to `packages/server/test/incidentGeocoding.test.ts`:

```ts
describe('findRegionalUnit', () => {
  it('resolves a known regional unit by its genitive form', () => {
    const unit = findRegionalUnit('Θεσσαλονίκης');
    expect(unit).toMatchObject({ nominative: 'Θεσσαλονίκη' });
  });

  it('returns null for a name that matches no regional unit', () => {
    expect(findRegionalUnit('Κυκλάδων')).not.toBeNull(); // Κυκλάδες IS in the gazetteer (54 units) even though it has no boundary polygon (Task 5)
    expect(findRegionalUnit('Ανύπαρκτης')).toBeNull();
  });
});
```

Add `findRegionalUnit` to the existing top-of-file import line for this test file (find the line importing from `'../src/domain/incidentGeocoding.js'` and add `findRegionalUnit` to the destructured import list — do not otherwise change that import line's existing names).

- [ ] **Step 3: Run and verify — including the FULL existing suite for this file, to prove nothing broke**

Run: `pnpm --filter @pyrmap/server test -- incidentGeocoding`
Expected: every existing test in the file still PASSES, plus the 2 new ones.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/domain/incidentGeocoding.ts packages/server/test/incidentGeocoding.test.ts
git commit -m "feat(server): export findRegionalUnit for the 112 alerts polygon fallback"
```

---

### Task 5: Regional-unit boundary polygon bundle

**Files:**
- Create: `packages/server/src/domain/data/greeceRegionalUnitBoundaries.json` (copy of the pre-generated file at `/home/alex/.claude/jobs/aa58b45b/tmp/greeceRegionalUnitBoundaries.json`)
- Create: `packages/server/src/domain/regionalUnitBoundaries.ts`
- Test: `packages/server/test/regionalUnitBoundaries.test.ts`

**Interfaces:**
- Produces: `findRegionalUnitBoundary(nominative: string): AlertAreaPolygon | null`. Consumed by Task 7.

- [ ] **Step 1: Copy the pre-generated boundary data into the repo**

```bash
cp /home/alex/.claude/jobs/aa58b45b/tmp/greeceRegionalUnitBoundaries.json packages/server/src/domain/data/greeceRegionalUnitBoundaries.json
```

This is a `Record<string, GeoJsonPolygon | GeoJsonMultiPolygon>` keyed by each regional unit's exact `nominative` string from `greeceRegionalUnits.json` (52 of the 54 units resolved to a real OSM administrative boundary via live Nominatim queries during planning, simplified with `polygon_threshold=0.005`; `Κυκλάδες` and `Αττική` have no entry — both are periphery-level groupings with no single corresponding OSM regional-unit polygon, a documented known gap, not a bug).

- [ ] **Step 2: Write the loader module**

Create `packages/server/src/domain/regionalUnitBoundaries.ts`:

```ts
import type { AlertAreaPolygon } from '@pyrmap/shared';
import boundariesData from './data/greeceRegionalUnitBoundaries.json' with { type: 'json' };

const boundariesByNominative = boundariesData as Record<string, AlertAreaPolygon>;

/**
 * Looks up a regional unit's pre-bundled boundary polygon by its exact nominative name (as found
 * in domain/data/greeceRegionalUnits.json). Returns null for the ~2 of 54 units with no single
 * corresponding OSM administrative polygon (periphery-level groupings like Κυκλάδες/Αττική) —
 * callers must treat this as "no polygon available", not an error.
 */
export function findRegionalUnitBoundary(nominative: string): AlertAreaPolygon | null {
  return boundariesByNominative[nominative] ?? null;
}
```

- [ ] **Step 3: Write tests**

Create `packages/server/test/regionalUnitBoundaries.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { findRegionalUnitBoundary } from '../src/domain/regionalUnitBoundaries.js';

describe('findRegionalUnitBoundary', () => {
  it('returns a real polygon for a resolved regional unit', () => {
    const polygon = findRegionalUnitBoundary('Θεσσαλονίκη');
    expect(polygon).not.toBeNull();
    expect(['Polygon', 'MultiPolygon']).toContain(polygon!.type);
    expect(polygon!.coordinates.length).toBeGreaterThan(0);
  });

  it('returns null for a documented gap (periphery-level grouping, not a single regional unit)', () => {
    expect(findRegionalUnitBoundary('Κυκλάδες')).toBeNull();
  });

  it('returns null for an unknown name', () => {
    expect(findRegionalUnitBoundary('Not A Real Unit')).toBeNull();
  });
});
```

- [ ] **Step 4: Run and verify**

Run: `pnpm --filter @pyrmap/server test -- regionalUnitBoundaries`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/domain/data/greeceRegionalUnitBoundaries.json packages/server/src/domain/regionalUnitBoundaries.ts packages/server/test/regionalUnitBoundaries.test.ts
git commit -m "feat(server): bundle regional-unit boundary polygons for 112 alert area highlighting"
```

---

### Task 6: `AreaPolygonSource` port + `NominatimClient.findAreaPolygon`

**Files:**
- Create: `packages/server/src/ports/AreaPolygonSource.ts`
- Modify: `packages/server/src/adapters/nominatim/NominatimClient.ts`
- Test: `packages/server/test/NominatimClient.test.ts` (append, do not remove/change any existing test)

**Interfaces:**
- Consumes: `AlertAreaPolygon` from `@pyrmap/shared`.
- Produces: `AreaPolygonSource.findAreaPolygon(query: string): Promise<AlertAreaPolygon | null>`, implemented by `NominatimClient`. Consumed by Task 7.

- [ ] **Step 1: Write the port**

Create `packages/server/src/ports/AreaPolygonSource.ts`:

```ts
import type { AlertAreaPolygon } from '@pyrmap/shared';

/** Best-effort boundary polygon for a free-text place-name query, for highlighting an area on the
 * map rather than just pinning a point. Returns null if the service found nothing, was
 * unreachable, timed out, or the top trusted-type match has no real boundary geometry (common for
 * small OSM-mapped hamlets stored as a point node, not a way/relation). */
export interface AreaPolygonSource {
  findAreaPolygon(query: string): Promise<AlertAreaPolygon | null>;
}
```

- [ ] **Step 2: Extend `NominatimClient` — additive only, no change to existing `geocode`/`search` behavior**

In `packages/server/src/adapters/nominatim/NominatimClient.ts`:

Add the import at the top (alongside the existing imports):

```ts
import type { AlertAreaPolygon } from '@pyrmap/shared';
import type { AreaPolygonSource } from '../../ports/AreaPolygonSource.js';
```

Change the `NominatimResult` interface (currently lines 30-35) to add an optional `geojson` field:

```ts
interface NominatimResult {
  lat: string;
  lon: string;
  addresstype?: string;
  display_name?: string;
  geojson?: { type: string; coordinates: unknown };
}
```

Change the class declaration line from:

```ts
export class NominatimClient implements GeocodingSource, LocationSearchSource {
```

to:

```ts
export class NominatimClient implements GeocodingSource, LocationSearchSource, AreaPolygonSource {
```

Change the private `fetchResults` method signature to accept optional extra params — this is additive (default `{}` reproduces today's exact query for the two existing callers, `geocode` and `search`, which are NOT modified):

```ts
  private async fetchResults(query: string, extraParams: Record<string, string> = {}): Promise<NominatimResult[]> {
    const waitMs = this.lastCallAt + MIN_INTERVAL_MS - this.now();
    if (waitMs > 0) await this.sleep(waitMs);
    this.lastCallAt = this.now();

    const params = new URLSearchParams({
      q: query,
      format: 'jsonv2',
      countrycodes: 'gr',
      limit: String(RESULT_LIMIT),
      ...extraParams,
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
```

Add the new method at the end of the class, after `search`:

```ts
  /** Requests Nominatim's polygon_geojson output (simplified — a highlighted area doesn't need
   * survey-grade precision) alongside the normal search, and returns the first trusted-type
   * result's boundary geometry, if it has one. Shares this client's rate limiter with geocode()
   * and search() — same instance, same ~1 req/sec budget. */
  async findAreaPolygon(query: string): Promise<AlertAreaPolygon | null> {
    const results = await this.fetchResults(query, { polygon_geojson: '1', polygon_threshold: '0.005' });

    for (const result of results) {
      const addressType = result.addresstype ?? '';
      if (!SETTLEMENT_ADDRESS_TYPES.has(addressType) && !REGION_ADDRESS_TYPES.has(addressType)) continue;

      const geojson = result.geojson;
      if (!geojson) continue;
      if (geojson.type === 'Polygon') return { type: 'Polygon', coordinates: geojson.coordinates as number[][][] };
      if (geojson.type === 'MultiPolygon') return { type: 'MultiPolygon', coordinates: geojson.coordinates as number[][][][] };
    }

    return null;
  }
```

- [ ] **Step 3: Append tests — do not touch any existing test in this file**

Append to `packages/server/test/NominatimClient.test.ts` (check the top of the file for its existing `fakeFetch`/response-building helper pattern and reuse it; if the file builds a `Response` from a JSON array directly, follow that exact convention):

```ts
describe('findAreaPolygon', () => {
  it('returns a Polygon from a trusted-type result that has real boundary geometry', async () => {
    const results = [
      {
        lat: '40.64',
        lon: '22.94',
        addresstype: 'county',
        display_name: 'Περιφερειακή Ενότητα Θεσσαλονίκης',
        geojson: { type: 'Polygon', coordinates: [[[22.9, 40.6], [23.0, 40.6], [23.0, 40.7], [22.9, 40.6]]] },
      },
    ];
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(results), { status: 200 })) as unknown as typeof fetch;
    const client = new NominatimClient(fetchImpl, () => 0, async () => undefined);

    const polygon = await client.findAreaPolygon('Περιφερειακή Ενότητα Θεσσαλονίκης');
    expect(polygon).toEqual({ type: 'Polygon', coordinates: [[[22.9, 40.6], [23.0, 40.6], [23.0, 40.7], [22.9, 40.6]]] });
  });

  it('returns null when the trusted-type result has no geojson (a point node, not a way/relation)', async () => {
    const results = [{ lat: '40.64', lon: '22.94', addresstype: 'city', display_name: 'x', geojson: { type: 'Point', coordinates: [22.94, 40.64] } }];
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(results), { status: 200 })) as unknown as typeof fetch;
    const client = new NominatimClient(fetchImpl, () => 0, async () => undefined);

    expect(await client.findAreaPolygon('somewhere')).toBeNull();
  });

  it('skips an untrusted addresstype (e.g. a road) even if it has a geometry', async () => {
    const results = [
      { lat: '40.64', lon: '22.94', addresstype: 'road', geojson: { type: 'LineString', coordinates: [[22.9, 40.6], [23.0, 40.6]] } },
    ];
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(results), { status: 200 })) as unknown as typeof fetch;
    const client = new NominatimClient(fetchImpl, () => 0, async () => undefined);

    expect(await client.findAreaPolygon('somewhere')).toBeNull();
  });

  it('requests polygon_geojson=1 without changing what geocode() itself requests', async () => {
    const fetchImpl = vi.fn(async () => new Response('[]', { status: 200 })) as unknown as typeof fetch;
    const client = new NominatimClient(fetchImpl, () => 0, async () => undefined);

    await client.geocode('x');
    await client.findAreaPolygon('y');

    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit?][];
    expect(String(calls[0]![0])).not.toContain('polygon_geojson');
    expect(String(calls[1]![0])).toContain('polygon_geojson=1');
  });
});
```

(If the existing test file's `NominatimClient` constructor calls, fake-fetch helper, or import list differ from the guess above, match the file's actual existing conventions instead — the important behaviors to prove are: trusted-type + real geometry → polygon returned; no geometry → null; untrusted type → null; `geocode()`'s own request is unaffected by the new method existing.)

- [ ] **Step 4: Run and verify — including the full existing file's tests**

Run: `pnpm --filter @pyrmap/server test -- NominatimClient`
Expected: every existing test still PASSES, plus the 4 new ones.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/ports/AreaPolygonSource.ts packages/server/src/adapters/nominatim/NominatimClient.ts packages/server/test/NominatimClient.test.ts
git commit -m "feat(server): add best-effort area-polygon lookup to NominatimClient"
```

---

### Task 7: Geocoding orchestration — `alert112Geocoding.ts`

**Files:**
- Create: `packages/server/src/domain/alert112Geocoding.ts`
- Test: `packages/server/test/alert112Geocoding.test.ts`

**Interfaces:**
- Consumes: `geocodeGreekLocation`, `findRegionalUnit` (Task 4), `findRegionalUnitBoundary` (Task 5), `GeocodingSource` port, `AreaPolygonSource` port (Task 6), `AlertPrecision`/`AlertAreaPolygon` from `@pyrmap/shared`.
- Produces: `geocodeAlertArea(locality, regionGenitive, geocodingSource?, polygonSource?): Promise<AlertGeocodeResult | null>`. Consumed by Task 8.

- [ ] **Step 1: Write the domain module**

Create `packages/server/src/domain/alert112Geocoding.ts`:

```ts
import type { AlertAreaPolygon, AlertPrecision } from '@pyrmap/shared';
import { findRegionalUnit, geocodeGreekLocation } from './incidentGeocoding.js';
import { findRegionalUnitBoundary } from './regionalUnitBoundaries.js';
import type { GeocodingSource } from '../ports/GeocodingSource.js';
import type { AreaPolygonSource } from '../ports/AreaPolygonSource.js';

export interface AlertGeocodeResult {
  latitude: number;
  longitude: number;
  precision: AlertPrecision;
  areaPolygon: AlertAreaPolygon | null;
}

/**
 * Resolves a 112 alert's parsed area (domain/alert112Parsing.ts) to a point (for the pin) and,
 * best-effort, a boundary polygon (for the map highlight): a named locality's own OSM boundary
 * when one exists, else the containing regional unit's pre-bundled polygon, else no polygon at
 * all (point pin only) if even the regional unit is outside our 54-entry gazetteer. Point
 * resolution reuses the exact same live-Nominatim-then-offline-gazetteer chain incident reports
 * already use — see docs/superpowers/specs/2026-07-23-112-civil-protection-alerts-design.md.
 */
export async function geocodeAlertArea(
  locality: string | null,
  regionGenitive: string,
  geocodingSource: GeocodingSource | undefined,
  polygonSource: AreaPolygonSource | undefined,
): Promise<AlertGeocodeResult | null> {
  if (locality) {
    const query = `${locality} ${regionGenitive}`;
    const geocoded =
      (geocodingSource ? await geocodingSource.geocode(query) : null) ?? geocodeGreekLocation(locality, regionGenitive);

    if (geocoded) {
      const precision: AlertPrecision = geocoded.precision === 'settlement' ? 'locality' : 'regional_unit';
      const localityPolygon = precision === 'locality' && polygonSource ? await polygonSource.findAreaPolygon(query) : null;
      const regionalUnit = findRegionalUnit(regionGenitive);
      const fallbackPolygon = regionalUnit?.nominative ? findRegionalUnitBoundary(regionalUnit.nominative) : null;

      return {
        latitude: geocoded.latitude,
        longitude: geocoded.longitude,
        precision,
        areaPolygon: localityPolygon ?? fallbackPolygon,
      };
    }
  }

  const regionalUnit = findRegionalUnit(regionGenitive);
  if (!regionalUnit) return null;

  return {
    latitude: regionalUnit.lat,
    longitude: regionalUnit.lon,
    precision: 'regional_unit',
    areaPolygon: regionalUnit.nominative ? findRegionalUnitBoundary(regionalUnit.nominative) : null,
  };
}
```

- [ ] **Step 2: Write tests with injected fakes (no real network calls)**

Create `packages/server/test/alert112Geocoding.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { geocodeAlertArea } from '../src/domain/alert112Geocoding.js';
import type { GeocodingSource } from '../src/ports/GeocodingSource.js';
import type { AreaPolygonSource } from '../src/ports/AreaPolygonSource.js';

const FAKE_POLYGON = { type: 'Polygon' as const, coordinates: [[[23.0, 38.0], [23.1, 38.0], [23.1, 38.1], [23.0, 38.0]]] };

describe('geocodeAlertArea', () => {
  it('resolves locality + region via the offline gazetteer when no geocodingSource is given, with a locality polygon', async () => {
    const polygonSource: AreaPolygonSource = { findAreaPolygon: async () => FAKE_POLYGON };
    const result = await geocodeAlertArea('Κορωπί', 'Αττικής', undefined, polygonSource);
    expect(result).toMatchObject({ precision: 'locality', areaPolygon: FAKE_POLYGON });
  });

  it('falls back to the regional unit polygon when the locality has no polygon of its own', async () => {
    const polygonSource: AreaPolygonSource = { findAreaPolygon: async () => null };
    const result = await geocodeAlertArea('Κορωπί', 'Αττικής', undefined, polygonSource);
    expect(result!.precision).toBe('locality');
    expect(result!.areaPolygon).not.toBeNull(); // Αττικής's bundled regional-unit polygon (or its own known gap, per Task 5's known-gaps list — Attica IS one of the two)
  });

  it('prefers a configured geocodingSource result over the offline gazetteer', async () => {
    const geocodingSource: GeocodingSource = { geocode: async () => ({ latitude: 1.1, longitude: 2.2, precision: 'settlement' }) };
    const result = await geocodeAlertArea('Κορωπί', 'Αττικής', geocodingSource, undefined);
    expect(result).toMatchObject({ latitude: 1.1, longitude: 2.2, precision: 'locality' });
  });

  it('resolves region-only (no locality named) directly to the regional unit, with its bundled polygon', async () => {
    const result = await geocodeAlertArea(null, 'Θεσσαλονίκης', undefined, undefined);
    expect(result!.precision).toBe('regional_unit');
    expect(result!.areaPolygon).not.toBeNull();
  });

  it('returns null when neither the locality nor the region resolves to anything', async () => {
    const geocodingSource: GeocodingSource = { geocode: async () => null };
    const result = await geocodeAlertArea('Ανύπαρκτο Χωριό', 'Ανύπαρκτης', geocodingSource, undefined);
    expect(result).toBeNull();
  });

  it('returns null for a region-only post whose region is not in the 54-unit gazetteer', async () => {
    expect(await geocodeAlertArea(null, 'Ανύπαρκτης', undefined, undefined)).toBeNull();
  });

  it('never calls polygonSource when precision comes out regional_unit from the locality branch', async () => {
    let called = false;
    const polygonSource: AreaPolygonSource = {
      findAreaPolygon: async () => {
        called = true;
        return FAKE_POLYGON;
      },
    };
    // A locality name that only resolves as a region itself (rare, mirrors geocodeGreekLocation's
    // own "single-token mention can itself be a regional unit" branch) — precision is
    // regional_unit, so the locality-polygon lookup must be skipped.
    await geocodeAlertArea('Θεσσαλονίκης', 'Θεσσαλονίκης', undefined, polygonSource);
    expect(called).toBe(false);
  });
});
```

- [ ] **Step 3: Run and verify**

Run: `pnpm --filter @pyrmap/server test -- alert112Geocoding`
Expected: all tests PASS. (If the "falls back to the regional unit polygon" test's assumption about Attica's bundle entry doesn't hold because Attica turned out to be one of the two known gaps, change that one assertion to `.toBeNull()` instead and adjust the comment — verify against the actual `greeceRegionalUnitBoundaries.json` content copied in Task 5, which lists `Αττική` as present, not a gap, so `.not.toBeNull()` is correct.)

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/domain/alert112Geocoding.ts packages/server/test/alert112Geocoding.test.ts
git commit -m "feat(server): orchestrate point + best-effort polygon resolution for 112 alerts"
```

---

### Task 8: `Alert112XClient` adapter

**Files:**
- Create: `packages/server/src/adapters/alert112/Alert112XClient.ts`
- Create: `packages/server/test/fixtures/alert112_tweets_sample.json`
- Test: `packages/server/test/Alert112XClient.test.ts`

**Interfaces:**
- Consumes: `RawPost` (reuse the existing type from `../../ports/IncidentSource.js` — same shape, no duplication needed since it's an intra-package port type, not a cross-package shared type).
- Produces: `Alert112XClient implements IncidentSource` (the exact same port `PyrosvestikiXClient` implements — `fetchRecentPosts`/`fetchPostsInWindow` — reused as-is since the X API mechanics are identical). Consumed by Task 9/10 and `index.ts` (Task 14).

- [ ] **Step 1: Write the fixture**

Create `packages/server/test/fixtures/alert112_tweets_sample.json` (mirrors the real X API v2 response shape, 3 posts — one Greek activation, its English duplicate, one unrelated post):

```json
{
  "data": [
    {
      "id": "2080300000000000001",
      "text": "⚠️Ενεργοποίηση 1⃣1⃣2⃣\n\n🆘 Πυρκαγιά στην περιοχή #Δερβένι της Περιφερειακής Ενότητας #Θεσσαλονίκης\n\n‼️ Καπνοί κατευθύνονται στην περιοχή\n\nℹ️ https://civilprotection.gov.gr/112/odigies-prostasias",
      "created_at": "2026-07-23T07:00:00.000Z"
    },
    {
      "id": "2080300000000000002",
      "text": "⚠️Activation 1⃣1⃣2⃣\n\n🆘 Fire in #Derveni area of the regional unit of #Thessaloniki\n\n‼️ The smoke is heading towards your area\n\nℹ️ https://civilprotection.gov.gr/112/odigies-prostasias",
      "created_at": "2026-07-23T07:00:05.000Z"
    },
    {
      "id": "2080300000000000003",
      "text": "Ενημερωτικό δελτίο τύπου χωρίς ενεργοποίηση 112.",
      "created_at": "2026-07-23T06:00:00.000Z"
    }
  ],
  "meta": { "result_count": 3 }
}
```

- [ ] **Step 2: Write the adapter**

Create `packages/server/src/adapters/alert112/Alert112XClient.ts`:

```ts
import type { IncidentSource, RawPost } from '../../ports/IncidentSource.js';

const API_BASE = 'https://api.twitter.com/2';
// Resolved once via GET /2/users/by/username/112Greece, 2026-07-23 — see the pattern this mirrors
// exactly in adapters/pyrosvestiki/PyrosvestikiXClient.ts.
const ALERT_112_USER_ID = '1187287012442804225';
const MIN_RESULTS = 5;
const MAX_RESULTS = 100;
const TIMEOUT_MS = 30_000;

type FetchFn = typeof fetch;

interface TweetsResponse {
  data?: { id: string; text: string; created_at: string }[];
}

/**
 * Pulls @112Greece's official civil-protection activation posts via X API v2's user-tweets
 * endpoint, app-only Bearer auth — same mechanics as PyrosvestikiXClient (same account type, same
 * pricing model), reusing the same X_BEARER_TOKEN. `since_id` used whenever available so an empty
 * poll costs nothing (X bills per tweet object returned, not per request).
 */
export class Alert112XClient implements IncidentSource {
  constructor(
    private readonly bearerToken: string,
    private readonly fetchImpl: FetchFn = fetch,
  ) {}

  async fetchRecentPosts(sinceExternalId: string | null, maxResults: number): Promise<RawPost[]> {
    const clamped = Math.min(MAX_RESULTS, Math.max(MIN_RESULTS, maxResults));
    const params = new URLSearchParams({
      max_results: String(clamped),
      'tweet.fields': 'created_at,text',
      exclude: 'retweets',
    });
    if (sinceExternalId) params.set('since_id', sinceExternalId);

    return this.fetch(`${API_BASE}/users/${ALERT_112_USER_ID}/tweets?${params.toString()}`);
  }

  async fetchPostsInWindow(startTime: Date, endTime: Date): Promise<RawPost[]> {
    const params = new URLSearchParams({
      max_results: String(MAX_RESULTS),
      'tweet.fields': 'created_at,text',
      exclude: 'retweets',
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
    });

    return this.fetch(`${API_BASE}/users/${ALERT_112_USER_ID}/tweets?${params.toString()}`);
  }

  private async fetch(url: string): Promise<RawPost[]> {
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
      url: `https://x.com/112Greece/status/${tweet.id}`,
    }));
  }
}
```

- [ ] **Step 3: Write tests**

Create `packages/server/test/Alert112XClient.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Alert112XClient } from '../src/adapters/alert112/Alert112XClient.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const tweetsJson = readFileSync(path.join(fixturesDir, 'alert112_tweets_sample.json'), 'utf-8');

function fakeFetch(): typeof fetch {
  return vi.fn(async () => new Response(tweetsJson, { status: 200 })) as unknown as typeof fetch;
}

describe('Alert112XClient', () => {
  it('parses the API response shape into RawPost objects, including the English duplicate (filtering happens later, in parsing)', async () => {
    const client = new Alert112XClient('tok', fakeFetch());
    const posts = await client.fetchRecentPosts(null, 10);

    expect(posts).toHaveLength(3);
    expect(posts[0]).toEqual({
      externalId: '2080300000000000001',
      text: expect.stringContaining('Ενεργοποίηση'),
      publishedAt: '2026-07-23T07:00:00.000Z',
      url: 'https://x.com/112Greece/status/2080300000000000001',
    });
  });

  it('sends Bearer auth and includes since_id only when one is given', async () => {
    const fetchImpl = fakeFetch();
    const client = new Alert112XClient('my-token', fetchImpl);

    await client.fetchRecentPosts(null, 10);
    await client.fetchRecentPosts('123456789', 10);

    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit?][];
    expect((calls[0]![1]?.headers as Record<string, string>).Authorization).toBe('Bearer my-token');
    expect(String(calls[0]![0])).not.toContain('since_id');
    expect(String(calls[1]![0])).toContain('since_id=123456789');
  });

  it('throws on a failed response instead of silently returning nothing', async () => {
    const fetchImpl = vi.fn(async () => new Response('rate limited', { status: 429 })) as unknown as typeof fetch;
    const client = new Alert112XClient('tok', fetchImpl);

    await expect(client.fetchRecentPosts(null, 10)).rejects.toThrow(/HTTP 429/);
  });

  it('fetches posts in a time window via start_time/end_time, not since_id', async () => {
    const fetchImpl = fakeFetch();
    const client = new Alert112XClient('tok', fetchImpl);

    await client.fetchPostsInWindow(new Date('2026-07-23T00:00:00Z'), new Date('2026-07-23T12:00:00Z'));

    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit?][];
    const url = String(calls[0]![0]);
    expect(url).toContain('start_time=2026-07-23T00%3A00%3A00.000Z');
    expect(url).toContain('end_time=2026-07-23T12%3A00%3A00.000Z');
    expect(url).not.toContain('since_id');
  });
});
```

- [ ] **Step 4: Run and verify**

Run: `pnpm --filter @pyrmap/server test -- Alert112XClient`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/adapters/alert112/Alert112XClient.ts packages/server/test/Alert112XClient.test.ts packages/server/test/fixtures/alert112_tweets_sample.json
git commit -m "feat(server): add Alert112XClient for @112Greece polling"
```

---

### Task 9: Ingest service — `alert112IngestService.ts`

**Files:**
- Create: `packages/server/src/services/alert112IngestService.ts`
- Test: `packages/server/test/alert112IngestService.test.ts`

**Interfaces:**
- Consumes: `isAlert112Post`/`extractAlertAreas` (Task 3), `geocodeAlertArea` (Task 7), `logIncidentFailure` (reused as-is from `services/incidentFailureLog.ts` — same generic shape, no new failure-log file needed), `CivilProtectionAlertRepository`/`NewAlertRow` (Task 2), `IncidentSource`/`RawPost` (reused port), `GeocodingSource`, `AreaPolygonSource` (Task 6).
- Produces: `processAlertPost(...)`, `ingestAlerts(...)`, `AlertIngestResult`. Consumed by Task 10 (rescan), Task 12 (scheduler), Task 14 (`index.ts`).

- [ ] **Step 1: Write the service**

Create `packages/server/src/services/alert112IngestService.ts`:

```ts
import { isAlert112Post, extractAlertAreas } from '../domain/alert112Parsing.js';
import { geocodeAlertArea } from '../domain/alert112Geocoding.js';
import { logIncidentFailure } from './incidentFailureLog.js';
import type { IncidentSource, RawPost } from '../ports/IncidentSource.js';
import type { CivilProtectionAlertRepository, NewAlertRow } from '../ports/CivilProtectionAlertRepository.js';
import type { GeocodingSource } from '../ports/GeocodingSource.js';
import type { AreaPolygonSource } from '../ports/AreaPolygonSource.js';

/** Records a failure exactly once per (source, externalId) ever, then durably logs it — same
 * dedup convention as incidentIngestService.ts's logFailureOnce (see its doc comment for why the
 * gate matters: without it, a post that never resolves gets re-logged on every poll forever). */
function logFailureOnce(
  repository: CivilProtectionAlertRepository,
  logsDir: string,
  now: () => Date,
  entry: Parameters<typeof logIncidentFailure>[1],
): void {
  const isNew = repository.recordFailedPostIfNew(entry.source, entry.externalId, entry.reason, entry.text, now().toISOString());
  if (isNew) logIncidentFailure(logsDir, entry, now);
}

const POSTS_PER_POLL = 10;
const LOG_TEXT_MAX_CHARS = 120;

function truncate(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > LOG_TEXT_MAX_CHARS ? `${collapsed.slice(0, LOG_TEXT_MAX_CHARS)}…` : collapsed;
}

export interface AlertIngestResult {
  postsFetched: number;
  rowsInserted: number;
  error: string | null;
}

/**
 * Classifies, extracts, and geocodes one 112 activation post. Returns the row to persist, or null
 * if it should be skipped (not a Greek activation post, no area clause found, or geocoding
 * failed) — in the null-because-skipped-after-classifying case, a failure is durably logged, at
 * most once ever per (source, externalId). Shared by the regular polling path (ingestAlerts) and
 * the rescan path (services/alert112RescanService.ts), so both log failures identically.
 */
export async function processAlertPost(
  post: RawPost,
  sourceId: string,
  repository: CivilProtectionAlertRepository,
  logsDir: string,
  now: () => Date,
  geocodingSource: GeocodingSource | undefined,
  polygonSource: AreaPolygonSource | undefined,
  onLog?: (message: string) => void,
): Promise<NewAlertRow | null> {
  if (!isAlert112Post(post.text)) return null;

  const areas = extractAlertAreas(post.text);
  if (!areas) {
    onLog?.(`source=${sourceId} skip=no-location id=${post.externalId} text="${truncate(post.text)}"`);
    logFailureOnce(repository, logsDir, now, {
      source: sourceId,
      externalId: post.externalId,
      reason: 'no-location',
      text: post.text,
      url: post.url,
      publishedAt: post.publishedAt,
    });
    return null;
  }

  const geocoded = await geocodeAlertArea(areas.locality, areas.regionGenitive, geocodingSource, polygonSource);
  if (!geocoded) {
    onLog?.(
      `source=${sourceId} skip=no-geocode id=${post.externalId} locality="${areas.locality ?? ''}" region="${areas.regionGenitive}" text="${truncate(post.text)}"`,
    );
    logFailureOnce(repository, logsDir, now, {
      source: sourceId,
      externalId: post.externalId,
      reason: 'no-geocode',
      text: post.text,
      url: post.url,
      publishedAt: post.publishedAt,
      settlement: areas.locality ?? undefined,
      region: areas.regionGenitive,
    });
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
    areaPolygon: geocoded.areaPolygon,
  };
}

/**
 * Ingests 112 activation alerts from @112Greece: fetch new posts since the last one seen ->
 * classify -> extract area -> geocode -> persist only the ones that resolved to real coordinates.
 * Never throws; failures land in fetch_log, same convention as ingestIncidentReports, plus a
 * durable per-day file via processAlertPost for anything that didn't resolve.
 */
export async function ingestAlerts(
  source: IncidentSource,
  repository: CivilProtectionAlertRepository,
  sourceId: string,
  now: () => Date,
  logsDir: string,
  onLog?: (message: string) => void,
  onInserted?: (rows: NewAlertRow[]) => void,
  geocodingSource?: GeocodingSource,
  polygonSource?: AreaPolygonSource,
): Promise<AlertIngestResult> {
  const fetchedAt = now().toISOString();
  const sinceId = repository.findLatestExternalId(sourceId);

  let posts;
  try {
    posts = await source.fetchRecentPosts(sinceId, POSTS_PER_POLL);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    repository.recordFetchLog({ source: sourceId, fetchedAt, httpStatus: null, rowsParsed: 0, rowsInserted: 0, error: message });
    return { postsFetched: 0, rowsInserted: 0, error: message };
  }

  const rows: NewAlertRow[] = [];
  let skipped = 0;
  for (const post of posts) {
    const row = await processAlertPost(post, sourceId, repository, logsDir, now, geocodingSource, polygonSource, onLog);
    if (row) rows.push(row);
    else skipped++;
  }

  const insertedRows = repository.insertAlerts(rows);
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

- [ ] **Step 2: Write tests, mirroring `incidentIngestService.test.ts`'s structure**

Create `packages/server/test/alert112IngestService.test.ts`:

```ts
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SqliteCivilProtectionAlertRepository } from '../src/adapters/sqlite/SqliteCivilProtectionAlertRepository.js';
import { ingestAlerts } from '../src/services/alert112IngestService.js';
import type { IncidentSource, RawPost } from '../src/ports/IncidentSource.js';

const NOW = () => new Date('2026-07-23T13:00:00Z');
const SOURCE_ID = 'ALERT_112_X';

const GREEK_ACTIVATION =
  '⚠️Ενεργοποίηση 1⃣1⃣2⃣\n\n🆘 Πυρκαγιά στην περιοχή #Δερβένι της Περιφερειακής Ενότητας #Θεσσαλονίκης\n\nℹ️';
const ENGLISH_DUPLICATE =
  '⚠️Activation 1⃣1⃣2⃣\n\n🆘 Fire in #Derveni area of the regional unit of #Thessaloniki\n\nℹ️';
const NO_ACTIVATION = 'Ενημερωτικό δελτίο χωρίς ενεργοποίηση.';

const POSTS: RawPost[] = [
  { externalId: '1', text: GREEK_ACTIVATION, publishedAt: '2026-07-23T07:00:00Z', url: 'https://x.com/112Greece/status/1' },
  { externalId: '2', text: ENGLISH_DUPLICATE, publishedAt: '2026-07-23T07:00:05Z', url: 'https://x.com/112Greece/status/2' },
  { externalId: '3', text: NO_ACTIVATION, publishedAt: '2026-07-23T06:00:00Z', url: 'https://x.com/112Greece/status/3' },
];

class FakeAlertSource implements IncidentSource {
  public lastSinceId: string | null | undefined;
  constructor(private readonly posts: RawPost[]) {}
  async fetchRecentPosts(sinceExternalId: string | null): Promise<RawPost[]> {
    this.lastSinceId = sinceExternalId;
    return this.posts;
  }
  async fetchPostsInWindow(): Promise<RawPost[]> {
    throw new Error('not implemented in this fake');
  }
}

let tmpDir: string;
let repo: SqliteCivilProtectionAlertRepository;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'pyrmap-alertingest-test-'));
  repo = new SqliteCivilProtectionAlertRepository(path.join(tmpDir, 'test.db'));
});

afterEach(() => {
  repo.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('ingestAlerts', () => {
  it('inserts only the Greek activation post, skipping the English duplicate and the non-activation post', async () => {
    const result = await ingestAlerts(new FakeAlertSource(POSTS), repo, SOURCE_ID, NOW, path.join(tmpDir, 'logs'));

    expect(result).toEqual({ postsFetched: 3, rowsInserted: 1, error: null });
    const stored = repo.findAlertsSince('2026-07-23T00:00:00Z');
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ source: SOURCE_ID, precision: 'locality' });
  });

  it('calls onInserted with the newly inserted rows', async () => {
    const onInserted = vi.fn();
    await ingestAlerts(new FakeAlertSource(POSTS), repo, SOURCE_ID, NOW, path.join(tmpDir, 'logs'), undefined, onInserted);

    expect(onInserted).toHaveBeenCalledTimes(1);
    expect(onInserted.mock.calls[0]![0]).toHaveLength(1);
  });

  it('re-ingesting the same posts inserts 0 new rows', async () => {
    await ingestAlerts(new FakeAlertSource(POSTS), repo, SOURCE_ID, NOW, path.join(tmpDir, 'logs'));
    const second = await ingestAlerts(new FakeAlertSource(POSTS), repo, SOURCE_ID, NOW, path.join(tmpDir, 'logs'));
    expect(second.rowsInserted).toBe(0);
  });

  it('records a fetch_log error and does not throw when the source fails', async () => {
    const failing: IncidentSource = {
      fetchRecentPosts: async () => { throw new Error('X API down'); },
      fetchPostsInWindow: async () => { throw new Error('X API down'); },
    };
    const result = await ingestAlerts(failing, repo, SOURCE_ID, NOW, path.join(tmpDir, 'logs'));
    expect(result.error).toBe('X API down');
  });

  it('logs the English duplicate and the no-activation post as no-location failures, each exactly once', async () => {
    const logsDir = path.join(tmpDir, 'logs');
    await ingestAlerts(new FakeAlertSource(POSTS), repo, SOURCE_ID, NOW, logsDir);
    await ingestAlerts(new FakeAlertSource(POSTS), repo, SOURCE_ID, NOW, logsDir);

    const logFile = path.join(logsDir, '2026-07-23.log');
    const entries = readFileSync(logFile, 'utf-8').trim().split('\n').map((line) => JSON.parse(line));
    expect(entries.filter((e) => e.externalId === '2')).toHaveLength(1);
    expect(entries.filter((e) => e.externalId === '3')).toHaveLength(1);
  });

  it('passes the latest stored-or-failed external_id as since_id on the next poll', async () => {
    await ingestAlerts(new FakeAlertSource(POSTS), repo, SOURCE_ID, NOW, path.join(tmpDir, 'logs'));
    const secondSource = new FakeAlertSource([]);
    await ingestAlerts(secondSource, repo, SOURCE_ID, NOW, path.join(tmpDir, 'logs'));
    expect(secondSource.lastSinceId).toBe('3');
  });
});
```

- [ ] **Step 3: Run and verify**

Run: `pnpm --filter @pyrmap/server test -- alert112IngestService`
Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/services/alert112IngestService.ts packages/server/test/alert112IngestService.test.ts
git commit -m "feat(server): add 112 alert ingest service (classify/extract/geocode/persist)"
```

---

### Task 10: Rescan service — `alert112RescanService.ts`

**Files:**
- Create: `packages/server/src/services/alert112RescanService.ts`
- Test: `packages/server/test/alert112RescanService.test.ts`

**Interfaces:**
- Consumes: `processAlertPost` (Task 9), `IncidentSource`, `CivilProtectionAlertRepository`.
- Produces: `AlertRescanResult`, `rescanAlerts(...)`. Consumed by Task 12 (scheduler).

- [ ] **Step 1: Write the service, mirroring `incidentRescanService.ts` exactly**

Create `packages/server/src/services/alert112RescanService.ts`:

```ts
import { processAlertPost } from './alert112IngestService.js';
import type { IncidentSource } from '../ports/IncidentSource.js';
import type { CivilProtectionAlertRepository, NewAlertRow } from '../ports/CivilProtectionAlertRepository.js';
import type { GeocodingSource } from '../ports/GeocodingSource.js';
import type { AreaPolygonSource } from '../ports/AreaPolygonSource.js';

export interface AlertRescanResult {
  postsChecked: number;
  rowsInserted: number;
  postsSkippedAlreadyResolved: number;
  postsFailed: number;
  error: string | null;
}

/**
 * Re-examines every 112 post in the last `hours` (date-windowed fetch, not since_id — so this
 * revisits posts the regular poll may have already seen and failed to resolve), skipping any post
 * whose external_id is already stored, logging a failure for anything still unresolvable. Costs a
 * real paid X API read every time. Never throws; failures land in fetch_log — same convention as
 * every other ingest/rescan path.
 */
export async function rescanAlerts(
  source: IncidentSource,
  repository: CivilProtectionAlertRepository,
  sourceId: string,
  hours: number,
  now: () => Date,
  logsDir: string,
  geocodingSource: GeocodingSource | undefined,
  polygonSource: AreaPolygonSource | undefined,
  onLog?: (message: string) => void,
): Promise<AlertRescanResult> {
  const endTime = now();
  const startTime = new Date(endTime.getTime() - hours * 60 * 60 * 1000);
  const fetchedAt = now().toISOString();

  let posts;
  try {
    posts = await source.fetchPostsInWindow(startTime, endTime);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    repository.recordFetchLog({ source: sourceId, fetchedAt, httpStatus: null, rowsParsed: 0, rowsInserted: 0, error: message });
    return { postsChecked: 0, rowsInserted: 0, postsSkippedAlreadyResolved: 0, postsFailed: 0, error: message };
  }

  const alreadyResolved = repository.findExternalIdsSince(sourceId, startTime.toISOString());

  const rows: NewAlertRow[] = [];
  let skippedAlreadyResolved = 0;
  let failed = 0;

  for (const post of posts) {
    if (alreadyResolved.has(post.externalId)) {
      skippedAlreadyResolved++;
      continue;
    }
    const row = await processAlertPost(post, sourceId, repository, logsDir, now, geocodingSource, polygonSource, onLog);
    if (row) rows.push(row);
    else failed++;
  }

  const inserted = repository.insertAlerts(rows);
  onLog?.(
    `rescan source=${sourceId} hours=${hours} checked=${posts.length} skippedAlreadyResolved=${skippedAlreadyResolved} inserted=${inserted.length} failed=${failed}`,
  );

  repository.recordFetchLog({ source: sourceId, fetchedAt, httpStatus: 200, rowsParsed: rows.length, rowsInserted: inserted.length, error: null });

  return { postsChecked: posts.length, rowsInserted: inserted.length, postsSkippedAlreadyResolved: skippedAlreadyResolved, postsFailed: failed, error: null };
}
```

- [ ] **Step 2: Write tests, mirroring `incidentRescanService.test.ts`'s structure (read that file first to match its fake/window conventions exactly)**

Create `packages/server/test/alert112RescanService.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteCivilProtectionAlertRepository } from '../src/adapters/sqlite/SqliteCivilProtectionAlertRepository.js';
import { rescanAlerts } from '../src/services/alert112RescanService.js';
import type { IncidentSource, RawPost } from '../src/ports/IncidentSource.js';

const NOW = () => new Date('2026-07-23T13:00:00Z');
const SOURCE_ID = 'ALERT_112_X';

const GREEK_ACTIVATION =
  '⚠️Ενεργοποίηση 1⃣1⃣2⃣\n\n🆘 Πυρκαγιά στην περιοχή #Δερβένι της Περιφερειακής Ενότητας #Θεσσαλονίκης\n\nℹ️';

class FakeWindowSource implements IncidentSource {
  constructor(private readonly posts: RawPost[]) {}
  async fetchRecentPosts(): Promise<RawPost[]> {
    throw new Error('not implemented in this fake');
  }
  async fetchPostsInWindow(): Promise<RawPost[]> {
    return this.posts;
  }
}

let tmpDir: string;
let repo: SqliteCivilProtectionAlertRepository;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'pyrmap-alertrescan-test-'));
  repo = new SqliteCivilProtectionAlertRepository(path.join(tmpDir, 'test.db'));
});

afterEach(() => {
  repo.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('rescanAlerts', () => {
  it('inserts a previously-failed post once the underlying parser can resolve it', async () => {
    const posts: RawPost[] = [
      { externalId: '1', text: GREEK_ACTIVATION, publishedAt: '2026-07-23T07:00:00Z', url: 'https://x.com/112Greece/status/1' },
    ];
    const result = await rescanAlerts(new FakeWindowSource(posts), repo, SOURCE_ID, 24, NOW, path.join(tmpDir, 'logs'), undefined, undefined);

    expect(result).toMatchObject({ postsChecked: 1, rowsInserted: 1, postsSkippedAlreadyResolved: 0, postsFailed: 0, error: null });
  });

  it('skips a post whose external_id is already stored', async () => {
    repo.insertAlerts([
      {
        externalId: '1',
        source: SOURCE_ID,
        text: GREEK_ACTIVATION,
        url: 'u',
        publishedAt: '2026-07-23T07:00:00Z',
        latitude: 1,
        longitude: 1,
        precision: 'locality',
        areaPolygon: null,
      },
    ]);
    const posts: RawPost[] = [{ externalId: '1', text: GREEK_ACTIVATION, publishedAt: '2026-07-23T07:00:00Z', url: 'u' }];
    const result = await rescanAlerts(new FakeWindowSource(posts), repo, SOURCE_ID, 24, NOW, path.join(tmpDir, 'logs'), undefined, undefined);

    expect(result).toMatchObject({ postsSkippedAlreadyResolved: 1, rowsInserted: 0 });
  });

  it('records a fetch_log error and does not throw when the window fetch fails', async () => {
    const failing: IncidentSource = {
      fetchRecentPosts: async () => [],
      fetchPostsInWindow: async () => { throw new Error('X API down'); },
    };
    const result = await rescanAlerts(failing, repo, SOURCE_ID, 24, NOW, path.join(tmpDir, 'logs'), undefined, undefined);
    expect(result.error).toBe('X API down');
  });
});
```

- [ ] **Step 3: Run and verify**

Run: `pnpm --filter @pyrmap/server test -- alert112RescanService`
Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/services/alert112RescanService.ts packages/server/test/alert112RescanService.test.ts
git commit -m "feat(server): add 112 alert rescan service"
```

---

### Task 11: Push notification payload for alerts

**Files:**
- Modify: `packages/server/src/domain/notificationPayload.ts`
- Modify: `packages/server/src/services/pushNotificationService.ts`
- Test: `packages/server/test/notificationPayload.test.ts` (append)
- Test: `packages/server/test/pushNotificationService.test.ts` (append)

**Interfaces:**
- Consumes: `NewAlertRow` (Task 2).
- Produces: `buildAlertPayload(...)`, `notifyNewAlerts(...)`. Consumed by Task 12 (scheduler) and Task 14 (`index.ts`).

- [ ] **Step 1: Add `buildAlertPayload` to `notificationPayload.ts`**

Add the import at the top:

```ts
import type { NewAlertRow } from '../ports/CivilProtectionAlertRepository.js';
```

Add at the end of the file:

```ts
/** Builds a push payload for a newly inserted 112 alert — official, so it's flagged distinctly
 * from a Fire Service situational report; its own post text already names the place. */
export function buildAlertPayload(alert: Pick<NewAlertRow, 'text' | 'latitude' | 'longitude'>): NotificationPayload {
  const collapsed = alert.text.replace(/\s+/g, ' ').trim();
  const body = collapsed.length > MAX_INCIDENT_BODY_CHARS ? `${collapsed.slice(0, MAX_INCIDENT_BODY_CHARS)}…` : collapsed;
  return {
    title: '🚨 112 Alert',
    body,
    url: `/?focus=${alert.latitude},${alert.longitude}`,
  };
}
```

- [ ] **Step 2: Add `notifyNewAlerts` to `pushNotificationService.ts`**

Add the import at the top:

```ts
import { buildAlertPayload } from '../domain/notificationPayload.js';
import type { NewAlertRow } from '../ports/CivilProtectionAlertRepository.js';
```

(merge with the existing `buildDetectionPayload, buildIncidentPayload` import line rather than adding a duplicate import from the same module)

Add at the end of the file:

```ts
/** Notifies every subscribed device of each newly inserted 112 alert, one push per row. */
export async function notifyNewAlerts(
  repository: PushSubscriptionRepository,
  alerts: NewAlertRow[],
  onLog?: (message: string) => void,
  send: SendFn = webpush.sendNotification,
): Promise<void> {
  for (const alert of alerts) {
    await sendToAllSubscriptions(repository, buildAlertPayload(alert), onLog, send);
  }
}
```

- [ ] **Step 3: Append tests**

Append to `packages/server/test/notificationPayload.test.ts` (check its existing imports and add `buildAlertPayload` to them):

```ts
describe('buildAlertPayload', () => {
  it('builds a distinctly-titled payload with a focus deep link', () => {
    const payload = buildAlertPayload({ text: 'Πυρκαγιά στην περιοχή #Δερβένι.', latitude: 40.7, longitude: 22.9 });
    expect(payload.title).toBe('🚨 112 Alert');
    expect(payload.url).toBe('/?focus=40.7,22.9');
    expect(payload.body).toContain('Δερβένι');
  });

  it('truncates a long alert body the same way incident payloads do', () => {
    const longText = 'Α'.repeat(200);
    const payload = buildAlertPayload({ text: longText, latitude: 0, longitude: 0 });
    expect(payload.body.endsWith('…')).toBe(true);
    expect(payload.body.length).toBeLessThan(200);
  });
});
```

Append to `packages/server/test/pushNotificationService.test.ts` (check its existing `FakePushSubscriptionRepository`/fake-send patterns and reuse them; add `notifyNewAlerts` to the existing import line):

```ts
describe('notifyNewAlerts', () => {
  it('sends one push per newly inserted alert', async () => {
    const repository = new FakePushSubscriptionRepository([{ endpoint: 'e1', p256dh: 'p', auth: 'a' }]);
    const send = vi.fn(async () => undefined);

    await notifyNewAlerts(
      repository,
      [{ externalId: '1', source: 'ALERT_112_X', text: 't', url: 'u', publishedAt: '2026-07-23T00:00:00Z', latitude: 1, longitude: 1, precision: 'locality', areaPolygon: null }],
      undefined,
      send,
    );

    expect(send).toHaveBeenCalledTimes(1);
  });
});
```

(If `pushNotificationService.test.ts` names its fake repository or fake-send helper differently, use the file's actual existing names instead of `FakePushSubscriptionRepository`/inline object above.)

- [ ] **Step 4: Run and verify**

Run: `pnpm --filter @pyrmap/server test -- notificationPayload pushNotificationService`
Expected: all existing + new tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/domain/notificationPayload.ts packages/server/src/services/pushNotificationService.ts packages/server/test/notificationPayload.test.ts packages/server/test/pushNotificationService.test.ts
git commit -m "feat(server): push notifications for newly inserted 112 alerts"
```

---

### Task 12: Scheduler wiring — `pollAlerts` + rescan integration

**Files:**
- Modify: `packages/server/src/jobs/scheduler.ts`
- Test: `packages/server/test/scheduler.test.ts` (append — read the existing file first to match its exact `SchedulerDeps` construction helper/fake pattern)

**Interfaces:**
- Consumes: `ingestAlerts`/`rescanAlerts` (Tasks 9-10), `CivilProtectionAlertRepository`, `AreaPolygonSource`.
- Produces: `SchedulerDeps.alertIngestion`, `SchedulerDeps.polygonSource`, `SchedulerDeps.onNewAlerts`; `Scheduler.pollAlerts`; `rescan()`'s return type gains an `alerts` field. Consumed by Task 14 (`index.ts`) and Task 13 (rescan route response already flows through `Scheduler.rescan`'s return type, no route code change needed beyond the type).

- [ ] **Step 1: Extend `SchedulerDeps` and `Scheduler`**

Add imports at the top of `packages/server/src/jobs/scheduler.ts`:

```ts
import { ingestAlerts } from '../services/alert112IngestService.js';
import { rescanAlerts, type AlertRescanResult } from '../services/alert112RescanService.js';
import type { CivilProtectionAlertRepository, NewAlertRow } from '../ports/CivilProtectionAlertRepository.js';
import type { AreaPolygonSource } from '../ports/AreaPolygonSource.js';
```

Add to `SchedulerDeps` (after the existing `incidentIngestion` field):

```ts
  /** Optional 112 civil-protection alert source (@112Greece X account); polled every minute on its own job, same cost model as incidentIngestion. */
  alertIngestion?: { source: IncidentSource; repository: CivilProtectionAlertRepository; sourceId: string };
  /** Optional best-effort area-polygon lookup for 112 alerts (e.g. Nominatim). */
  polygonSource?: AreaPolygonSource;
```

Add to `SchedulerDeps` (after `onNewIncidents`):

```ts
  /** Called with newly inserted 112 alerts, once per row — drives push notifications. */
  onNewAlerts?: (alerts: NewAlertRow[]) => void;
```

Change `Scheduler` interface's `rescan` signature and add `pollAlerts`:

```ts
export interface Scheduler {
  stop: () => void;
  pollGeo: () => Promise<void>;
  pollPolar: () => Promise<void>;
  pollIncidents: () => Promise<void>;
  pollAlerts: () => Promise<void>;
  decay: () => void;
  retention: () => void;
  rescan: (hours: 6 | 12 | 24) => Promise<{ satellite: { sourcesChanged: number }; incidents: RescanResult | null; alerts: AlertRescanResult | null }>;
}
```

- [ ] **Step 2: Implement `pollAlerts`, extend `rescan`, register the cron job**

Add this function after `pollIncidents` (inside `startScheduler`):

```ts
  async function pollAlerts(): Promise<void> {
    const alerts = deps.alertIngestion;
    if (!alerts) return;
    const result = await ingestAlerts(
      alerts.source,
      alerts.repository,
      alerts.sourceId,
      now,
      deps.logsDir,
      deps.onLog,
      deps.onNewAlerts,
      deps.geocodingSource,
      deps.polygonSource,
    );
    if (result.rowsInserted > 0) deps.onUpdate?.();
  }
```

Change the `rescan` function's return statement and body to also rescan alerts:

```ts
  async function rescan(hours: 6 | 12 | 24): Promise<{ satellite: { sourcesChanged: number }; incidents: RescanResult | null; alerts: AlertRescanResult | null }> {
    let sourcesChanged = 0;
    for (const sourceId of geoSourceIds) {
      if (await ingestOne(sourceId, 'geo')) sourcesChanged++;
    }
    for (const sourceId of polarSourceIds) {
      if (await ingestOne(sourceId, 'polar')) sourcesChanged++;
    }
    for (const { source, config } of deps.alertSources ?? []) {
      const result = await ingestFireAlerts(source, config, deps.repository, now, deps.onLog, deps.onNewDetections);
      if (result.rowsInserted > 0) sourcesChanged++;
    }

    const incidents = deps.incidentIngestion;
    const incidentResult = incidents
      ? await rescanIncidentReports(incidents.source, incidents.repository, incidents.sourceId, hours, now, deps.logsDir, deps.geocodingSource, deps.onLog)
      : null;

    const alerts = deps.alertIngestion;
    const alertResult = alerts
      ? await rescanAlerts(alerts.source, alerts.repository, alerts.sourceId, hours, now, deps.logsDir, deps.geocodingSource, deps.polygonSource, deps.onLog)
      : null;

    deps.onUpdate?.();
    return { satellite: { sourcesChanged }, incidents: incidentResult, alerts: alertResult };
  }
```

Add the cron job registration (in the `tasks` array, after `pollIncidents`'s entry) and the initial run (after `void pollIncidents();`), and add `pollAlerts` to the returned object:

```ts
  const tasks: ScheduledTask[] = [
    cron.schedule('*/10 * * * *', () => void pollGeo()),
    cron.schedule('*/30 * * * *', () => void pollPolar()),
    cron.schedule('* * * * *', () => void pollIncidents()),
    cron.schedule('* * * * *', () => void pollAlerts()),
    cron.schedule('*/10 * * * *', decay),
    cron.schedule('0 3 * * *', retention),
  ];

  void pollGeo();
  void pollPolar();
  void pollIncidents();
  void pollAlerts();

  return {
    stop: () => tasks.forEach((task) => task.stop()),
    pollGeo,
    pollPolar,
    pollIncidents,
    pollAlerts,
    decay,
    retention,
    rescan,
  };
```

Also update `retention()`'s call (find the existing call to `runRetention` and its destructured result) — **do not change `runRetention`'s own signature in this task** (that would be scope creep beyond this plan); alert retention is intentionally left out of `runRetention` for now and flagged in `docs/TODO.md` at the end of this plan (Task 16) rather than added here, since it's a separate concern from scheduling alerts and not required by the approved spec.

- [ ] **Step 3: Append scheduler tests**

Read `packages/server/test/scheduler.test.ts` first to see its exact `SchedulerDeps` construction helper (it likely builds a full deps object with fakes for `dataSource`/`repository`/etc. — reuse that helper and just add the new `alertIngestion`/`polygonSource`/`onNewAlerts` fields to it, following whatever pattern the file already uses for `incidentIngestion`). Then append:

```ts
describe('pollAlerts', () => {
  it('does nothing when no alertIngestion is configured', async () => {
    const scheduler = startScheduler(buildDeps({})); // use the file's existing deps-builder helper
    await expect(scheduler.pollAlerts()).resolves.toBeUndefined();
    scheduler.stop();
  });

  it('calls onUpdate when a new alert is inserted', async () => {
    const onUpdate = vi.fn();
    const fakeAlertSource = {
      fetchRecentPosts: async () => [
        {
          externalId: '1',
          text: '⚠️Ενεργοποίηση 1⃣1⃣2⃣\n\n🆘 Πυρκαγιά στην περιοχή #Δερβένι της Περιφερειακής Ενότητας #Θεσσαλονίκης\n\nℹ️',
          publishedAt: '2026-07-23T07:00:00Z',
          url: 'u',
        },
      ],
      fetchPostsInWindow: async () => [],
    };
    const scheduler = startScheduler(
      buildDeps({
        alertIngestion: { source: fakeAlertSource, repository: alertRepo, sourceId: 'ALERT_112_X' }, // alertRepo: a real SqliteCivilProtectionAlertRepository against a tmp file, same convention as the file's existing incidentIngestion test setup
        onUpdate,
      }),
    );
    await scheduler.pollAlerts();
    expect(onUpdate).toHaveBeenCalled();
    scheduler.stop();
  });
});
```

(Match this test's exact repository-setup boilerplate — tmp dir, `SqliteCivilProtectionAlertRepository` construction/cleanup — to whatever `beforeEach`/`afterEach` convention `scheduler.test.ts` already uses for its `incidentIngestion` tests, rather than inventing a new one.)

- [ ] **Step 4: Run and verify — including the full existing suite for this file**

Run: `pnpm --filter @pyrmap/server test -- scheduler`
Expected: every existing test still PASSES, plus the new ones.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/jobs/scheduler.ts packages/server/test/scheduler.test.ts
git commit -m "feat(server): wire 112 alert polling and rescan into the scheduler"
```

---

### Task 13: Routes — `routes/alerts.ts` + `app.ts` wiring + `FiresResponse`/status integration

**Files:**
- Create: `packages/server/src/routes/alerts.ts`
- Modify: `packages/server/src/services/queryService.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/routes/rescan.ts` (only if its response type needs an explicit `alerts` field — check; likely it just forwards `scheduler.rescan()`'s return value untyped-through, in which case no change is needed here beyond Task 12's type change already covering it)
- Test: `packages/server/test/alerts.test.ts` (mirrors `incidents.test.ts`)
- Test: `packages/server/test/fires.test.ts` (append — verify `alerts` key appears in the response)

**Interfaces:**
- Consumes: `CivilProtectionAlertRepository` (Task 2).
- Produces: `alertEditRoutes(...)` registered in the admin tier; `getFires` includes `alerts`.

- [ ] **Step 1: Extend `getFires` in `queryService.ts`**

Add the parameter and field:

```ts
export function getFires(
  repository: FireRepository,
  params: GetFiresParams,
  incidentRepository?: IncidentReportRepository,
  alertRepository?: CivilProtectionAlertRepository,
): FiresResponse {
  const nowDate = params.now();
  const sinceIso = new Date(nowDate.getTime() - params.hours * MS_PER_HOUR).toISOString();

  return {
    generatedAt: nowDate.toISOString(),
    polar: repository.findPolarDetectionsSince(sinceIso),
    geo: repository.findGeoDetectionsSince(sinceIso, params.includeExpired),
    incidents: incidentRepository?.findIncidentReportsSince(sinceIso) ?? [],
    alerts: alertRepository?.findAlertsSince(sinceIso) ?? [],
  };
}
```

Add the import at the top: `import type { CivilProtectionAlertRepository } from '../ports/CivilProtectionAlertRepository.js';`

- [ ] **Step 2: Write `routes/alerts.ts`, mirroring `routes/incidents.ts`'s edit routes exactly (no search route needed here — reuse the existing `/api/geocode/search` from `incidents.ts`, do not duplicate it)**

Create `packages/server/src/routes/alerts.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import type { CivilProtectionAlert } from '@pyrmap/shared';
import type { CivilProtectionAlertRepository } from '../ports/CivilProtectionAlertRepository.js';
import type { UpdateBus } from '../jobs/updateBus.js';

interface IdParams {
  id: number;
}

interface LocationBody {
  latitude: number;
  longitude: number;
}

/**
 * Manual correction for mis-geocoded 112 alerts — same shape and semantics as
 * routes/incidents.ts's incidentEditRoutes (see its doc comment and
 * docs/superpowers/specs/2026-07-23-incident-pin-correction-design.md for hide vs. delete).
 */
export function alertEditRoutes(repository: CivilProtectionAlertRepository, updateBus: UpdateBus) {
  return async function registerAlertEditRoutes(app: FastifyInstance): Promise<void> {
    app.patch<{ Params: IdParams; Body: LocationBody }>(
      '/api/alerts/:id/location',
      {
        schema: {
          params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
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
        const updated = repository.updateAlertLocation(id, latitude, longitude);
        if (!updated) {
          reply.code(404);
          return { error: 'Not Found' };
        }
        updateBus.publish();
        const [alert] = repository.findAlertsSince('1970-01-01T00:00:00Z').filter((a) => a.id === id);
        return alert as CivilProtectionAlert;
      },
    );

    app.post<{ Params: IdParams }>(
      '/api/alerts/:id/hide',
      { schema: { params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] } } },
      async (request, reply) => {
        const hidden = repository.hideAlert(request.params.id);
        if (!hidden) {
          reply.code(404);
          return { error: 'Not Found' };
        }
        updateBus.publish();
        return { ok: true };
      },
    );

    app.delete<{ Params: IdParams }>(
      '/api/alerts/:id',
      { schema: { params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] } } },
      async (request, reply) => {
        const deleted = repository.deleteAlert(request.params.id);
        if (!deleted) {
          reply.code(404);
          return { error: 'Not Found' };
        }
        updateBus.publish();
        return { ok: true };
      },
    );
  };
}
```

- [ ] **Step 3: Wire into `app.ts`**

Add imports: `import type { CivilProtectionAlertRepository } from './ports/CivilProtectionAlertRepository.js';` and `import { alertEditRoutes } from './routes/alerts.js';`

Add a new parameter to `buildApp` (append after `incidentRepository`, before `updateBus`, to keep every existing positional-call-site's earlier arguments unaffected — check every call site of `buildApp` after this change: `index.ts` and any test helper that constructs it directly, e.g. `test/incidents.test.ts`/`test/fires.test.ts`, and add the new argument there too):

```ts
export async function buildApp(
  config: Pick<Config, 'logLevel'>,
  repository: FireRepository,
  now: () => Date = () => new Date(),
  publicDir: string = DEFAULT_PUBLIC_DIR,
  incidentRepository?: IncidentReportRepository,
  alertRepository?: CivilProtectionAlertRepository,
  updateBus: UpdateBus = new UpdateBus(),
  auth: AuthConfig | null = null,
  pushSubscriptionRepository?: PushSubscriptionRepository,
  vapidPublicKey?: string | null,
  getScheduler?: () => Scheduler | null,
  locationSearchSource?: LocationSearchSource,
): Promise<FastifyInstance> {
```

Update the `firesRoutes` registration to pass `alertRepository` through: `await publicApp.register(firesRoutes(repository, now, incidentRepository, alertRepository));` (this requires `routes/fires.ts`'s `firesRoutes` function to also accept and forward `alertRepository` to `getFires` — make that small addition too, mirroring exactly how `incidentRepository` already flows through it).

Add the alert edit routes registration in the admin block, alongside `incidentEditRoutes`:

```ts
    if (alertRepository) {
      await adminApp.register(alertEditRoutes(alertRepository, updateBus));
    }
```

- [ ] **Step 4: Update every existing `buildApp(...)` call site for the new parameter position**

Search: `grep -rn "buildApp(" packages/server/src packages/server/test`. For each call site found (expected: `index.ts` and several test files), insert `undefined` (or the real alert repository, in `index.ts`) as the new 6th positional argument, immediately after the existing `incidentRepository` argument and before whatever was previously in that position. Run a build after this step specifically to catch any missed call site as a TypeScript arity error — do not rely on grep alone.

- [ ] **Step 5: Write `routes/alerts.ts` tests, mirroring `incidents.test.ts`'s structure (read that file first to copy its exact `buildApp` test-harness construction)**

Create `packages/server/test/alerts.test.ts` following the same shape as `incidents.test.ts` — one `describe` block per route (`PATCH /api/alerts/:id/location`, `POST /api/alerts/:id/hide`, `DELETE /api/alerts/:id`), each asserting: success case updates/hides/deletes and publishes an update (spy on `updateBus.publish` or check the effect directly per the existing file's convention), and a 404 case for a nonexistent id.

- [ ] **Step 6: Append a `fires.test.ts` assertion that `alerts` is present in the response shape**

Append one assertion (matching the existing test's structure) confirming `body.alerts` is an array (empty when no `alertRepository` is wired, matching how `incidents` already defaults to `[]` when `incidentRepository` is absent).

- [ ] **Step 7: Run and verify — including the full existing suites for every file touched**

Run: `pnpm --filter @pyrmap/server test -- alerts fires incidents`
Expected: every existing test still PASSES, plus the new ones.

- [ ] **Step 8: Build**

Run: `pnpm --filter @pyrmap/server build`
Expected: no TypeScript errors (this is the step that catches any missed `buildApp` call site from Step 4).

- [ ] **Step 9: Commit**

```bash
git add packages/server/src/routes/alerts.ts packages/server/src/routes/fires.ts packages/server/src/services/queryService.ts packages/server/src/app.ts packages/server/test/alerts.test.ts packages/server/test/fires.test.ts
git commit -m "feat(server): expose 112 alerts via /api/fires and add edit/hide/delete routes"
```

---

### Task 14: `index.ts` wiring

**Files:**
- Modify: `packages/server/src/index.ts`

**Interfaces:**
- Consumes: everything from Tasks 2, 8, 11, 12, 13.
- Produces: a fully wired, runnable server with the 112 alerts feature enabled whenever `X_BEARER_TOKEN` is set (same gate as incident reports — no new env var).

- [ ] **Step 1: Add imports**

```ts
import { ALERT_112_SOURCE_ID } from '@pyrmap/shared';
import { SqliteCivilProtectionAlertRepository } from './adapters/sqlite/SqliteCivilProtectionAlertRepository.js';
import { Alert112XClient } from './adapters/alert112/Alert112XClient.js';
import { notifyNewAlerts } from './services/pushNotificationService.js'; // merge into the existing import line from this module
import type { CivilProtectionAlertRepository } from './ports/CivilProtectionAlertRepository.js';
```

(merge `ALERT_112_SOURCE_ID` into the existing `@pyrmap/shared` import line rather than adding a second one)

- [ ] **Step 2: Construct the alert repository/ingestion alongside the existing incident block**

Right after the existing `incidentIngestion`/`incidentRepository`/`geocodingSource` block (after the line `const geocodingSource = incidentIngestion ? new NominatimClient() : undefined;`), add:

```ts
  // @112Greece's official civil-protection alerts — same X_BEARER_TOKEN gate and same
  // NominatimClient instance as incident reports (shares its rate limiter; findAreaPolygon is a
  // new method on the same class, see docs/superpowers/specs/2026-07-23-112-civil-protection-alerts-design.md).
  let alertIngestion: { source: IncidentSource; repository: CivilProtectionAlertRepository; sourceId: string } | undefined;
  let alertRepository: CivilProtectionAlertRepository | undefined;
  if (!process.env.FIRMS_MOCK && config.xBearerToken) {
    alertRepository = new SqliteCivilProtectionAlertRepository(config.dbPath);
    alertIngestion = {
      source: new Alert112XClient(config.xBearerToken),
      repository: alertRepository,
      sourceId: ALERT_112_SOURCE_ID,
    };
  }

  // Reuses the SAME NominatimClient instance as incidents' geocodingSource (when configured) so
  // both features share one rate limiter, not two independently hammering the public API.
  const polygonSource = geocodingSource; // NominatimClient implements GeocodingSource AND AreaPolygonSource
```

- [ ] **Step 3: Pass the new repository into `buildApp` and log the feature state**

Update the `buildApp(...)` call to insert `alertRepository` as the new argument (per Task 13 Step 4's positional change):

```ts
  const app = await buildApp(
    config,
    repository,
    undefined,
    undefined,
    incidentRepository,
    alertRepository,
    updateBus,
    auth,
    pushSubscriptionRepository,
    vapid?.publicKey ?? null,
    () => scheduler,
    geocodingSource,
  );
```

Add a log block near the existing `incidentIngestion` log block:

```ts
  if (alertIngestion) {
    app.log.info('112 civil-protection alerts enabled (X API)');
  } else if (!process.env.FIRMS_MOCK) {
    app.log.warn('X_BEARER_TOKEN not set — 112 alerts layer disabled');
  }
```

- [ ] **Step 4: Wire into the scheduler**

Update the `startScheduler({...})` call to add:

```ts
    alertIngestion,
    polygonSource,
    onNewAlerts: pushSubscriptionRepository
      ? (alerts) => void notifyNewAlerts(pushSubscriptionRepository, alerts, (m) => app.log.info(m))
      : undefined,
```

(add these alongside the existing `incidentIngestion`, `geocodingSource`, `onNewIncidents` entries in that same object literal)

- [ ] **Step 5: Build and run the full server test suite**

Run: `pnpm --filter @pyrmap/server build && pnpm --filter @pyrmap/server test`
Expected: build succeeds, every test in the package PASSES (this is the first point where a missed wiring mistake anywhere in Tasks 2-14 would surface as a build or test failure).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/index.ts
git commit -m "feat(server): wire 112 alert ingestion, geocoding, push, and scheduler in index.ts"
```

---

### Task 15: Frontend — marker, area layer, edit controls, layer toggle

**Files:**
- Modify: `packages/web/src/api/client.ts`
- Modify: `packages/web/src/lib/layerPrefs.ts`
- Create: `packages/web/src/components/Alert112Marker.tsx`
- Create: `packages/web/src/components/Alert112AreaLayer.tsx`
- Create: `packages/web/src/components/Alert112EditControls.tsx`
- Modify: `packages/web/src/components/FireMap.tsx`
- Modify: `packages/web/src/components/LayersPanel.tsx`
- Modify: `packages/web/src/MapApp.tsx`
- Modify: `packages/web/src/index.css`
- Test: `packages/web/src/lib/layerPrefs.test.ts` (append)

**Interfaces:**
- Consumes: `CivilProtectionAlert` from `@pyrmap/shared`; `data.alerts` from `useFires`.
- Produces: a fully rendered, editable 112 alerts layer on the map.

- [ ] **Step 1: Add API client functions**

Append to `packages/web/src/api/client.ts` (add `CivilProtectionAlert` to the existing `@pyrmap/shared` import line):

```ts
export async function updateAlertLocation(id: number, latitude: number, longitude: number): Promise<CivilProtectionAlert> {
  const response = await fetch(`/api/alerts/${id}/location`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ latitude, longitude }),
  });
  if (!response.ok) {
    throw new Error(`PATCH /api/alerts/${id}/location failed: HTTP ${response.status}`);
  }
  return (await response.json()) as CivilProtectionAlert;
}

export async function hideAlert(id: number): Promise<void> {
  const response = await fetch(`/api/alerts/${id}/hide`, { method: 'POST' });
  if (!response.ok) {
    throw new Error(`POST /api/alerts/${id}/hide failed: HTTP ${response.status}`);
  }
}

export async function deleteAlert(id: number): Promise<void> {
  const response = await fetch(`/api/alerts/${id}`, { method: 'DELETE' });
  if (!response.ok) {
    throw new Error(`DELETE /api/alerts/${id} failed: HTTP ${response.status}`);
  }
}
```

- [ ] **Step 2: Add the `alert112` layer preference**

In `packages/web/src/lib/layerPrefs.ts`:

Add to the `LayerPrefs` interface:

```ts
  /** Show 112 civil-protection alerts (@112Greece, official — any hazard, not fire-specific). */
  alert112: boolean;
```

Add to `DEFAULT_LAYER_PREFS`:

```ts
  alert112: true,
```

Add to `loadStoredLayerPrefs`'s returned object:

```ts
      alert112: parsed.alert112 !== false, // default true, same reasoning as reportedIncidents
```

- [ ] **Step 3: Append a layerPrefs test**

Append to `packages/web/src/lib/layerPrefs.test.ts` (check its existing structure/imports first and match them):

```ts
it('defaults alert112 to true and respects a stored false', () => {
  expect(loadStoredLayerPrefs().alert112).toBe(true);
  localStorage.setItem('pyrmap-layers', JSON.stringify({ alert112: false }));
  expect(loadStoredLayerPrefs().alert112).toBe(false);
});
```

- [ ] **Step 4: Write `Alert112Marker.tsx`**

Create `packages/web/src/components/Alert112Marker.tsx`:

```tsx
import { useState } from 'react';
import { Marker, Popup } from 'react-leaflet';
import { divIcon } from 'leaflet';
import type { Marker as LeafletMarkerInstance } from 'leaflet';
import type { CivilProtectionAlert } from '@pyrmap/shared';
import { formatAthensTime, formatRelativeTime } from '../lib/formatting.js';
import { Alert112EditControls } from './Alert112EditControls.js';
import { updateAlertLocation } from '../api/client.js';
import { trackEvent } from '../lib/analytics.js';

const PRECISION_LABEL: Record<CivilProtectionAlert['precision'], string> = {
  locality: 'Location: the specific named area (from the alert text)',
  regional_unit: 'Location: regional-unit-level only — the alert named only the wider region',
};

const ALERT_COLOR = '#dc2626';

// A pin silhouette matching the same conventions as IncidentMarker (tip-anchored, "someone
// pointed here"), with an exclamation mark instead of a flame — deliberately distinct so this
// reads as "official emergency alert", not "someone reported a fire". Fixed color, not an
// age-gradient: unlike a Fire Service situational update, a 112 activation should stay visually
// prominent for as long as it's shown, not fade over the course of a few hours.
function alertPinSvg(): string {
  return `<svg width="26" height="34" viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg">
  <path d="M13 0C5.82 0 0 5.82 0 13c0 9.75 13 21 13 21s13-11.25 13-21C26 5.82 20.18 0 13 0z" fill="${ALERT_COLOR}"/>
  <circle cx="13" cy="13" r="7.5" fill="#fff"/>
  <path d="M13 7.5v6" stroke="${ALERT_COLOR}" stroke-width="2.2" stroke-linecap="round"/>
  <circle cx="13" cy="17.2" r="1.1" fill="${ALERT_COLOR}"/>
</svg>`;
}

const ICON = divIcon({
  className: 'alert112-marker-icon',
  html: alertPinSvg(),
  iconSize: [26, 34],
  iconAnchor: [13, 34],
  popupAnchor: [0, -30],
});

/** A 112 civil-protection activation (@112Greece) — see docs/superpowers/specs/2026-07-23-112-civil-protection-alerts-design.md. */
export function Alert112Marker({ alert, editMode }: { alert: CivilProtectionAlert; editMode: boolean }): JSX.Element {
  const [dragError, setDragError] = useState<string | null>(null);

  return (
    <Marker
      position={[alert.latitude, alert.longitude]}
      icon={ICON}
      draggable={editMode}
      eventHandlers={{
        click: () => trackEvent('marker_click', { tier: 'alert112' }),
        ...(editMode
          ? {
              dragend: (event: { target: LeafletMarkerInstance }) => {
                const marker = event.target;
                trackEvent('alert112_pin_dragged');
                const { lat, lng } = marker.getLatLng();
                updateAlertLocation(alert.id, lat, lng).catch(() => {
                  setDragError('Move failed — try again.');
                  marker.setLatLng([alert.latitude, alert.longitude]);
                });
              },
            }
          : {}),
      }}
    >
      <Popup>
        <div className="fire-popup">
          <strong>112 Alert (official civil-protection activation)</strong>
          <div>
            {formatAthensTime(alert.publishedAt)} ({formatRelativeTime(alert.publishedAt)})
          </div>
          <div lang="el">{alert.text}</div>
          <div className="fire-popup-caveat">
            <div>{PRECISION_LABEL[alert.precision]}</div>
          </div>
          <div>
            <a href={alert.url} target="_blank" rel="noreferrer" onClick={() => trackEvent('alert112_original_post_click')}>
              View original post ↗
            </a>
          </div>
          {editMode && <Alert112EditControls alert={alert} />}
          {dragError && <div className="incident-edit-error">{dragError}</div>}
        </div>
      </Popup>
    </Marker>
  );
}
```

- [ ] **Step 5: Write `Alert112AreaLayer.tsx`**

Create `packages/web/src/components/Alert112AreaLayer.tsx`:

```tsx
import { GeoJSON } from 'react-leaflet';
import type { CivilProtectionAlert } from '@pyrmap/shared';

const PATH_OPTIONS = { color: '#dc2626', weight: 2, fillOpacity: 0.15 };

/** Highlights a 112 alert's best-effort area polygon (locality boundary, or the containing
 * regional unit's as a coarser fallback) — see docs/superpowers/specs/2026-07-23-112-civil-protection-alerts-design.md.
 * react-leaflet's <GeoJSON> only reads its `data` prop once (on mount); this alert's polygon never
 * changes after ingestion except via a manual relocate, which clears it entirely (Alert112Marker
 * simply stops rendering this component in that case), so no `key` remount trick is needed. */
export function Alert112AreaLayer({ alert }: { alert: CivilProtectionAlert }): JSX.Element | null {
  if (!alert.areaPolygon) return null;
  return <GeoJSON data={alert.areaPolygon} pathOptions={PATH_OPTIONS} />;
}
```

- [ ] **Step 6: Write `Alert112EditControls.tsx` — same structure as `IncidentEditControls.tsx`, reusing its CSS classes (purely layout/structural, not incident-specific)**

Create `packages/web/src/components/Alert112EditControls.tsx`:

```tsx
import { useState } from 'react';
import type { CivilProtectionAlert, LocationSearchResult } from '@pyrmap/shared';
import { deleteAlert, hideAlert, searchLocations, updateAlertLocation } from '../api/client.js';
import { trackEvent } from '../lib/analytics.js';

/** Correction controls for a 112 alert pin, shown in edit mode — same semantics as
 * IncidentEditControls (manual lat/lon, place search, hide/delete forever); reuses its CSS
 * classes since they're purely structural, not incident-specific. */
export function Alert112EditControls({ alert }: { alert: CivilProtectionAlert }): JSX.Element {
  const [lat, setLat] = useState(String(alert.latitude));
  const [lon, setLon] = useState(String(alert.longitude));
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
    trackEvent('alert112_pin_manual_save');
    void run(() => updateAlertLocation(alert.id, parsedLat, parsedLon).then(() => undefined));
  }

  function handleSearch(): void {
    if (!query.trim()) return;
    void run(() =>
      searchLocations(query).then((found) => {
        trackEvent('alert112_location_search', { resultCount: found.length });
        setResults(found);
      }),
    );
  }

  function handlePickResult(result: LocationSearchResult): void {
    trackEvent('alert112_pin_search_pick');
    void run(() => updateAlertLocation(alert.id, result.latitude, result.longitude).then(() => undefined));
  }

  function handleHide(): void {
    if (!confirm('Hide this pin? It will be hidden forever, even if the same post is scanned again — this cannot be undone.')) return;
    trackEvent('alert112_pin_hidden');
    void run(() => hideAlert(alert.id));
  }

  function handleDelete(): void {
    if (!confirm('Delete this pin forever? Unlike Hide, a future re-scan may re-add it if it fetches this same post again.')) return;
    trackEvent('alert112_pin_deleted');
    void run(() => deleteAlert(alert.id));
  }

  return (
    <div className="incident-edit-controls">
      <div className="incident-edit-row">
        <input type="number" step="any" value={lat} onChange={(event) => setLat(event.target.value)} aria-label="Latitude" disabled={busy} />
        <input type="number" step="any" value={lon} onChange={(event) => setLon(event.target.value)} aria-label="Longitude" disabled={busy} />
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

- [ ] **Step 7: Wire into `FireMap.tsx`**

Add imports:

```ts
import type { CivilProtectionAlert } from '@pyrmap/shared'; // merge into the existing @pyrmap/shared import line
import { Alert112Marker } from './Alert112Marker.js';
import { Alert112AreaLayer } from './Alert112AreaLayer.js';
```

Add `alerts: CivilProtectionAlert[];` to `FireMapProps` (after `incidents`), and add `alerts` to the destructured props in the function signature.

Add rendering, after the existing `{prefs.reportedIncidents && ...}` block, before the closing `</MapContainer>`:

```tsx
      {prefs.alert112 &&
        alerts.map((alert) => (
          <span key={alert.id}>
            {alert.areaPolygon && <Alert112AreaLayer alert={alert} />}
            <Alert112Marker alert={alert} editMode={editMode} />
          </span>
        ))}
```

(A bare `<span>` as the map-key wrapper is a pragmatic choice here since JSX requires a single element per array item and neither `Alert112AreaLayer` nor `Alert112Marker` renders inside a Leaflet pane that cares about wrapping DOM — react-leaflet's children resolve via context, not DOM nesting, so this is safe; if this turns out to visually break tile rendering in Step 9's browser check, switch to `<Fragment key={alert.id}>` from `'react'` instead — functionally identical, no DOM node at all.)

- [ ] **Step 8: Wire into `LayersPanel.tsx` and `MapApp.tsx`**

In `LayersPanel.tsx`, add a new checkbox row after the "Reported fires" row, inside the same `layers-group`:

```tsx
            <label className="layers-row">
              <input type="checkbox" checked={prefs.alert112} onChange={() => onChange({ ...prefs, alert112: !prefs.alert112 })} />
              112 Alerts (official, any hazard)
            </label>
```

In `MapApp.tsx`, add `'alert112'` to the `changeLayerPrefs` tracked-keys tuple (currently `['effisHotspots', 'effisBurntAreas', 'wind', 'showUnconfirmed', 'reportedIncidents']`), and pass `alerts={data?.alerts ?? []}` to the `<FireMap>` element alongside the existing `incidents={data?.incidents ?? []}`.

- [ ] **Step 9: Add CSS for the new marker icon**

Append to `packages/web/src/index.css`, near the existing `.incident-marker-icon` rules:

```css
.alert112-marker-icon {
  background: transparent;
  border: none;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.45));
  transition: transform 0.12s ease;
}

.alert112-marker-icon:hover {
  transform: scale(1.1);
}
```

- [ ] **Step 10: Build the web package**

Run: `pnpm --filter @pyrmap/web build`
Expected: no TypeScript errors, Vite build succeeds.

- [ ] **Step 11: Run the web test suite**

Run: `pnpm --filter @pyrmap/web test`
Expected: all tests PASS, including the new `layerPrefs` test.

- [ ] **Step 12: Manual browser verification (required — no automated component tests exist in this codebase for map markers, per existing convention)**

Start the app against mock data (`pnpm --filter @pyrmap/server dev:mock` from repo root, or the project's existing equivalent dev command) and the web dev server, then in a real browser: confirm the "112 Alerts" toggle appears in the Layers panel; if any test alert row exists in the dev DB (or inject one via a temporary manual DB insert, then remove it), confirm the pin renders with the exclamation-mark icon distinct from the flame pin, its popup shows the alert text and precision label, and — if it has a polygon — the highlighted area renders around it; toggle edit mode and confirm drag/manual-entry/search/hide/delete all work exactly like the existing incident controls. This mirrors the "run" skill's existing verification convention for this project (see docs/DECISIONS.md 2026-07-23 entries about real-browser verification) — screenshot the result if convenient, but a live description of what was seen also satisfies CLAUDE.md's "test the golden path" rule for UI changes.

- [ ] **Step 13: Commit**

```bash
git add packages/web/src/api/client.ts packages/web/src/lib/layerPrefs.ts packages/web/src/lib/layerPrefs.test.ts packages/web/src/components/Alert112Marker.tsx packages/web/src/components/Alert112AreaLayer.tsx packages/web/src/components/Alert112EditControls.tsx packages/web/src/components/FireMap.tsx packages/web/src/components/LayersPanel.tsx packages/web/src/MapApp.tsx packages/web/src/index.css
git commit -m "feat(web): render 112 alerts as a distinct pin + area-highlight layer"
```

---

### Task 16: Full verification, decision log, TODO note, final check

**Files:**
- Modify: `docs/DECISIONS.md`
- Modify: `docs/TODO.md`

- [ ] **Step 1: Run the full repository build and test suite**

Run: `pnpm -r build && pnpm test`
Expected: everything passes — this is the mandatory pre-commit gate from CLAUDE.md §2, run once at the end of the whole feature as well as after each task.

- [ ] **Step 2: Append decision log entries**

Append to `docs/DECISIONS.md` (new lines, do not edit any existing line):

```
2026-07-23 | server,shared | new "112 civil-protection alerts" concept added, parallel to incident_reports (own table/port/adapter/ingest/rescan/marker/layer), not merged into it | explicit user request; @112Greece alerts are official-source, any-hazard, and carry an area polygon rather than just a point — structurally different the same way incident_reports was judged different from detections (2026-07-20 entry)
2026-07-23 | server | @112Greece's numeric X user id resolved once via a live lookup: 1187287012442804225 | same one-time-lookup pattern as PYROSVESTIKI_USER_ID
2026-07-23 | server | isAlert112Post gates on the literal Greek word "Ενεργοποίηση", not the emoji header | @112Greece posts every alert twice (Greek + English "Activation..."); this single check both classifies the post and skips the English duplicate for free, no cross-language timestamp matching needed
2026-07-23 | server | regional-unit boundary polygons for the area-highlight fallback fetched once via Nominatim (52 of 54 units resolved; polygon_threshold=0.005 simplification, same technique as the existing country-outline greeceBoundary.json) and bundled as static JSON | Κυκλάδες and Αττική have no single corresponding OSM regional-unit polygon (both are periphery-level groupings) — documented known gap, not a bug; a 112 post naming only one of these two gets a point pin with no polygon
2026-07-23 | server | NominatimClient gained findAreaPolygon (polygon_geojson=1, same trusted-addresstype filter as geocode()), additive only — geocode()/search()'s own requests are unchanged | shares the same rate limiter/instance as incident-report geocoding rather than a second client hammering the same public API independently
```

- [ ] **Step 3: Append to `docs/TODO.md`**

Append (following the file's existing bullet-fact style, max 5 lines per CLAUDE.md §7):

```
- 112 alerts feature complete (ingest/geocode/polygon/push/routes/frontend) — see docs/superpowers/specs/2026-07-23-112-civil-protection-alerts-design.md
- Known gap: Κυκλάδες and Αττική regional units have no bundled boundary polygon (periphery-level groupings, not single OSM regional units) — point pin only if a 112 post names only one of these
- Known gap: alert retention (deleteAlertsBefore) exists on the repository but isn't yet wired into runRetention's daily sweep — alerts currently accumulate indefinitely; low priority (112 activations are rare relative to detections/incidents) but should be added if this becomes a real storage concern
- Already-failed 112 posts logged before this feature's parser matures won't auto-recover via since_id polling (same limitation incident reports have) — use the existing rescan feature to backfill
```

- [ ] **Step 4: Verify the tree is clean and everything is committed**

Run: `git status`
Expected: `nothing to commit, working tree clean` after adding these two doc files.

- [ ] **Step 5: Commit**

```bash
git add docs/DECISIONS.md docs/TODO.md
git commit -m "docs(repo): log 112 alerts decisions and remaining known gaps"
```

---

## Self-Review Notes (for whoever executes this plan)

- **Spec coverage:** every section of `docs/superpowers/specs/2026-07-23-112-civil-protection-alerts-design.md` maps to a task — data model (2), ingestion/parsing (3, 8, 9), geocoding/polygons (4, 5, 6, 7), API/push/scheduler (11, 12, 13, 14), frontend (15), testing (woven into every task), known gaps (16).
- **Retention** was in the design's data model but not its "API/push/scheduler" section explicitly — Task 12's note explains why it's deliberately deferred (flagged in TODO, not silently dropped).
- **Type consistency check:** `NewAlertRow`/`CivilProtectionAlert`/`AlertPrecision`/`AlertAreaPolygon` names are used identically from Task 1 through Task 15 — verify this holds if you deviate from any step's exact code.
- Tasks 4 and 6 modify shared, actively-used existing files (`incidentGeocoding.ts`, `NominatimClient.ts`) — both are additive-only by construction (new exports, new optional parameter with a default reproducing today's behavior) and each task explicitly requires the *existing* test suite for that file to keep passing, not just the new tests.
