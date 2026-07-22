import { isFireIncidentPost, extractLocationPhrase } from '../domain/incidentParsing.js';
import { geocodeGreekLocation } from '../domain/incidentGeocoding.js';
import type { IncidentSource } from '../ports/IncidentSource.js';
import type { IncidentReportRepository, NewIncidentReportRow } from '../ports/IncidentReportRepository.js';

/** Posts per poll when there's no since_id yet (first run); since_id makes subsequent polls cost near-zero. */
const POSTS_PER_POLL = 10;
const LOG_TEXT_MAX_CHARS = 120;

function truncate(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > LOG_TEXT_MAX_CHARS ? `${collapsed.slice(0, LOG_TEXT_MAX_CHARS)}…` : collapsed;
}

export interface IncidentIngestResult {
  postsFetched: number;
  rowsInserted: number;
  error: string | null;
}

/**
 * Ingests fire-incident reports from a text-based source (e.g. the Fire Service's X account):
 * fetch new posts since the last one we've seen -> classify -> extract location -> geocode ->
 * persist only the ones that resolved to real coordinates. Never throws; failures land in
 * fetch_log, same convention as alertIngestService.
 */
export async function ingestIncidentReports(
  source: IncidentSource,
  repository: IncidentReportRepository,
  sourceId: string,
  now: () => Date,
  onLog?: (message: string) => void,
  onInserted?: (rows: NewIncidentReportRow[]) => void,
): Promise<IncidentIngestResult> {
  const fetchedAt = now().toISOString();
  const sinceId = repository.findLatestExternalId(sourceId);

  let posts;
  try {
    posts = await source.fetchRecentPosts(sinceId, POSTS_PER_POLL);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    repository.recordFetchLog({
      source: sourceId,
      fetchedAt,
      httpStatus: null,
      rowsParsed: 0,
      rowsInserted: 0,
      error: message,
    });
    return { postsFetched: 0, rowsInserted: 0, error: message };
  }

  const rows: NewIncidentReportRow[] = [];
  let skipped = 0;
  for (const post of posts) {
    if (!isFireIncidentPost(post.text)) continue;

    const location = extractLocationPhrase(post.text);
    if (!location) {
      skipped++;
      // These are the posts worth reading, not just counting — the account is written by a
      // human, so the "standard-ish" template has real exceptions; each miss here is a
      // candidate for a new extractLocationPhrase case (see docs/DECISIONS.md 2026-07-20).
      onLog?.(`source=${sourceId} skip=no-location id=${post.externalId} text="${truncate(post.text)}"`);
      continue;
    }

    const geocoded = geocodeGreekLocation(location.settlement, location.regionGenitive);
    if (!geocoded) {
      skipped++;
      onLog?.(
        `source=${sourceId} skip=no-geocode id=${post.externalId} settlement="${location.settlement}" region="${location.regionGenitive ?? ''}" text="${truncate(post.text)}"`,
      );
      continue;
    }

    rows.push({
      externalId: post.externalId,
      source: sourceId,
      text: post.text,
      url: post.url,
      publishedAt: post.publishedAt,
      latitude: geocoded.latitude,
      longitude: geocoded.longitude,
      precision: geocoded.precision,
    });
  }

  const insertedRows = repository.insertIncidentReports(rows);
  onLog?.(`source=${sourceId} posts=${posts.length} geocoded=${rows.length} skipped=${skipped} inserted=${insertedRows.length}`);
  if (insertedRows.length > 0) onInserted?.(insertedRows);

  repository.recordFetchLog({
    source: sourceId,
    fetchedAt,
    httpStatus: 200,
    rowsParsed: rows.length,
    rowsInserted: insertedRows.length,
    error: null,
  });

  return { postsFetched: posts.length, rowsInserted: insertedRows.length, error: null };
}
