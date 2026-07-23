import { isAlert112Post, extractAlertAreas } from '../domain/alert112Parsing.js';
import { geocodeAlertArea } from '../domain/alert112Geocoding.js';
import { logIncidentFailure } from './incidentFailureLog.js';
import type { IncidentSource, RawPost } from '../ports/IncidentSource.js';
import type { CivilProtectionAlertRepository, NewAlertRow } from '../ports/CivilProtectionAlertRepository.js';
import type { GeocodingSource } from '../ports/GeocodingSource.js';
import type { AreaPolygonSource } from '../ports/AreaPolygonSource.js';

/** Records a failure exactly once per (source, externalId) ever, then durably logs it — same
 * dedup convention as incidentIngestService.ts's logFailureOnce (see its doc comment for why the
 * gate matters: without it, a post that never resolves gets re-logged on every poll forever). */
function logFailureOnce(
  repository: CivilProtectionAlertRepository,
  logsDir: string,
  now: () => Date,
  entry: Parameters<typeof logIncidentFailure>[1],
): void {
  const isNew = repository.recordFailedPostIfNew(entry.source, entry.externalId, entry.reason, entry.text, now().toISOString());
  if (isNew) logIncidentFailure(logsDir, entry, now);
}

const POSTS_PER_POLL = 10;
const LOG_TEXT_MAX_CHARS = 120;

function truncate(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > LOG_TEXT_MAX_CHARS ? `${collapsed.slice(0, LOG_TEXT_MAX_CHARS)}…` : collapsed;
}

export interface AlertIngestResult {
  postsFetched: number;
  rowsInserted: number;
  error: string | null;
}

/**
 * Classifies, extracts, and geocodes one 112 activation post. Returns the row to persist, or null
 * if it should be skipped (not a Greek activation post, no area clause found, or geocoding
 * failed) — in the null-because-skipped-after-classifying case, a failure is durably logged, at
 * most once ever per (source, externalId). Shared by the regular polling path (ingestAlerts) and
 * the rescan path (services/alert112RescanService.ts), so both log failures identically.
 */
export async function processAlertPost(
  post: RawPost,
  sourceId: string,
  repository: CivilProtectionAlertRepository,
  logsDir: string,
  now: () => Date,
  geocodingSource: GeocodingSource | undefined,
  polygonSource: AreaPolygonSource | undefined,
  onLog?: (message: string) => void,
): Promise<NewAlertRow | null> {
  if (!isAlert112Post(post.text)) {
    // Unlike @pyrosvestiki (where a non-fire post is rare), EVERY real 112 activation guarantees
    // an English-language duplicate that fails this exact check — structural, not occasional. If
    // this weren't recorded at all, since_id would never advance past it (findLatestExternalId
    // only considers civil_protection_alerts + alert_failed_posts), so X would re-bill that same
    // tweet on every single 1-minute poll indefinitely. Recorded directly (not via
    // logFailureOnce/logIncidentFailure) since this isn't a miss worth a human reviewing — it's
    // expected, guaranteed noise, not a candidate for a parser fix.
    repository.recordFailedPostIfNew(sourceId, post.externalId, 'not-activation', post.text, now().toISOString());
    return null;
  }

  const areas = extractAlertAreas(post.text);
  if (!areas) {
    onLog?.(`source=${sourceId} skip=no-location id=${post.externalId} text="${truncate(post.text)}"`);
    logFailureOnce(repository, logsDir, now, {
      source: sourceId,
      externalId: post.externalId,
      reason: 'no-location',
      text: post.text,
      url: post.url,
      publishedAt: post.publishedAt,
    });
    return null;
  }

  const geocoded = await geocodeAlertArea(areas.locality, areas.regionGenitive, geocodingSource, polygonSource);
  if (!geocoded) {
    onLog?.(
      `source=${sourceId} skip=no-geocode id=${post.externalId} locality="${areas.locality ?? ''}" region="${areas.regionGenitive}" text="${truncate(post.text)}"`,
    );
    logFailureOnce(repository, logsDir, now, {
      source: sourceId,
      externalId: post.externalId,
      reason: 'no-geocode',
      text: post.text,
      url: post.url,
      publishedAt: post.publishedAt,
      settlement: areas.locality ?? undefined,
      region: areas.regionGenitive,
    });
    return null;
  }

  return {
    externalId: post.externalId,
    source: sourceId,
    text: post.text,
    url: post.url,
    publishedAt: post.publishedAt,
    latitude: geocoded.latitude,
    longitude: geocoded.longitude,
    precision: geocoded.precision,
    areaPolygon: geocoded.areaPolygon,
  };
}

/**
 * Ingests 112 activation alerts from @112Greece: fetch new posts since the last one seen ->
 * classify -> extract area -> geocode -> persist only the ones that resolved to real coordinates.
 * Never throws; failures land in fetch_log, same convention as ingestIncidentReports, plus a
 * durable per-day file via processAlertPost for anything that didn't resolve.
 */
export async function ingestAlerts(
  source: IncidentSource,
  repository: CivilProtectionAlertRepository,
  sourceId: string,
  now: () => Date,
  logsDir: string,
  onLog?: (message: string) => void,
  onInserted?: (rows: NewAlertRow[]) => void,
  geocodingSource?: GeocodingSource,
  polygonSource?: AreaPolygonSource,
): Promise<AlertIngestResult> {
  const fetchedAt = now().toISOString();
  const sinceId = repository.findLatestExternalId(sourceId);

  let posts;
  try {
    posts = await source.fetchRecentPosts(sinceId, POSTS_PER_POLL);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    repository.recordFetchLog({ source: sourceId, fetchedAt, httpStatus: null, rowsParsed: 0, rowsInserted: 0, error: message });
    return { postsFetched: 0, rowsInserted: 0, error: message };
  }

  const rows: NewAlertRow[] = [];
  let skipped = 0;
  for (const post of posts) {
    const row = await processAlertPost(post, sourceId, repository, logsDir, now, geocodingSource, polygonSource, onLog);
    if (row) rows.push(row);
    else skipped++;
  }

  const insertedRows = repository.insertAlerts(rows);
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
