import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteFireRepository } from '../src/adapters/sqlite/SqliteFireRepository.js';
import { runRetention } from '../src/services/retentionService.js';
import type { NewDetectionRow } from '../src/ports/FireRepository.js';

const NOW = () => new Date('2026-07-15T12:00:00Z');

let tmpDir: string;
let repo: SqliteFireRepository;

const detectionRow = (acquiredAt: string, dedupKey: string): NewDetectionRow => ({
  dedupKey,
  tier: 'polar',
  source: 'VIIRS_NOAA20_NRT',
  latitude: 38.0,
  longitude: 23.0,
  acquiredAt,
  frp: null,
  confidence: null,
  satellite: null,
  instrument: null,
  daynight: null,
  scanKm: null,
  trackKm: null,
});

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'pyrmap-retention-test-'));
  repo = new SqliteFireRepository(path.join(tmpDir, 'test.db'));
});

afterEach(() => {
  repo.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('runRetention', () => {
  it('deletes detections older than 7 days and keeps recent ones', () => {
    repo.insertDetections([detectionRow('2026-07-01T00:00:00Z', 'old')]); // 14d old
    const [recent] = repo.insertDetections([detectionRow('2026-07-14T00:00:00Z', 'recent')]); // 1.5d old

    const { deletedDetections } = runRetention(repo, NOW);

    expect(deletedDetections).toBe(1);
    expect(repo.findPolarDetectionsSince('2020-01-01T00:00:00Z').map((d) => d.id)).toEqual([recent!.id]);
  });

  it('cascades deletion to geo_status via the FK', () => {
    const [oldGeo] = repo.insertDetections([{ ...detectionRow('2026-07-01T00:00:00Z', 'old-geo'), tier: 'geo' }]);
    repo.insertUnconfirmedGeoStatus([oldGeo!.id], '2026-07-01T00:00:00Z');

    runRetention(repo, NOW);

    expect(repo.findGeoStatus(oldGeo!.id)).toBeNull();
  });

  it('deletes fetch_log rows older than 14 days and keeps recent ones', () => {
    repo.recordFetchLog({
      source: 'MSG_NRT',
      fetchedAt: '2026-06-01T00:00:00Z', // 44d old
      httpStatus: 200,
      rowsParsed: 1,
      rowsInserted: 1,
      error: null,
    });
    repo.recordFetchLog({
      source: 'MSG_NRT',
      fetchedAt: '2026-07-14T00:00:00Z', // 1.5d old
      httpStatus: 200,
      rowsParsed: 1,
      rowsInserted: 1,
      error: null,
    });

    const { deletedFetchLogs } = runRetention(repo, NOW);

    expect(deletedFetchLogs).toBe(1);
    expect(repo.findLastFetchPerSource().MSG_NRT?.fetchedAt).toBe('2026-07-14T00:00:00Z');
  });
});
