import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Alert112XClient } from '../src/adapters/alert112/Alert112XClient.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const tweetsJson = readFileSync(path.join(fixturesDir, 'alert112_tweets_sample.json'), 'utf-8');

function fakeFetch(): typeof fetch {
  return vi.fn(async () => new Response(tweetsJson, { status: 200 })) as unknown as typeof fetch;
}

describe('Alert112XClient', () => {
  it('parses the API response shape into RawPost objects, including the English duplicate (filtering happens later, in parsing)', async () => {
    const client = new Alert112XClient('tok', fakeFetch());
    const posts = await client.fetchRecentPosts(null, 10);

    expect(posts).toHaveLength(3);
    expect(posts[0]).toEqual({
      externalId: '2080300000000000001',
      text: expect.stringContaining('Ενεργοποίηση'),
      publishedAt: '2026-07-23T07:00:00.000Z',
      url: 'https://x.com/112Greece/status/2080300000000000001',
    });
  });

  it('sends Bearer auth and includes since_id only when one is given', async () => {
    const fetchImpl = fakeFetch();
    const client = new Alert112XClient('my-token', fetchImpl);

    await client.fetchRecentPosts(null, 10);
    await client.fetchRecentPosts('123456789', 10);

    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit?][];
    expect((calls[0]![1]?.headers as Record<string, string>).Authorization).toBe('Bearer my-token');
    expect(String(calls[0]![0])).not.toContain('since_id');
    expect(String(calls[1]![0])).toContain('since_id=123456789');
  });

  it('throws on a failed response instead of silently returning nothing', async () => {
    const fetchImpl = vi.fn(async () => new Response('rate limited', { status: 429 })) as unknown as typeof fetch;
    const client = new Alert112XClient('tok', fetchImpl);

    await expect(client.fetchRecentPosts(null, 10)).rejects.toThrow(/HTTP 429/);
  });

  it('fetches posts in a time window via start_time/end_time, not since_id', async () => {
    const fetchImpl = fakeFetch();
    const client = new Alert112XClient('tok', fetchImpl);

    await client.fetchPostsInWindow(new Date('2026-07-23T00:00:00Z'), new Date('2026-07-23T12:00:00Z'));

    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit?][];
    const url = String(calls[0]![0]);
    expect(url).toContain('start_time=2026-07-23T00%3A00%3A00.000Z');
    expect(url).toContain('end_time=2026-07-23T12%3A00%3A00.000Z');
    expect(url).not.toContain('since_id');
  });
});
