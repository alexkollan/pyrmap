import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { SqliteFireRepository } from '../src/adapters/sqlite/SqliteFireRepository.js';
import type { NewDetectionRow } from '../src/ports/FireRepository.js';

const NOW = () => new Date('2026-07-15T12:00:00Z');

let tmpDir: string;
let repo: SqliteFireRepository;

const detectionRow = (overrides: Partial<NewDetectionRow>): NewDetectionRow => ({
  dedupKey: Math.random().toString(),
  tier: 'polar',
  source: 'VIIRS_NOAA20_NRT',
  latitude: 38.0,
  longitude: 23.0,
  acquiredAt: '2026-07-15T10:00:00Z',
  frp: 10,
  confidence: 'n',
  satellite: 'N',
  instrument: 'VIIRS',
  daynight: 'D',
  scanKm: 0.4,
  trackKm: 0.4,
  ...overrides,
});

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'pyrmap-fires-test-'));
  repo = new SqliteFireRepository(path.join(tmpDir, 'test.db'));

  // 1 polar detection within the window
  repo.insertDetections([detectionRow({ tier: 'polar', acquiredAt: '2026-07-15T10:00:00Z' })]);

  // 1 unconfirmed geo detection within the window
  const [unconfirmed] = repo.insertDetections([
    detectionRow({ tier: 'geo', source: 'MSG_NRT', acquiredAt: '2026-07-15T11:00:00Z' }),
  ]);
  repo.insertUnconfirmedGeoStatus([unconfirmed!.id], '2026-07-15T11:00:00Z');

  // 1 confirmed geo detection within the window
  const [confirmed] = repo.insertDetections([
    detectionRow({ tier: 'geo', source: 'MSG_NRT', acquiredAt: '2026-07-15T11:30:00Z' }),
  ]);
  const [confirmingPolar] = repo.insertDetections([
    detectionRow({ tier: 'polar', acquiredAt: '2026-07-15T11:31:00Z' }),
  ]);
  repo.insertUnconfirmedGeoStatus([confirmed!.id], '2026-07-15T11:30:00Z');
  repo.confirmGeoDetection(confirmed!.id, confirmingPolar!.id, '2026-07-15T11:31:00Z');

  // 1 expired geo detection within the window
  const [expired] = repo.insertDetections([
    detectionRow({ tier: 'geo', source: 'MSG_NRT', acquiredAt: '2026-07-15T10:30:00Z' }),
  ]);
  repo.insertUnconfirmedGeoStatus([expired!.id], '2026-07-15T10:30:00Z');
  repo.expireGeoDetections([expired!.id], '2026-07-15T11:00:00Z');
});

afterEach(() => {
  repo.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('GET /api/fires', () => {
  it('returns the correct shape and excludes expired detections by default', async () => {
    const app = await buildApp({ logLevel: 'silent' }, repo, NOW);
    const response = await app.inject({ method: 'GET', url: '/api/fires?hours=24' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.generatedAt).toBe('2026-07-15T12:00:00.000Z');
    expect(body.polar).toHaveLength(2); // the standalone polar row + the one that confirmed the geo row
    expect(body.geo).toHaveLength(2); // unconfirmed + confirmed, not expired
    expect(body.geo.every((d: { status: string }) => d.status !== 'expired')).toBe(true);

    await app.close();
  });

  it('includes expired detections when includeExpired=true', async () => {
    const app = await buildApp({ logLevel: 'silent' }, repo, NOW);
    const response = await app.inject({ method: 'GET', url: '/api/fires?hours=24&includeExpired=true' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.geo).toHaveLength(3);
    expect(body.geo.some((d: { status: string }) => d.status === 'expired')).toBe(true);

    await app.close();
  });

  it('returns 400 for a non-integer hours param', async () => {
    const app = await buildApp({ logLevel: 'silent' }, repo, NOW);
    const response = await app.inject({ method: 'GET', url: '/api/fires?hours=abc' });
    expect(response.statusCode).toBe(400);
    await app.close();
  });
});
