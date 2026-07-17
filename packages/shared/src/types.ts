export type Tier = 'geo' | 'polar';
export type GeoStatus = 'unconfirmed' | 'confirmed' | 'expired';

export interface Detection {
  id: number;
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
  scanKm: number | null; // satellite pixel size along-scan, km (polar tier only; FIRMS doesn't report this for geo)
  trackKm: number | null; // satellite pixel size along-track, km (polar tier only)
}

export interface GeoDetection extends Detection {
  tier: 'geo';
  status: GeoStatus;
  confirmedBy: number | null;
}

export interface FiresResponse {
  generatedAt: string; // ISO 8601 UTC
  polar: Detection[];
  geo: GeoDetection[];
}

export interface SourceFetchStatus {
  fetchedAt: string; // ISO 8601 UTC
  ok: boolean;
  rowsInserted: number;
}

export interface StatusResponse {
  lastFetch: Record<string, SourceFetchStatus>;
  counts: {
    geoUnconfirmed: number;
    geoConfirmed: number;
    polarLast24h: number;
  };
  dbSizeBytes: number;
}

export interface HealthResponse {
  ok: boolean;
}
