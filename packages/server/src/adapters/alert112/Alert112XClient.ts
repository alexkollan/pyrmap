import type { IncidentSource, RawPost } from '../../ports/IncidentSource.js';

const API_BASE = 'https://api.twitter.com/2';
// Resolved once via GET /2/users/by/username/112Greece, 2026-07-23 — see the pattern this mirrors
// exactly in adapters/pyrosvestiki/PyrosvestikiXClient.ts.
const ALERT_112_USER_ID = '1187287012442804225';
const MIN_RESULTS = 5;
const MAX_RESULTS = 100;
const TIMEOUT_MS = 30_000;

type FetchFn = typeof fetch;

interface TweetsResponse {
  data?: { id: string; text: string; created_at: string }[];
}

/**
 * Pulls @112Greece's official civil-protection activation posts via X API v2's user-tweets
 * endpoint, app-only Bearer auth — same mechanics as PyrosvestikiXClient (same account type, same
 * pricing model), reusing the same X_BEARER_TOKEN. `since_id` used whenever available so an empty
 * poll costs nothing (X bills per tweet object returned, not per request).
 */
export class Alert112XClient implements IncidentSource {
  constructor(
    private readonly bearerToken: string,
    private readonly fetchImpl: FetchFn = fetch,
  ) {}

  async fetchRecentPosts(sinceExternalId: string | null, maxResults: number): Promise<RawPost[]> {
    const clamped = Math.min(MAX_RESULTS, Math.max(MIN_RESULTS, maxResults));
    const params = new URLSearchParams({
      max_results: String(clamped),
      'tweet.fields': 'created_at,text',
      exclude: 'retweets',
    });
    if (sinceExternalId) params.set('since_id', sinceExternalId);

    return this.fetch(`${API_BASE}/users/${ALERT_112_USER_ID}/tweets?${params.toString()}`);
  }

  async fetchPostsInWindow(startTime: Date, endTime: Date): Promise<RawPost[]> {
    const params = new URLSearchParams({
      max_results: String(MAX_RESULTS),
      'tweet.fields': 'created_at,text',
      exclude: 'retweets',
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
    });

    return this.fetch(`${API_BASE}/users/${ALERT_112_USER_ID}/tweets?${params.toString()}`);
  }

  private async fetch(url: string): Promise<RawPost[]> {
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

    return (body.data ?? []).map((tweet) => ({
      externalId: tweet.id,
      text: tweet.text,
      publishedAt: new Date(tweet.created_at).toISOString(),
      url: `https://x.com/112Greece/status/${tweet.id}`,
    }));
  }
}
