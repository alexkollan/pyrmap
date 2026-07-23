import type { AlertAreaPolygon, AlertPrecision, CivilProtectionAlert } from '@pyrmap/shared';

export interface NewAlertRow {
  externalId: string;
  source: string;
  text: string;
  url: string;
  publishedAt: string; // ISO 8601 UTC
  latitude: number;
  longitude: number;
  precision: AlertPrecision;
  areaPolygon: AlertAreaPolygon | null;
}

export interface AlertFetchLogEntry {
  source: string;
  fetchedAt: string; // ISO 8601 UTC
  httpStatus: number | null;
  rowsParsed: number;
  rowsInserted: number;
  error: string | null;
}

/** Persists geocoded 112 alerts and fetch history. SQL lives only in the sqlite adapter implementing this port. */
export interface CivilProtectionAlertRepository {
  /** INSERT OR IGNORE on external_id; returns only the rows that were newly inserted. */
  insertAlerts(rows: NewAlertRow[]): NewAlertRow[];
  /** The largest external_id fully dealt with for a source (inserted OR permanently logged as a
   * failure), for since_id-style incremental polling. Null if none yet. Must include failed posts
   * too — see IncidentReportRepository.findLatestExternalId's doc comment for why. */
  findLatestExternalId(source: string): string | null;
  /** Records that (source, externalId) failed to resolve, if not already recorded. Returns true
   * the first time (caller should durably log it), false otherwise — one failure log entry per
   * unique post, ever. */
  recordFailedPostIfNew(source: string, externalId: string, reason: string, text: string, seenAtIso: string): boolean;
  /** Alerts with published_at >= sinceIso, newest first, excluding hidden ones. */
  findAlertsSince(sinceIso: string): CivilProtectionAlert[];
  /** external_ids for a source already stored with published_at >= sinceIso — for rescan's "skip what's already resolved" check. */
  findExternalIdsSince(source: string, sinceIso: string): Set<string>;
  /** Corrects a mis-geocoded alert's coordinates, clears its area polygon (a hand-placed point has
   * no known boundary), and marks it locality-precision. False if id doesn't exist. */
  updateAlertLocation(id: number, latitude: number, longitude: number): boolean;
  /** Marks an alert hidden forever: excluded from findAlertsSince, but the row (and its external_id) stays, permanently blocking re-insertion. False if id doesn't exist. */
  hideAlert(id: number): boolean;
  /** Removes an alert entirely — unlike hideAlert, its external_id can be re-inserted by a future poll/rescan. False if id doesn't exist. */
  deleteAlert(id: number): boolean;
  /** Shares the fetch_log table with FireRepository/IncidentReportRepository — same shape, so /api/status picks these up automatically. */
  recordFetchLog(entry: AlertFetchLogEntry): void;
  /** Deletes alerts with published_at < cutoffIso. Returns rows deleted. */
  deleteAlertsBefore(cutoffIso: string): number;
  close(): void;
}
