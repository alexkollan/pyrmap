import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteIncidentReportRepository } from '../src/adapters/sqlite/SqliteIncidentReportRepository.js';
import { rescanIncidentReports } from '../src/services/incidentRescanService.js';
import type { IncidentSource, RawPost } from '../src/ports/IncidentSource.js';

const NOW = () => new Date('2026-07-22T18:00:00Z');
const SOURCE_ID = 'PYROSVESTIKI_X';

let tmpDir: string;
let repo: SqliteIncidentReportRepository;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'pyrmap-rescan-test-'));
  repo = new SqliteIncidentReportRepository(path.join(tmpDir, 'test.db'));
});

afterEach(() => {
  repo.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

class FakeWindowSource implements IncidentSource {
  public requestedStart: Date | undefined;
  public requestedEnd: Date | undefined;
  constructor(private readonly posts: RawPost[]) {}
  async fetchRecentPosts(): Promise<RawPost[]> {
    throw new Error('rescan must use fetchPostsInWindow, not fetchRecentPosts');
  }
  async fetchPostsInWindow(startTime: Date, endTime: Date): Promise<RawPost[]> {
    this.requestedStart = startTime;
    this.requestedEnd = endTime;
    return this.posts;
  }
}

describe('rescanIncidentReports', () => {
  it('requests exactly the [now - hours, now] window', async () => {
    const source = new FakeWindowSource([]);
    await rescanIncidentReports(source, repo, SOURCE_ID, 6, NOW, path.join(tmpDir, 'logs'));

    expect(source.requestedEnd).toEqual(new Date('2026-07-22T18:00:00Z'));
    expect(source.requestedStart).toEqual(new Date('2026-07-22T12:00:00Z'));
  });

  it('skips a post whose external_id is already stored, without re-geocoding it', async () => {
    repo.insertIncidentReports([
      {
        externalId: '1',
        source: SOURCE_ID,
        text: 'already resolved',
        url: 'u',
        publishedAt: '2026-07-22T13:00:00Z',
        latitude: 1,
        longitude: 1,
        precision: 'settlement',
      },
    ]);
    const source = new FakeWindowSource([
      { externalId: '1', text: 'already resolved', publishedAt: '2026-07-22T13:00:00Z', url: 'u' },
    ]);

    const result = await rescanIncidentReports(source, repo, SOURCE_ID, 6, NOW, path.join(tmpDir, 'logs'));

    expect(result).toEqual({ postsChecked: 1, rowsInserted: 0, postsSkippedAlreadyResolved: 1, postsFailed: 0 });
  });

  it('resolves and inserts a previously-missed post', async () => {
    const source = new FakeWindowSource([
      {
        externalId: '2',
        text: 'Υπό μερικό έλεγχο τέθηκε η #πυρκαγιά στο Κορωπί Αττικής.',
        publishedAt: '2026-07-22T13:00:00Z',
        url: 'u',
      },
    ]);

    const result = await rescanIncidentReports(source, repo, SOURCE_ID, 6, NOW, path.join(tmpDir, 'logs'));

    expect(result).toEqual({ postsChecked: 1, rowsInserted: 1, postsSkippedAlreadyResolved: 0, postsFailed: 0 });
    expect(repo.findIncidentReportsSince('2026-07-22T00:00:00Z')).toHaveLength(1);
  });

  it('logs and counts a post that still fails to resolve', async () => {
    const source = new FakeWindowSource([
      { externalId: '3', text: '🔥 37 αγροτοδασικές #πυρκαγιές εκδηλώθηκαν το τελευταίο 24ωρο.', publishedAt: '2026-07-22T13:00:00Z', url: 'u' },
    ]);

    const result = await rescanIncidentReports(source, repo, SOURCE_ID, 6, NOW, path.join(tmpDir, 'logs'));

    expect(result).toEqual({ postsChecked: 1, rowsInserted: 0, postsSkippedAlreadyResolved: 0, postsFailed: 1 });
  });
});
