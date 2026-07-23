import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SqliteIncidentReportRepository } from '../src/adapters/sqlite/SqliteIncidentReportRepository.js';
import { ingestIncidentReports } from '../src/services/incidentIngestService.js';
import type { IncidentSource, RawPost } from '../src/ports/IncidentSource.js';
import type { GeocodingSource } from '../src/ports/GeocodingSource.js';

const NOW = () => new Date('2026-07-20T13:00:00Z');
const SOURCE_ID = 'PYROSVESTIKI_X';

// Real posts pulled live 2026-07-20 — one geocodable fire, one aggregate-stat fire post (no
// location), one non-fire post — exercising every branch of the pipeline against real text.
const POSTS: RawPost[] = [
  {
    externalId: '2079180444990403006',
    text: 'Υπό μερικό έλεγχο τέθηκε η #πυρκαγιά στο Κορωπί Αττικής.',
    publishedAt: '2026-07-20T12:23:42Z',
    url: 'https://x.com/pyrosvestiki/status/2079180444990403006',
  },
  {
    externalId: '2079131544006885463',
    text: '🔥 37 αγροτοδασικές #πυρκαγιές εκδηλώθηκαν το τελευταίο 24ωρο.',
    publishedAt: '2026-07-20T09:09:23Z',
    url: 'https://x.com/pyrosvestiki/status/2079131544006885463',
  },
  {
    externalId: '2079145073875300394',
    text: 'Σε ασφαλές μεταφέρθηκαν 2 ηλικιωμένοι, στον Ωρωπό Αττικής. Επιχείρησαν 9 #πυροσβέστες.',
    publishedAt: '2026-07-20T10:03:08Z',
    url: 'https://x.com/pyrosvestiki/status/2079145073875300394',
  },
];

class FakeIncidentSource implements IncidentSource {
  public lastSinceId: string | null | undefined;
  constructor(private readonly posts: RawPost[]) {}
  async fetchRecentPosts(sinceExternalId: string | null): Promise<RawPost[]> {
    this.lastSinceId = sinceExternalId;
    return this.posts;
  }
  async fetchPostsInWindow(): Promise<RawPost[]> {
    throw new Error('FakeIncidentSource.fetchPostsInWindow is not implemented — this fake only supports fetchRecentPosts');
  }
}

let tmpDir: string;
let repo: SqliteIncidentReportRepository;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'pyrmap-incident-test-'));
  repo = new SqliteIncidentReportRepository(path.join(tmpDir, 'test.db'));
});

afterEach(() => {
  repo.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('ingestIncidentReports', () => {
  it('inserts only the fire post that both classifies and geocodes, skipping the rest', async () => {
    const result = await ingestIncidentReports(new FakeIncidentSource(POSTS), repo, SOURCE_ID, NOW, path.join(tmpDir, 'logs'));

    expect(result).toEqual({ postsFetched: 3, rowsInserted: 1, error: null });

    const stored = repo.findIncidentReportsSince('2026-07-20T00:00:00Z');
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      source: SOURCE_ID,
      text: 'Υπό μερικό έλεγχο τέθηκε η #πυρκαγιά στο Κορωπί Αττικής.',
      latitude: 37.8989,
      longitude: 23.8718,
      precision: 'settlement',
    });
  });

  it('passes the latest stored external_id as since_id on the next poll (cost control)', async () => {
    await ingestIncidentReports(new FakeIncidentSource(POSTS), repo, SOURCE_ID, NOW, path.join(tmpDir, 'logs'));

    const secondSource = new FakeIncidentSource([]);
    await ingestIncidentReports(secondSource, repo, SOURCE_ID, NOW, path.join(tmpDir, 'logs'));

    expect(secondSource.lastSinceId).toBe('2079180444990403006');
  });

  it('re-ingesting the same posts inserts 0 new rows', async () => {
    await ingestIncidentReports(new FakeIncidentSource(POSTS), repo, SOURCE_ID, NOW, path.join(tmpDir, 'logs'));
    const second = await ingestIncidentReports(new FakeIncidentSource(POSTS), repo, SOURCE_ID, NOW, path.join(tmpDir, 'logs'));
    expect(second.rowsInserted).toBe(0);
  });

  it('calls onInserted with the newly inserted rows, and does not call it when nothing new was inserted', async () => {
    const onInserted = vi.fn();
    await ingestIncidentReports(new FakeIncidentSource(POSTS), repo, SOURCE_ID, NOW, path.join(tmpDir, 'logs'), undefined, onInserted);

    expect(onInserted).toHaveBeenCalledTimes(1);
    const [rows] = onInserted.mock.calls[0]!;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ text: 'Υπό μερικό έλεγχο τέθηκε η #πυρκαγιά στο Κορωπί Αττικής.' });

    onInserted.mockClear();
    await ingestIncidentReports(new FakeIncidentSource(POSTS), repo, SOURCE_ID, NOW, path.join(tmpDir, 'logs'), undefined, onInserted);
    expect(onInserted).not.toHaveBeenCalled();
  });

  it('prefers a configured geocodingSource over the offline gazetteer when it resolves', async () => {
    const geocodingSource: GeocodingSource = {
      geocode: async () => ({ latitude: 1.111, longitude: 2.222, precision: 'settlement' }),
    };

    await ingestIncidentReports(
      new FakeIncidentSource(POSTS),
      repo,
      SOURCE_ID,
      NOW,
      path.join(tmpDir, 'logs'),
      undefined,
      undefined,
      geocodingSource,
    );

    const stored = repo.findIncidentReportsSince('2026-07-20T00:00:00Z');
    expect(stored).toHaveLength(1);
    // Distinct from the offline gazetteer's 37.8989/23.8718 for the same post — proves the live
    // source's result is actually used, not silently ignored.
    expect(stored[0]).toMatchObject({ latitude: 1.111, longitude: 2.222 });
  });

  it('falls back to the offline gazetteer, unchanged, when the geocodingSource finds nothing', async () => {
    const geocodingSource: GeocodingSource = { geocode: async () => null };

    const result = await ingestIncidentReports(
      new FakeIncidentSource(POSTS),
      repo,
      SOURCE_ID,
      NOW,
      path.join(tmpDir, 'logs'),
      undefined,
      undefined,
      geocodingSource,
    );

    expect(result).toEqual({ postsFetched: 3, rowsInserted: 1, error: null });
    const stored = repo.findIncidentReportsSince('2026-07-20T00:00:00Z');
    expect(stored[0]).toMatchObject({ latitude: 37.8989, longitude: 23.8718, precision: 'settlement' });
  });

  it('records a fetch_log error and does not throw when the source fails', async () => {
    const failing: IncidentSource = {
      fetchRecentPosts: async () => {
        throw new Error('X API down');
      },
      fetchPostsInWindow: async () => {
        throw new Error('X API down');
      },
    };

    const result = await ingestIncidentReports(failing, repo, SOURCE_ID, NOW, path.join(tmpDir, 'logs'));

    expect(result.error).toBe('X API down');
  });

  it('logs a no-location failure to a per-day file under logsDir', async () => {
    const logsDir = path.join(tmpDir, 'logs');
    await ingestIncidentReports(new FakeIncidentSource(POSTS), repo, SOURCE_ID, NOW, logsDir);

    const logFile = path.join(logsDir, '2026-07-20.log');
    const lines = readFileSync(logFile, 'utf-8').trim().split('\n');
    const entries = lines.map((line) => JSON.parse(line));
    expect(entries.some((e) => e.reason === 'no-location' && e.text.includes('37 αγροτοδασικές'))).toBe(true);
  });

  it('logs a persistently-failing post exactly once, even when re-fetched across many polls', async () => {
    // Real observed bug: a post that never resolves never gets inserted, so a naive since_id
    // (tracking only inserted rows) never advances past it — the source keeps re-returning it
    // every poll and it got re-logged dozens of times for the same post. FakeIncidentSource here
    // deliberately ignores since_id (like a source might still legitimately re-return a post
    // within its lookback window), simulating repeated re-encounters of the same failing post.
    const logsDir = path.join(tmpDir, 'logs');
    const source = new FakeIncidentSource(POSTS);

    await ingestIncidentReports(source, repo, SOURCE_ID, NOW, logsDir);
    await ingestIncidentReports(source, repo, SOURCE_ID, NOW, logsDir);
    await ingestIncidentReports(source, repo, SOURCE_ID, NOW, logsDir);

    const logFile = path.join(logsDir, '2026-07-20.log');
    const entries = readFileSync(logFile, 'utf-8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    const failingPostEntries = entries.filter((e) => e.externalId === '2079131544006885463');
    expect(failingPostEntries).toHaveLength(1);
  });

  it('advances since_id past a failed post too, so it is not refetched forever (cost control)', async () => {
    // '2079131544006885463' (the no-location aggregate-stat post) never gets inserted, but its
    // id is smaller than the one post that does resolve here, so this alone wouldn't catch a
    // regression to the old "only inserted rows count" behavior — use a source where the ONLY
    // resolvable post has the SMALLEST id, so since_id can only be correct if it also considers
    // the larger failed id.
    const postsWithFailureHavingHighestId: RawPost[] = [
      {
        externalId: '2079180444990403006',
        text: 'Υπό μερικό έλεγχο τέθηκε η #πυρκαγιά στο Κορωπί Αττικής.',
        publishedAt: '2026-07-20T12:23:42Z',
        url: 'https://x.com/pyrosvestiki/status/2079180444990403006',
      },
      {
        externalId: '9079180444990403006',
        text: '🔥 37 αγροτοδασικές #πυρκαγιές εκδηλώθηκαν το τελευταίο 24ωρο.',
        publishedAt: '2026-07-20T12:24:00Z',
        url: 'https://x.com/pyrosvestiki/status/9079180444990403006',
      },
    ];
    await ingestIncidentReports(new FakeIncidentSource(postsWithFailureHavingHighestId), repo, SOURCE_ID, NOW, path.join(tmpDir, 'logs'));

    const secondSource = new FakeIncidentSource([]);
    await ingestIncidentReports(secondSource, repo, SOURCE_ID, NOW, path.join(tmpDir, 'logs'));

    expect(secondSource.lastSinceId).toBe('9079180444990403006');
  });
});
