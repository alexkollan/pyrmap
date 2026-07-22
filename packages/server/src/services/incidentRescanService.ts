import { processIncidentPost } from './incidentIngestService.js';
import type { IncidentSource } from '../ports/IncidentSource.js';
import type { IncidentReportRepository, NewIncidentReportRow } from '../ports/IncidentReportRepository.js';
import type { GeocodingSource } from '../ports/GeocodingSource.js';

export interface RescanResult {
  postsChecked: number;
  rowsInserted: number;
  postsSkippedAlreadyResolved: number;
  postsFailed: number;
}

/**
 * Re-examines every post in the last `hours` (via a date-windowed fetch, not since_id — so this
 * revisits posts the regular poll may have already seen and failed to resolve), skipping any post
 * whose external_id is already stored (already resolved, no point re-geocoding it), and logging a
 * failure via processIncidentPost's built-in logIncidentFailure call for anything still
 * unresolvable. Costs a real paid X API read every time it's called — not incremental like the
 * regular since_id-based poll.
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

  const posts = await source.fetchPostsInWindow(startTime, endTime);
  const alreadyResolved = repository.findExternalIdsSince(sourceId, startTime.toISOString());

  const rows: NewIncidentReportRow[] = [];
  let skippedAlreadyResolved = 0;
  let failed = 0;

  for (const post of posts) {
    if (alreadyResolved.has(post.externalId)) {
      skippedAlreadyResolved++;
      continue;
    }
    const row = await processIncidentPost(post, sourceId, logsDir, now, geocodingSource, onLog);
    if (row) rows.push(row);
    else failed++;
  }

  const inserted = repository.insertIncidentReports(rows);
  onLog?.(
    `rescan source=${sourceId} hours=${hours} checked=${posts.length} skippedAlreadyResolved=${skippedAlreadyResolved} inserted=${inserted.length} failed=${failed}`,
  );

  return {
    postsChecked: posts.length,
    rowsInserted: inserted.length,
    postsSkippedAlreadyResolved: skippedAlreadyResolved,
    postsFailed: failed,
  };
}
