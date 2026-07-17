import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteFireRepository } from '../src/adapters/sqlite/SqliteFireRepository.js';
import { ingestSource } from '../src/services/ingestService.js';
import { runConfirmationPass } from '../src/services/confirmationService.js';
import { FakeFireDataSource } from './fakes/FakeFireDataSource.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const readFixture = (name: string): string => readFileSync(path.join(fixturesDir, name), 'utf-8');
const NOW = () => new Date('2026-07-15T12:00:00Z');

let tmpDir: string;
let repo: SqliteFireRepository;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'pyrmap-confirmation-test-'));
  repo = new SqliteFireRepository(path.join(tmpDir, 'test.db'));
});

afterEach(() => {
  repo.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('runConfirmationPass', () => {
  it('confirms a geo detection corroborated by a nearby, close-in-time polar detection', async () => {
    const dataSource = new FakeFireDataSource({
      MSG_NRT: readFixture('msg_geo_sample.csv'),
      VIIRS_NOAA20_NRT: readFixture('viirs_sample.csv'),
    });

    const geoResult = await ingestSource({
      dataSource,
      repository: repo,
      sourceId: 'MSG_NRT',
      tier: 'geo',
      bboxString: '19,34.5,29.7,42',
      dayRange: 1,
      now: NOW,
    });
    const polarResult = await ingestSource({
      dataSource,
      repository: repo,
      sourceId: 'VIIRS_NOAA20_NRT',
      tier: 'polar',
      bboxString: '19,34.5,29.7,42',
      dayRange: 1,
      now: NOW,
    });
    expect(geoResult.rowsInserted).toBe(2);
    expect(polarResult.rowsInserted).toBe(3);

    const { confirmed } = runConfirmationPass(repo, NOW);
    expect(confirmed).toBe(1);

    // MSG_NRT row 1 (38.1250,23.5690 @ 09:35Z) is corroborated by the nearest VIIRS row
    // (38.1234,23.5678 @ 09:30Z, ~0.2km away, 5min apart). MSG_NRT row 2 (40.0,22.0) has no candidate nearby.
    const remainingUnconfirmed = repo.findUnconfirmedGeoDetections();
    expect(remainingUnconfirmed).toHaveLength(1);
    expect(remainingUnconfirmed[0]!.latitude).toBeCloseTo(40.0, 3);

    // MSG_NRT rows were inserted first, so their detection ids are 1 and 2.
    const confirmedStatus = repo.findGeoStatus(1)!;
    expect(confirmedStatus.status).toBe('confirmed');
    expect(confirmedStatus.confirmedById).not.toBeNull();

    const stillUnconfirmedStatus = repo.findGeoStatus(2)!;
    expect(stillUnconfirmedStatus.status).toBe('unconfirmed');
  });
});
