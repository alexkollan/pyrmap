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
  /** The largest external_id already stored for a source, for since_id-style incremental polling. Null if none yet. */
  findLatestExternalId(source: string): string | null;
  /** Incident reports with published_at >= sinceIso, newest first. */
  findIncidentReportsSince(sinceIso: string): IncidentReport[];
  /** Shares the fetch_log table with FireRepository — same shape, so /api/status picks these up automatically. */
  recordFetchLog(entry: IncidentFetchLogEntry): void;
  /** Deletes reports with published_at < cutoffIso. Returns rows deleted. */
  deleteIncidentReportsBefore(cutoffIso: string): number;
  close(): void;
}
