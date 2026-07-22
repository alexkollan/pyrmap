import type { IncidentSource, RawPost } from '../../ports/IncidentSource.js';

const API_BASE = 'https://api.twitter.com/2';
// Resolved once via GET /2/users/by/username/pyrosvestiki, 2026-07-20 — a numeric user id never
// changes even if the account is renamed, and looking it up on every poll would be a paid read
// we don't need (X API is pay-per-use, see docs/DECISIONS.md).
const PYROSVESTIKI_USER_ID = '158003436';
const MIN_RESULTS = 5;
const MAX_RESULTS = 100;
const TIMEOUT_MS = 30_000;

type FetchFn = typeof fetch;

interface TweetsResponse {
  data?: { id: string; text: string; created_at: string }[];
}

/**
 * Pulls the Greek Fire Service's own posts (@pyrosvestiki) via X API v2's user-tweets endpoint,
 * app-only Bearer auth. `since_id` is used whenever we have one so a poll with nothing new costs
 * nothing (X's pay-per-use pricing bills per tweet object returned, not per request) — verified
 * live 2026-07-20, see docs/DECISIONS.md.
 */
export class PyrosvestikiXClient implements IncidentSource {
  constructor(
    private readonly bearerToken: string,
    private readonly fetchImpl: FetchFn = fetch,
  ) {}

  async fetchRecentPosts(sinceExternalId: string | null, maxResults: number): Promise<RawPost[]> {
    const clamped = Math.min(MAX_RESULTS, Math.max(MIN_RESULTS, maxResults));
    const params = new URLSearchParams({
      max_results: String(clamped),
      'tweet.fields': 'created_at,text',
      exclude: 'retweets,replies',
    });
    if (sinceExternalId) params.set('since_id', sinceExternalId);

    const url = `${API_BASE}/users/${PYROSVESTIKI_USER_ID}/tweets?${params.toString()}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let body: TweetsResponse;
    try {
      const response = await this.fetchImpl(url, {
        headers: { Authorization: `Bearer ${this.bearerToken}` },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`X API request failed: HTTP ${response.status}`);
      }
      body = (await response.json()) as TweetsResponse;
    } finally {
      clearTimeout(timeout);
    }

    return this.parseTweetsResponse(body);
  }

  /**
   * Fetches every post in [startTime, endTime] via start_time/end_time, for rescanning a window.
   * Never sends since_id — X API v2 gives since_id precedence over start_time when both are
   * present, which would silently defeat the point of a rescan. Not paginated: the endpoint
   * returns at most max_results (capped at 100) most-recent posts in the window, and this
   * account's real posting volume is far below that even at peak wildfire season.
   */
  async fetchPostsInWindow(startTime: Date, endTime: Date): Promise<RawPost[]> {
    const params = new URLSearchParams({
      max_results: String(MAX_RESULTS),
      'tweet.fields': 'created_at,text',
      exclude: 'retweets,replies',
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
    });

    const url = `${API_BASE}/users/${PYROSVESTIKI_USER_ID}/tweets?${params.toString()}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let body: TweetsResponse;
    try {
      const response = await this.fetchImpl(url, {
        headers: { Authorization: `Bearer ${this.bearerToken}` },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`X API request failed: HTTP ${response.status}`);
      }
      body = (await response.json()) as TweetsResponse;
    } finally {
      clearTimeout(timeout);
    }

    return this.parseTweetsResponse(body);
  }

  private parseTweetsResponse(body: TweetsResponse): RawPost[] {
    return (body.data ?? []).map((tweet) => ({
      externalId: tweet.id,
      text: tweet.text,
      publishedAt: new Date(tweet.created_at).toISOString(),
      url: `https://x.com/pyrosvestiki/status/${tweet.id}`,
    }));
  }
}
