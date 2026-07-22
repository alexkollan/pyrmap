export interface RawPost {
  externalId: string;
  text: string;
  publishedAt: string; // ISO 8601 UTC
  url: string;
}

/** Fetches recent posts from an external incident-reporting account (e.g. the Fire Service's X feed). */
export interface IncidentSource {
  /** Posts newer than sinceExternalId (null = just the most recent maxResults), for cost-efficient polling. */
  fetchRecentPosts(sinceExternalId: string | null, maxResults: number): Promise<RawPost[]>;
  /** Every post published in [startTime, endTime], regardless of what's already been fetched —
   * for rescanning a window rather than incrementally polling. A paid read every time it's
   * called (no since_id cost-avoidance applies here). */
  fetchPostsInWindow(startTime: Date, endTime: Date): Promise<RawPost[]>;
}
