import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export interface IncidentFailureEntry {
  source: string;
  externalId: string;
  reason: 'no-location' | 'no-geocode';
  /** Full original post text, untruncated — the whole point is to have enough to diagnose later. */
  text: string;
  /** Direct link to the post, so a future reader (human or agent) doesn't have to reconstruct it. */
  url: string;
  /** The post's own timestamp (when it was posted), distinct from `timestamp` (when we logged the failure). */
  publishedAt: string;
  settlement?: string;
  region?: string;
}

/**
 * Appends one JSON-per-line entry to `logsDir/YYYY-MM-DD.log` (UTC calendar day), creating the
 * directory if it doesn't exist. Durable record of incident posts that couldn't be resolved, for
 * later inspection (e.g. feeding to a coding agent) — separate from the ephemeral console/onLog
 * output, which doesn't survive a container restart.
 */
export function logIncidentFailure(logsDir: string, entry: IncidentFailureEntry, now: () => Date): void {
  mkdirSync(logsDir, { recursive: true });
  const timestamp = now().toISOString();
  const day = timestamp.slice(0, 10); // YYYY-MM-DD
  const line = `${JSON.stringify({ timestamp, ...entry })}\n`;
  appendFileSync(path.join(logsDir, `${day}.log`), line, 'utf-8');
}
