import { processAlertPost } from './alert112IngestService.js';
import type { IncidentSource } from '../ports/IncidentSource.js';
import type { CivilProtectionAlertRepository, NewAlertRow } from '../ports/CivilProtectionAlertRepository.js';
import type { GeocodingSource } from '../ports/GeocodingSource.js';
import type { AreaPolygonSource } from '../ports/AreaPolygonSource.js';

export interface AlertRescanResult {
  postsChecked: number;
  rowsInserted: number;
  postsSkippedAlreadyResolved: number;
  postsFailed: number;
  error: string | null;
}

/**
 * Re-examines every 112 post in the last `hours` (date-windowed fetch, not since_id — so this
 * revisits posts the regular poll may have already seen and failed to resolve), skipping any post
 * whose external_id is already stored, logging a failure for anything still unresolvable. Costs a
 * real paid X API read every time. Never throws; failures land in fetch_log — same convention as
 * every other ingest/rescan path.
 */
export async function rescanAlerts(
  source: IncidentSource,
  repository: CivilProtectionAlertRepository,
  sourceId: string,
  hours: number,
  now: () => Date,
  logsDir: string,
  geocodingSource: GeocodingSource | undefined,
  polygonSource: AreaPolygonSource | undefined,
  onLog?: (message: string) => void,
): Promise<AlertRescanResult> {
  const endTime = now();
  const startTime = new Date(endTime.getTime() - hours * 60 * 60 * 1000);
  const fetchedAt = now().toISOString();

  let posts;
  try {
    posts = await source.fetchPostsInWindow(startTime, endTime);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    repository.recordFetchLog({ source: sourceId, fetchedAt, httpStatus: null, rowsParsed: 0, rowsInserted: 0, error: message });
    return { postsChecked: 0, rowsInserted: 0, postsSkippedAlreadyResolved: 0, postsFailed: 0, error: message };
  }

  const alreadyResolved = repository.findExternalIdsSince(sourceId, startTime.toISOString());

  const rows: NewAlertRow[] = [];
  let skippedAlreadyResolved = 0;
  let failed = 0;

  for (const post of posts) {
    if (alreadyResolved.has(post.externalId)) {
      skippedAlreadyResolved++;
      continue;
    }
    const row = await processAlertPost(post, sourceId, repository, logsDir, now, geocodingSource, polygonSource, onLog);
    if (row) rows.push(row);
    else failed++;
  }

  const inserted = repository.insertAlerts(rows);
  onLog?.(
    `rescan source=${sourceId} hours=${hours} checked=${posts.length} skippedAlreadyResolved=${skippedAlreadyResolved} inserted=${inserted.length} failed=${failed}`,
  );

  repository.recordFetchLog({ source: sourceId, fetchedAt, httpStatus: 200, rowsParsed: rows.length, rowsInserted: inserted.length, error: null });

  return { postsChecked: posts.length, rowsInserted: inserted.length, postsSkippedAlreadyResolved: skippedAlreadyResolved, postsFailed: failed, error: null };
}
