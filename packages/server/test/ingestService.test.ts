import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteFireRepository } from '../src/adapters/sqlite/SqliteFireRepository.js';
import { ingestSource } from '../src/services/ingestService.js';
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
});
