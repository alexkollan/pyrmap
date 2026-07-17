import type { BoundingBox, Detection, GeoDetection, GeoStatus, Tier } from '@pyrmap/shared';

export interface LastFetchInfo {
  fetchedAt: string; // ISO 8601 UTC
  ok: boolean;
  rowsInserted: number;
}

export interface GeoStatusCounts {
  unconfirmed: number;
  confirmed: number;
}

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

  /** geo-tier detections with status='unconfirmed', optionally restricted to acquired_at >= sinceIso. */
  findUnconfirmedGeoDetections(sinceIso?: string): Detection[];
  /** polar-tier detections inside a coarse bbox and acquired_at window — pre-filter for findConfirmation. */
  findPolarCandidatesNear(bbox: BoundingBox, fromIso: string, toIso: string): Detection[];
  /** Sets geo_status to 'confirmed', recording which polar detection corroborated it. */
  confirmGeoDetection(detectionId: number, confirmedById: number, updatedAt: string): void;
  /** Sets geo_status to 'expired' for the given detection ids. */
  expireGeoDetections(detectionIds: number[], updatedAt: string): void;
  /** Reads back a single geo detection's status row (status + which polar detection confirmed it, if any). */
  findGeoStatus(detectionId: number): { status: GeoStatus; confirmedById: number | null } | null;

  /** polar-tier detections with acquired_at >= sinceIso, sorted by acquiredAt desc. */
  findPolarDetectionsSince(sinceIso: string): Detection[];
  /** geo-tier detections with acquired_at >= sinceIso, sorted by acquiredAt desc; excludes 'expired' unless includeExpired. */
  findGeoDetectionsSince(sinceIso: string, includeExpired: boolean): GeoDetection[];
  /** The most recent fetch_log entry per source. */
  findLastFetchPerSource(): Record<string, LastFetchInfo>;
  /** Counts of geo_status rows by status (unconfirmed/confirmed; 'expired' not included). */
  countGeoStatuses(): GeoStatusCounts;
  /** Count of polar-tier detections with acquired_at >= sinceIso. */
  countPolarSince(sinceIso: string): number;
  /** Size in bytes of the underlying DB file on disk. */
  getDbSizeBytes(): number;

  /** Deletes detections with acquired_at < cutoffIso (cascades to geo_status). Returns rows deleted. */
  deleteDetectionsBefore(cutoffIso: string): number;
  /** Deletes fetch_log rows with fetched_at < cutoffIso. Returns rows deleted. */
  deleteFetchLogsBefore(cutoffIso: string): number;

  /** Runs SELECT 1; true if the DB is reachable. */
  healthCheck(): boolean;
  close(): void;
}
