import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SqliteFireRepository } from '../src/adapters/sqlite/SqliteFireRepository.js';
import { startScheduler } from '../src/jobs/scheduler.js';
import { FakeFireDataSource } from './fakes/FakeFireDataSource.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const readFixture = (name: string): string => readFileSync(path.join(fixturesDir, name), 'utf-8');

let tmpDir: string;
let repo: SqliteFireRepository;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'pyrmap-scheduler-test-'));
  repo = new SqliteFireRepository(path.join(tmpDir, 'test.db'));
});

afterEach(() => {
  repo.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('startScheduler', () => {
  it('runs poll-geo only against geo-tier sources and poll-polar only against polar-tier sources', async () => {
    const dataSource = new FakeFireDataSource({
      MSG_NRT: readFixture('msg_geo_sample.csv'),
      VIIRS_NOAA20_NRT: readFixture('viirs_sample.csv'),
    });

    const insertSpy = vi.spyOn(repo, 'insertDetections');

    const scheduler = startScheduler({
      dataSource,
      repository: repo,
      effectiveSources: { MSG_NRT: 'geo', VIIRS_NOAA20_NRT: 'polar' },
      now: () => new Date('2026-07-15T12:00:00Z'),
    });
    scheduler.stop();

    // startScheduler kicks off pollGeo/pollPolar immediately as fire-and-forget; let those settle before
    // clearing the spy so they don't interleave with the explicit calls below.
    await new Promise((resolve) => setTimeout(resolve, 50));
    insertSpy.mockClear();

    await scheduler.pollGeo();
    await scheduler.pollPolar();

    const callsBySource = new Map(insertSpy.mock.calls.map((call) => [call[0][0]?.source, call[0]]));
    expect(callsBySource.get('MSG_NRT')?.every((r) => r.tier === 'geo')).toBe(true);
    expect(callsBySource.get('VIIRS_NOAA20_NRT')?.every((r) => r.tier === 'polar')).toBe(true);
    expect(insertSpy).toHaveBeenCalledTimes(2);
  });
});
