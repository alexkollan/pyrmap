import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SqliteCivilProtectionAlertRepository } from '../src/adapters/sqlite/SqliteCivilProtectionAlertRepository.js';
import { ingestAlerts } from '../src/services/alert112IngestService.js';
import type { IncidentSource, RawPost } from '../src/ports/IncidentSource.js';

const NOW = () => new Date('2026-07-23T13:00:00Z');
const SOURCE_ID = 'ALERT_112_X';

const GREEK_ACTIVATION =
  '⚠️Ενεργοποίηση 1⃣1⃣2⃣\n\n🆘 Πυρκαγιά στην περιοχή #Δερβένι της Περιφερειακής Ενότητας #Θεσσαλονίκης\n\nℹ️';
const ENGLISH_DUPLICATE =
  '⚠️Activation 1⃣1⃣2⃣\n\n🆘 Fire in #Derveni area of the regional unit of #Thessaloniki\n\nℹ️';
const NO_ACTIVATION = 'Ενημερωτικό δελτίο χωρίς ενεργοποίηση.';

const POSTS: RawPost[] = [
  { externalId: '1', text: GREEK_ACTIVATION, publishedAt: '2026-07-23T07:00:00Z', url: 'https://x.com/112Greece/status/1' },
  { externalId: '2', text: ENGLISH_DUPLICATE, publishedAt: '2026-07-23T07:00:05Z', url: 'https://x.com/112Greece/status/2' },
  { externalId: '3', text: NO_ACTIVATION, publishedAt: '2026-07-23T06:00:00Z', url: 'https://x.com/112Greece/status/3' },
];

class FakeAlertSource implements IncidentSource {
  public lastSinceId: string | null | undefined;
  constructor(private readonly posts: RawPost[]) {}
  async fetchRecentPosts(sinceExternalId: string | null): Promise<RawPost[]> {
    this.lastSinceId = sinceExternalId;
    return this.posts;
  }
  async fetchPostsInWindow(): Promise<RawPost[]> {
    throw new Error('not implemented in this fake');
  }
}

let tmpDir: string;
let repo: SqliteCivilProtectionAlertRepository;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'pyrmap-alertingest-test-'));
  repo = new SqliteCivilProtectionAlertRepository(path.join(tmpDir, 'test.db'));
});

afterEach(() => {
  repo.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('ingestAlerts', () => {
  it('inserts only the Greek activation post, skipping the English duplicate and the non-activation post', async () => {
    const result = await ingestAlerts(new FakeAlertSource(POSTS), repo, SOURCE_ID, NOW, path.join(tmpDir, 'logs'));

    expect(result).toEqual({ postsFetched: 3, rowsInserted: 1, error: null });
    const stored = repo.findAlertsSince('2026-07-23T00:00:00Z');
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ source: SOURCE_ID, precision: 'locality' });
  });

  it('calls onInserted with the newly inserted rows', async () => {
    const onInserted = vi.fn();
    await ingestAlerts(new FakeAlertSource(POSTS), repo, SOURCE_ID, NOW, path.join(tmpDir, 'logs'), undefined, onInserted);

    expect(onInserted).toHaveBeenCalledTimes(1);
    expect(onInserted.mock.calls[0]![0]).toHaveLength(1);
  });

  it('re-ingesting the same posts inserts 0 new rows', async () => {
    await ingestAlerts(new FakeAlertSource(POSTS), repo, SOURCE_ID, NOW, path.join(tmpDir, 'logs'));
    const second = await ingestAlerts(new FakeAlertSource(POSTS), repo, SOURCE_ID, NOW, path.join(tmpDir, 'logs'));
    expect(second.rowsInserted).toBe(0);
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
    const result = await ingestAlerts(failing, repo, SOURCE_ID, NOW, path.join(tmpDir, 'logs'));
    expect(result.error).toBe('X API down');
  });

  it('does not write the English duplicate or the no-activation post to the reviewable failure log (expected structural noise, not a miss)', async () => {
    const logsDir = path.join(tmpDir, 'logs');
    await ingestAlerts(new FakeAlertSource(POSTS), repo, SOURCE_ID, NOW, logsDir);

    // No log file at all: the only "failure" in this batch is classification-gate noise
    // (English duplicate + non-activation post), and processAlertPost's no-location/no-geocode
    // paths are never reached for either of them.
    expect(() => readFileSync(path.join(logsDir, '2026-07-23.log'), 'utf-8')).toThrow();
  });

  it('still advances since_id past the English duplicate and non-activation posts (cost control — every real alert guarantees an English duplicate)', async () => {
    await ingestAlerts(new FakeAlertSource(POSTS), repo, SOURCE_ID, NOW, path.join(tmpDir, 'logs'));
    const secondSource = new FakeAlertSource([]);
    await ingestAlerts(secondSource, repo, SOURCE_ID, NOW, path.join(tmpDir, 'logs'));
    expect(secondSource.lastSinceId).toBe('3');
  });
});
