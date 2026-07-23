import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteCivilProtectionAlertRepository } from '../src/adapters/sqlite/SqliteCivilProtectionAlertRepository.js';
import { rescanAlerts } from '../src/services/alert112RescanService.js';
import type { IncidentSource, RawPost } from '../src/ports/IncidentSource.js';

const NOW = () => new Date('2026-07-23T13:00:00Z');
const SOURCE_ID = 'ALERT_112_X';

const GREEK_ACTIVATION =
  '⚠️Ενεργοποίηση 1⃣1⃣2⃣\n\n🆘 Πυρκαγιά στην περιοχή #Δερβένι της Περιφερειακής Ενότητας #Θεσσαλονίκης\n\nℹ️';

class FakeWindowSource implements IncidentSource {
  constructor(private readonly posts: RawPost[]) {}
  async fetchRecentPosts(): Promise<RawPost[]> {
    throw new Error('not implemented in this fake');
  }
  async fetchPostsInWindow(): Promise<RawPost[]> {
    return this.posts;
  }
}

let tmpDir: string;
let repo: SqliteCivilProtectionAlertRepository;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'pyrmap-alertrescan-test-'));
  repo = new SqliteCivilProtectionAlertRepository(path.join(tmpDir, 'test.db'));
});

afterEach(() => {
  repo.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('rescanAlerts', () => {
  it('inserts a previously-failed post once the underlying parser can resolve it', async () => {
    const posts: RawPost[] = [
      { externalId: '1', text: GREEK_ACTIVATION, publishedAt: '2026-07-23T07:00:00Z', url: 'https://x.com/112Greece/status/1' },
    ];
    const result = await rescanAlerts(new FakeWindowSource(posts), repo, SOURCE_ID, 24, NOW, path.join(tmpDir, 'logs'), undefined, undefined);

    expect(result).toMatchObject({ postsChecked: 1, rowsInserted: 1, postsSkippedAlreadyResolved: 0, postsFailed: 0, error: null });
  });

  it('skips a post whose external_id is already stored', async () => {
    repo.insertAlerts([
      {
        externalId: '1',
        source: SOURCE_ID,
        text: GREEK_ACTIVATION,
        url: 'u',
        publishedAt: '2026-07-23T07:00:00Z',
        latitude: 1,
        longitude: 1,
        precision: 'locality',
        areaPolygon: null,
      },
    ]);
    const posts: RawPost[] = [{ externalId: '1', text: GREEK_ACTIVATION, publishedAt: '2026-07-23T07:00:00Z', url: 'u' }];
    const result = await rescanAlerts(new FakeWindowSource(posts), repo, SOURCE_ID, 24, NOW, path.join(tmpDir, 'logs'), undefined, undefined);

    expect(result).toMatchObject({ postsSkippedAlreadyResolved: 1, rowsInserted: 0 });
  });

  it('records a fetch_log error and does not throw when the window fetch fails', async () => {
    const failing: IncidentSource = {
      fetchRecentPosts: async () => [],
      fetchPostsInWindow: async () => {
        throw new Error('X API down');
      },
    };
    const result = await rescanAlerts(failing, repo, SOURCE_ID, 24, NOW, path.join(tmpDir, 'logs'), undefined, undefined);
    expect(result.error).toBe('X API down');
  });
});
