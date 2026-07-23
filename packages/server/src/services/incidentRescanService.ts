import { processIncidentPost } from './incidentIngestService.js';
import type { IncidentSource } from '../ports/IncidentSource.js';
import type { IncidentReportRepository, NewIncidentReportRow } from '../ports/IncidentReportRepository.js';
import type { GeocodingSource } from '../ports/GeocodingSource.js';

export interface RescanResult {
  postsChecked: number;
  rowsInserted: number;
  postsSkippedAlreadyResolved: number;
  postsFailed: number;
  error: string | null;
}

/**
 * Re-examines every post in the last `hours` (via a date-windowed fetch, not since_id — so this
 * revisits posts the regular poll may have already seen and failed to resolve), skipping any post
 * whose external_id is already stored (already resolved, no point re-geocoding it), and logging a
 * failure via processIncidentPost's built-in logIncidentFailure call for anything still
 * unresolvable. Costs a real paid X API read every time it's called — not incremental like the
 * regular since_id-based poll. Never throws; failures land in fetch_log, same convention as
 * ingestIncidentReports/ingestSource/ingestFireAlerts.
 */
export async function rescanIncidentReports(
  source: IncidentSource,
  repository: IncidentReportRepository,
  sourceId: string,
  hours: number,
  now: () => Date,
  logsDir: string,
  geocodingSource?: GeocodingSource,
  onLog?: (message: string) => void,
): Promise<RescanResult> {
  const endTime = now();
  const startTime = new Date(endTime.getTime() - hours * 60 * 60 * 1000);
  const fetchedAt = now().toISOString();

  let posts;
  try {
    posts = await source.fetchPostsInWindow(startTime, endTime);
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
    return { postsChecked: 0, rowsInserted: 0, postsSkippedAlreadyResolved: 0, postsFailed: 0, error: message };
  }

  const alreadyResolved = repository.findExternalIdsSince(sourceId, startTime.toISOString());

  const rows: NewIncidentReportRow[] = [];
  let skippedAlreadyResolved = 0;
  let failed = 0;

  for (const post of posts) {
    if (alreadyResolved.has(post.externalId)) {
      skippedAlreadyResolved++;
      continue;
    }
    const row = await processIncidentPost(post, sourceId, repository, logsDir, now, geocodingSource, onLog);
    if (row) rows.push(row);
    else failed++;
  }

  const inserted = repository.insertIncidentReports(rows);
  onLog?.(
    `rescan source=${sourceId} hours=${hours} checked=${posts.length} skippedAlreadyResolved=${skippedAlreadyResolved} inserted=${inserted.length} failed=${failed}`,
  );

  repository.recordFetchLog({
    source: sourceId,
    fetchedAt,
    httpStatus: 200,
    rowsParsed: rows.length,
    rowsInserted: inserted.length,
    error: null,
  });

  return {
    postsChecked: posts.length,
    rowsInserted: inserted.length,
    postsSkippedAlreadyResolved: skippedAlreadyResolved,
    postsFailed: failed,
    error: null,
  };
}
