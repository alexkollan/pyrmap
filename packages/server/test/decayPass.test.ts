import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteFireRepository } from '../src/adapters/sqlite/SqliteFireRepository.js';
import { runDecayPass } from '../src/services/decayService.js';
import type { NewDetectionRow } from '../src/ports/FireRepository.js';

const NOW = () => new Date('2026-07-15T12:00:00Z');

let tmpDir: string;
let repo: SqliteFireRepository;

const geoRow = (acquiredAt: string, dedupKey: string): NewDetectionRow => ({
  dedupKey,
  tier: 'geo',
  source: 'MSG_NRT',
  latitude: 38.0,
  longitude: 23.0,
  acquiredAt,
  frp: null,
  confidence: null,
  satellite: null,
  instrument: null,
  daynight: null,
});

const polarRow = (dedupKey: string): NewDetectionRow => ({
  ...geoRow('2026-07-15T00:00:00Z', dedupKey),
  tier: 'polar',
  source: 'VIIRS_NOAA20_NRT',
});

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'pyrmap-decay-test-'));
  repo = new SqliteFireRepository(path.join(tmpDir, 'test.db'));
});

afterEach(() => {
  repo.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('runDecayPass', () => {
  it('expires only unconfirmed geo detections older than 12h', () => {
    const [fresh] = repo.insertDetections([geoRow('2026-07-15T00:01:00Z', 'a')]); // 11h59m old
    const [stale] = repo.insertDetections([geoRow('2026-07-14T23:59:00Z', 'b')]); // 12h1m old
    repo.insertUnconfirmedGeoStatus([fresh!.id, stale!.id], '2026-07-15T00:00:00Z');

    const { expired } = runDecayPass(repo, NOW);
    expect(expired).toBe(1);

    expect(repo.findGeoStatus(fresh!.id)!.status).toBe('unconfirmed');
    expect(repo.findGeoStatus(stale!.id)!.status).toBe('expired');
  });

  it('does not touch already-confirmed geo detections', () => {
    const [confirmed] = repo.insertDetections([geoRow('2026-07-14T20:00:00Z', 'c')]); // 16h old
    const [polar] = repo.insertDetections([polarRow('d')]);
    repo.insertUnconfirmedGeoStatus([confirmed!.id], '2026-07-15T00:00:00Z');
    repo.confirmGeoDetection(confirmed!.id, polar!.id, '2026-07-15T00:00:00Z');

    const { expired } = runDecayPass(repo, NOW);
    expect(expired).toBe(0);
    expect(repo.findGeoStatus(confirmed!.id)!.status).toBe('confirmed');
  });
});
