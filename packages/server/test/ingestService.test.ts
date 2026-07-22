import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SqliteFireRepository } from '../src/adapters/sqlite/SqliteFireRepository.js';
import { ingestSource, persistNewDetections } from '../src/services/ingestService.js';
import { FakeFireDataSource } from './fakes/FakeFireDataSource.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const readFixture = (name: string): string => readFileSync(path.join(fixturesDir, name), 'utf-8');
const NOW = () => new Date('2026-07-15T12:00:00Z');

let tmpDir: string;
let repo: SqliteFireRepository;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'pyrmap-ingest-test-'));
  repo = new SqliteFireRepository(path.join(tmpDir, 'test.db'));
});

afterEach(() => {
  repo.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('ingestSource', () => {
  it('ingests a fixture CSV into the DB, then inserts 0 new rows on re-ingest', async () => {
    const dataSource = new FakeFireDataSource({ VIIRS_NOAA20_NRT: readFixture('viirs_sample.csv') });

    const first = await ingestSource({
      dataSource,
      repository: repo,
      sourceId: 'VIIRS_NOAA20_NRT',
      tier: 'polar',
      bboxString: '19,34.5,29.7,42',
      dayRange: 1,
      now: NOW,
    });
    expect(first).toMatchObject({ rowsParsed: 3, rowsSkipped: 1, rowsInserted: 3, error: null });

    const second = await ingestSource({
      dataSource,
      repository: repo,
      sourceId: 'VIIRS_NOAA20_NRT',
      tier: 'polar',
      bboxString: '19,34.5,29.7,42',
      dayRange: 1,
      now: NOW,
    });
    expect(second).toMatchObject({ rowsParsed: 3, rowsInserted: 0, error: null });
  });

  it('seeds geo_status only for geo-tier detections', async () => {
    const dataSource = new FakeFireDataSource({ MSG_NRT: readFixture('msg_geo_sample.csv') });

    const result = await ingestSource({
      dataSource,
      repository: repo,
      sourceId: 'MSG_NRT',
      tier: 'geo',
      bboxString: '19,34.5,29.7,42',
      dayRange: 1,
      now: NOW,
    });

    expect(result.rowsInserted).toBe(2);
  });

  it('records a fetch_log error and does not throw when the data source fails', async () => {
    const failingDataSource = {
      fetchAreaCsv: async () => {
        throw new Error('network down');
      },
      fetchAvailableSourceIds: async () => [],
    };

    const result = await ingestSource({
      dataSource: failingDataSource,
      repository: repo,
      sourceId: 'MSG_NRT',
      tier: 'geo',
      bboxString: '19,34.5,29.7,42',
      dayRange: 1,
      now: NOW,
    });

    expect(result.error).toBe('network down');
    expect(result.rowsInserted).toBe(0);
  });

  it("silently drops a row outside Greece's real boundary before insertion", () => {
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
});
