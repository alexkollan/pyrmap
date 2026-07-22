import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { PyrosvestikiXClient } from '../src/adapters/pyrosvestiki/PyrosvestikiXClient.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
// Real API response, 6 real posts pulled live 2026-07-20 — see docs/DECISIONS.md.
const tweetsJson = readFileSync(path.join(fixturesDir, 'pyrosvestiki_tweets_sample.json'), 'utf-8');

function fakeFetch(): typeof fetch {
  return vi.fn(async () => new Response(tweetsJson, { status: 200 })) as unknown as typeof fetch;
}

describe('PyrosvestikiXClient', () => {
  it('parses the real API response shape into RawPost objects', async () => {
    const client = new PyrosvestikiXClient('tok', fakeFetch());
    const posts = await client.fetchRecentPosts(null, 10);

    expect(posts).toHaveLength(6);
    expect(posts[0]).toEqual({
      externalId: '2079180444990403006',
      text: 'Υπό μερικό έλεγχο τέθηκε η #πυρκαγιά στο Πέραμα Αττικής.',
      publishedAt: '2026-07-20T12:23:42.000Z',
      url: 'https://x.com/pyrosvestiki/status/2079180444990403006',
    });
  });

  it('sends Bearer auth and includes since_id only when one is given', async () => {
    const fetchImpl = fakeFetch();
    const client = new PyrosvestikiXClient('my-token', fetchImpl);

    await client.fetchRecentPosts(null, 10);
    await client.fetchRecentPosts('123456789', 10);

    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit?][];
    expect((calls[0]![1]?.headers as Record<string, string>).Authorization).toBe('Bearer my-token');
    expect(String(calls[0]![0])).not.toContain('since_id');
    expect(String(calls[1]![0])).toContain('since_id=123456789');
  });

  it('throws on a failed response instead of silently returning nothing', async () => {
    const fetchImpl = vi.fn(async () => new Response('rate limited', { status: 429 })) as unknown as typeof fetch;
    const client = new PyrosvestikiXClient('tok', fetchImpl);

    await expect(client.fetchRecentPosts(null, 10)).rejects.toThrow(/HTTP 429/);
  });

  it('returns an empty array when the API reports no new posts (no data key)', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ meta: { result_count: 0 } }), { status: 200 })) as unknown as typeof fetch;
    const client = new PyrosvestikiXClient('tok', fetchImpl);

    expect(await client.fetchRecentPosts('999', 10)).toEqual([]);
  });

  it('fetches posts in a time window via start_time/end_time, not since_id', async () => {
    const fetchImpl = fakeFetch();
    const client = new PyrosvestikiXClient('tok', fetchImpl);

    await client.fetchPostsInWindow(new Date('2026-07-22T00:00:00Z'), new Date('2026-07-22T12:00:00Z'));

    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit?][];
    const url = String(calls[0]![0]);
    expect(url).toContain('start_time=2026-07-22T00%3A00%3A00.000Z');
    expect(url).toContain('end_time=2026-07-22T12%3A00%3A00.000Z');
    expect(url).not.toContain('since_id');
  });
});
