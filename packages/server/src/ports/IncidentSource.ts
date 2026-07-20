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
}
