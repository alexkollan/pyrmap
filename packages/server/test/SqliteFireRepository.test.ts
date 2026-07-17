import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteFireRepository } from '../src/adapters/sqlite/SqliteFireRepository.js';
import type { NewDetectionRow } from '../src/ports/FireRepository.js';

let tmpDir: string;
let repo: SqliteFireRepository;

const row = (overrides: Partial<NewDetectionRow> = {}): NewDetectionRow => ({
  dedupKey: 'MSG_NRT|38.1234|23.5678|2026-07-15T09:30:00Z',
  tier: 'geo',
  source: 'MSG_NRT',
  latitude: 38.1234,
  longitude: 23.5678,
  acquiredAt: '2026-07-15T09:30:00Z',
  frp: 12.3,
  confidence: 'n',
  satellite: 'MSG',
  instrument: null,
  daynight: 'D',
  scanKm: null,
  trackKm: null,
  ...overrides,
});

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'pyrmap-test-'));
  repo = new SqliteFireRepository(path.join(tmpDir, 'test.db'));
});

afterEach(() => {
  repo.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('SqliteFireRepository', () => {
  it('inserts a new row and returns it with an id', () => {
    const [inserted] = repo.insertDetections([row()]);
    expect(inserted).toMatchObject({ id: expect.any(Number), dedupKey: row().dedupKey });
  });

  it('ignores a duplicate dedup_key on re-insert', () => {
    repo.insertDetections([row()]);
    const second = repo.insertDetections([row()]);
    expect(second).toEqual([]);
  });

  it('inserts unconfirmed geo_status rows for given detection ids without throwing', () => {
    const [inserted] = repo.insertDetections([row()]);
    expect(() => repo.insertUnconfirmedGeoStatus([inserted!.id], '2026-07-15T09:30:00Z')).not.toThrow();
  });

  it('records a fetch_log entry without throwing', () => {
    expect(() =>
      repo.recordFetchLog({
        source: 'MSG_NRT',
        fetchedAt: '2026-07-15T09:30:00Z',
        httpStatus: 200,
        rowsParsed: 1,
        rowsInserted: 1,
        error: null,
      }),
    ).not.toThrow();
  });

  it('reports healthy when the DB is reachable', () => {
    expect(repo.healthCheck()).toBe(true);
  });
});
