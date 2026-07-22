import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SqliteFireRepository } from '../src/adapters/sqlite/SqliteFireRepository.js';
import { SqliteIncidentReportRepository } from '../src/adapters/sqlite/SqliteIncidentReportRepository.js';
import { startScheduler } from '../src/jobs/scheduler.js';
import { FakeFireDataSource } from './fakes/FakeFireDataSource.js';
import type { IncidentSource, RawPost } from '../src/ports/IncidentSource.js';
import type { GeocodingSource } from '../src/ports/GeocodingSource.js';

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
      logsDir: path.join(tmpDir, 'logs'),
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

  it('calls onUpdate when a poll inserts new rows, but not when a re-poll finds nothing new', async () => {
    const dataSource = new FakeFireDataSource({ VIIRS_NOAA20_NRT: readFixture('viirs_sample.csv') });
    const onUpdate = vi.fn();

    const scheduler = startScheduler({
      dataSource,
      repository: repo,
      effectiveSources: { VIIRS_NOAA20_NRT: 'polar' },
      logsDir: path.join(tmpDir, 'logs'),
      now: () => new Date('2026-07-15T12:00:00Z'),
      onUpdate,
    });
    scheduler.stop();
    // startScheduler's own immediate pollPolar() inserts the fixture rows -> onUpdate fires.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onUpdate).toHaveBeenCalled();

    onUpdate.mockClear();
    await scheduler.pollPolar(); // same fixture again — dedup means 0 new rows this time
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('calls onNewDetections with the newly inserted rows when a poll finds something new', async () => {
    const dataSource = new FakeFireDataSource({ VIIRS_NOAA20_NRT: readFixture('viirs_sample.csv') });
    const onNewDetections = vi.fn();

    const scheduler = startScheduler({
      dataSource,
      repository: repo,
      effectiveSources: { VIIRS_NOAA20_NRT: 'polar' },
      logsDir: path.join(tmpDir, 'logs'),
      now: () => new Date('2026-07-15T12:00:00Z'),
      onNewDetections,
    });
    scheduler.stop();

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onNewDetections).toHaveBeenCalled();
    const [rows] = onNewDetections.mock.calls[0]!;
    expect(rows.every((r: { source: string }) => r.source === 'VIIRS_NOAA20_NRT')).toBe(true);
  });

  it('threads geocodingSource through to poll-incidents, preferring it over the offline gazetteer', async () => {
    const incidentRepo = new SqliteIncidentReportRepository(path.join(tmpDir, 'incidents.db'));
    const post: RawPost = {
      externalId: '1',
      text: 'Υπό μερικό έλεγχο τέθηκε η #πυρκαγιά στο Κορωπί Αττικής.',
      publishedAt: '2026-07-15T12:00:00Z',
      url: 'https://x.com/pyrosvestiki/status/1',
    };
    const incidentSource: IncidentSource = { fetchRecentPosts: async () => [post] };
    const geocodingSource: GeocodingSource = {
      geocode: async () => ({ latitude: 9.999, longitude: 8.888, precision: 'settlement' }),
    };

    const dataSource = new FakeFireDataSource({});
    const scheduler = startScheduler({
      dataSource,
      repository: repo,
      effectiveSources: {},
      incidentIngestion: { source: incidentSource, repository: incidentRepo, sourceId: 'TEST_SOURCE' },
      geocodingSource,
      logsDir: path.join(tmpDir, 'logs'),
      now: () => new Date('2026-07-15T12:00:00Z'),
    });
    scheduler.stop();

    await scheduler.pollIncidents();
    incidentRepo.close();

    const incidentRepoCheck = new SqliteIncidentReportRepository(path.join(tmpDir, 'incidents.db'));
    const stored = incidentRepoCheck.findIncidentReportsSince('2026-07-15T00:00:00Z');
    incidentRepoCheck.close();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ latitude: 9.999, longitude: 8.888 });
  });
});
