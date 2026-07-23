import type { IncidentPrecision, IncidentReport } from '@pyrmap/shared';

export interface NewIncidentReportRow {
  externalId: string;
  source: string;
  text: string;
  url: string;
  publishedAt: string; // ISO 8601 UTC
  latitude: number;
  longitude: number;
  precision: IncidentPrecision;
}

export interface IncidentFetchLogEntry {
  source: string;
  fetchedAt: string; // ISO 8601 UTC
  httpStatus: number | null;
  rowsParsed: number;
  rowsInserted: number;
  error: string | null;
}

/** Persists geocoded incident reports and fetch history. SQL lives only in the sqlite adapter implementing this port. */
export interface IncidentReportRepository {
  /** INSERT OR IGNORE on external_id; returns only the rows that were newly inserted. */
  insertIncidentReports(rows: NewIncidentReportRow[]): NewIncidentReportRow[];
  /** The largest external_id we've fully dealt with for a source (inserted OR permanently logged as a
   * failure), for since_id-style incremental polling. Null if none yet. Must include failed posts, not
   * just inserted ones — otherwise since_id never advances past a post that never resolves, and the
   * poller refetches (and reprocesses/re-logs) it forever. */
  findLatestExternalId(source: string): string | null;
  /** Records that (source, externalId) failed to resolve, if it hasn't been recorded before. Returns
   * true the first time (caller should durably log it), false if already recorded (caller should not
   * log it again) — the single dedup point ensuring one failure log entry per unique post, ever,
   * regardless of how many times polling/rescanning re-encounters it. */
  recordFailedPostIfNew(source: string, externalId: string, reason: string, text: string, seenAtIso: string): boolean;
  /** Incident reports with published_at >= sinceIso, newest first. */
  findIncidentReportsSince(sinceIso: string): IncidentReport[];
  /** external_ids for a source already stored with published_at >= sinceIso — for rescan's "skip what's already resolved" check. */
  findExternalIdsSince(source: string, sinceIso: string): Set<string>;
  /** Corrects a mis-geocoded report's coordinates and marks it settlement-precision (a human placed it exactly). False if id doesn't exist. */
  updateIncidentReportLocation(id: number, latitude: number, longitude: number): boolean;
  /** Marks a report hidden forever: excluded from findIncidentReportsSince, but the row (and its external_id) stays, permanently blocking re-insertion. False if id doesn't exist. */
  hideIncidentReport(id: number): boolean;
  /** Removes a report entirely — unlike hideIncidentReport, its external_id can be re-inserted by a future poll/rescan. False if id doesn't exist. */
  deleteIncidentReport(id: number): boolean;
  /** Shares the fetch_log table with FireRepository — same shape, so /api/status picks these up automatically. */
  recordFetchLog(entry: IncidentFetchLogEntry): void;
  /** Deletes reports with published_at < cutoffIso. Returns rows deleted. */
  deleteIncidentReportsBefore(cutoffIso: string): number;
  close(): void;
}
