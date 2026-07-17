import type { Tier } from '@pyrmap/shared';

export interface NewDetectionRow {
  dedupKey: string;
  tier: Tier;
  source: string;
  latitude: number;
  longitude: number;
  acquiredAt: string; // ISO 8601 UTC
  frp: number | null;
  confidence: string | null;
  satellite: string | null;
  instrument: string | null;
  daynight: string | null;
}

export interface InsertedDetection extends NewDetectionRow {
  id: number;
}

export interface FetchLogEntry {
  source: string;
  fetchedAt: string; // ISO 8601 UTC
  httpStatus: number | null;
  rowsParsed: number;
  rowsInserted: number;
  error: string | null;
}

/** Persists detections and fetch history. SQL lives only in the sqlite adapter implementing this port. */
export interface FireRepository {
  /** INSERT OR IGNORE on dedup_key; returns only the rows that were newly inserted, with their ids. */
  insertDetections(rows: NewDetectionRow[]): InsertedDetection[];
  /** Seeds geo_status('unconfirmed') for newly inserted geo detections. */
  insertUnconfirmedGeoStatus(detectionIds: number[], updatedAt: string): void;
  recordFetchLog(entry: FetchLogEntry): void;
  /** Runs SELECT 1; true if the DB is reachable. */
  healthCheck(): boolean;
  close(): void;
}
