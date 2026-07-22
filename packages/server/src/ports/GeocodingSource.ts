import type { GeocodedLocation } from '../domain/incidentGeocoding.js';

/** Resolves a free-text place-name query to coordinates via a live geocoding service. Returns
 * null if the service found nothing, was unreachable, or timed out — callers should fall back to
 * the offline gazetteer (domain/incidentGeocoding.ts) rather than treat null as authoritative. */
export interface GeocodingSource {
  geocode(query: string): Promise<GeocodedLocation | null>;
}
