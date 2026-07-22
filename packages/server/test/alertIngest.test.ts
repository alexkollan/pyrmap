import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MTG_FIR_SOURCE_ID } from '@pyrmap/shared';
import { SqliteFireRepository } from '../src/adapters/sqlite/SqliteFireRepository.js';
import { ingestFireAlerts } from '../src/services/alertIngestService.js';
import type { FireAlert, FireAlertSource } from '../src/ports/FireAlertSource.js';

const NOW = () => new Date('2026-07-18T09:45:00Z');
const MTG_CONFIG = { sourceId: MTG_FIR_SOURCE_ID, satellite: 'MTG-I1', instrument: 'FCI' };

class FakeAlertSource implements FireAlertSource {
  constructor(private readonly alerts: FireAlert[]) {}
  async fetchRecentAlerts(): Promise<FireAlert[]> {
    return this.alerts;
  }
}

// Mirrors the fixture: 2 real Greek circles, 3 outside (Africa/S. America), and one (41.933,26.412)
// that passes the loose rectangular bbox pre-filter below but is actually ~25km inside Bulgaria —
// verified against the real boundary polygon (see docs/DECISIONS.md 2026-07-22). Kept deliberately
// to prove the precise isWithinGreece check (wired into persistNewDetections) rejects it even
// though the coarse rectangular pre-filter here does not.
const ALERT: FireAlert = {
  productId: 'TEST_PRODUCT',
  acquiredAt: '2026-07-18T09:20:00Z',
  circles: [
    { latitude: -27.764, longitude: 31.072, radiusKm: 1.319 },
    { latitude: 38.212, longitude: 23.911, radiusKm: 1.201 },
    { latitude: 39.402, longitude: 22.087, radiusKm: 1.243 },
    { latitude: -16.973, longitude: -60.754, radiusKm: 2.14 },
    { latitude: 41.933, longitude: 26.412, radiusKm: 1.288 },
  ],
};

let tmpDir: string;
let repo: SqliteFireRepository;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'pyrmap-alert-test-'));
  repo = new SqliteFireRepository(path.join(tmpDir, 'test.db'));
});

afterEach(() => {
  repo.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('ingestFireAlerts', () => {
  it('inserts only Greece-bbox circles as unconfirmed geo detections with footprint from radius', async () => {
    const result = await ingestFireAlerts(new FakeAlertSource([ALERT]), MTG_CONFIG, repo, NOW);

    expect(result).toEqual({ rowsParsed: 3, rowsInserted: 2, error: null });

    const geo = repo.findGeoDetectionsSince('2026-07-18T00:00:00Z', false);
    expect(geo).toHaveLength(2);
    expect(geo.find((d) => d.latitude === 41.933)).toBeUndefined(); // the Bulgaria point, correctly excluded
    expect(geo.every((d) => d.source === MTG_FIR_SOURCE_ID && d.status === 'unconfirmed')).toBe(true);

    const athens = geo.find((d) => d.latitude === 38.212)!;
    expect(athens.scanKm).toBeCloseTo(2.402); // 2 * radius -> frontend footprint radius = 1.201km
    expect(athens.satellite).toBe('MTG-I1');
    expect(athens.acquiredAt).toBe('2026-07-18T09:20:00Z');
  });

  it('re-ingesting the same alert inserts 0 new rows', async () => {
    await ingestFireAlerts(new FakeAlertSource([ALERT]), MTG_CONFIG, repo, NOW);
    const second = await ingestFireAlerts(new FakeAlertSource([ALERT]), MTG_CONFIG, repo, NOW);
    expect(second.rowsInserted).toBe(0);
  });

  it('records a fetch_log error and does not throw when the source fails', async () => {
    const failing: FireAlertSource = {
      fetchRecentAlerts: async () => {
        throw new Error('EUMETSAT down');
      },
    };

    const result = await ingestFireAlerts(failing, MTG_CONFIG, repo, NOW);

    expect(result.error).toBe('EUMETSAT down');
    expect(repo.findLastFetchPerSource()[MTG_FIR_SOURCE_ID]).toMatchObject({ ok: false, rowsInserted: 0 });
  });

  it('feeds the confirmation machinery: a polar detection nearby confirms the MTG alert', async () => {
    await ingestFireAlerts(new FakeAlertSource([ALERT]), MTG_CONFIG, repo, NOW);

    // polar detection ~1km from the 38.212,23.911 alert, 40min later
    repo.insertDetections([
      {
        dedupKey: 'polar-test',
        tier: 'polar',
        source: 'VIIRS_NOAA20_NRT',
        latitude: 38.221,
        longitude: 23.911,
        acquiredAt: '2026-07-18T10:00:00Z',
        frp: 15,
        confidence: 'n',
        satellite: 'N20',
        instrument: 'VIIRS',
        daynight: 'D',
        scanKm: 0.4,
        trackKm: 0.4,
      },
    ]);

    const { runConfirmationPass } = await import('../src/services/confirmationService.js');
    const { confirmed } = runConfirmationPass(repo, NOW);
    expect(confirmed).toBe(1);
  });
});
