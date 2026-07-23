import type { IncidentPrecision, LocationSearchResult } from '@pyrmap/shared';
import type { GeocodedLocation } from '../../domain/incidentGeocoding.js';
import type { GeocodingSource } from '../../ports/GeocodingSource.js';
import type { LocationSearchSource } from '../../ports/LocationSearchSource.js';

const API_URL = 'https://nominatim.openstreetmap.org/search';
// Nominatim's usage policy requires a descriptive User-Agent identifying the app, not a generic
// library default (see docs/DECISIONS.md 2026-07-22).
const USER_AGENT = 'PyrMap (https://pyrmap.alexcoll.in)';
const TIMEOUT_MS = 8_000;
// Usage policy caps the public instance at ~1 request/second; a little headroom above the line.
const MIN_INTERVAL_MS = 1_100;

// Nominatim's free-text search matches ANY named OSM feature — roads, shops, railway stations —
// not just places. Live-verified 2026-07-22: a bare "Νάουσας" query's top 4 results are all roads
// named after the town in unrelated suburbs (280km from the real one); a bare "Αττική" query
// returns only a railway station, a neighbourhood, and a peninsula, none of them the region. Only
// addresstype values in these two sets are trusted at all — everything else is rejected outright
// (not merely down-weighted), even if it's the only result returned. Expand only once a real
// observed addresstype needs it, not speculatively (see docs/DECISIONS.md 2026-07-20 philosophy).
const SETTLEMENT_ADDRESS_TYPES = new Set(['village', 'town', 'city', 'hamlet', 'municipality', 'suburb', 'quarter', 'locality', 'city_district']);
const REGION_ADDRESS_TYPES = new Set(['island', 'state', 'region', 'county', 'state_district', 'province']);

// Requested wide enough that a genuine place ranked behind same-named roads/shops/etc. is still
// found (the Νάουσας case above needed the 5th result) — increase only with further live evidence.
const RESULT_LIMIT = 5;

type FetchFn = typeof fetch;

interface NominatimResult {
  lat: string;
  lon: string;
  addresstype?: string;
  display_name?: string;
}

/**
 * Resolves a free-text Greek place-name query via OpenStreetMap's public Nominatim search API —
 * no API key needed, but capped at ~1 request/second per usage policy. Understands natural,
 * declined Greek phrasing directly (verified live 2026-07-22 against real missed posts — see
 * docs/DECISIONS.md); the offline gazetteer in domain/incidentGeocoding.ts is the fallback when
 * this returns null (network failure, timeout, no result trusted enough, or genuinely no match).
 * Only the first result whose addresstype is a real place (SETTLEMENT_ADDRESS_TYPES or
 * REGION_ADDRESS_TYPES) is used — see the comment on those sets for why this can't be skipped.
 */
export class NominatimClient implements GeocodingSource, LocationSearchSource {
  private lastCallAt = 0;

  constructor(
    private readonly fetchImpl: FetchFn = fetch,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  private async fetchResults(query: string): Promise<NominatimResult[]> {
    const waitMs = this.lastCallAt + MIN_INTERVAL_MS - this.now();
    if (waitMs > 0) await this.sleep(waitMs);
    this.lastCallAt = this.now();

    const params = new URLSearchParams({
      q: query,
      format: 'jsonv2',
      countrycodes: 'gr',
      limit: String(RESULT_LIMIT),
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(`${API_URL}?${params.toString()}`, {
        headers: { 'User-Agent': USER_AGENT },
        signal: controller.signal,
      });
      if (!response.ok) return [];
      return (await response.json()) as NominatimResult[];
    } catch {
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }

  async geocode(query: string): Promise<GeocodedLocation | null> {
    const results = await this.fetchResults(query);

    for (const result of results) {
      const addressType = result.addresstype ?? '';
      const precision: IncidentPrecision | null = SETTLEMENT_ADDRESS_TYPES.has(addressType)
        ? 'settlement'
        : REGION_ADDRESS_TYPES.has(addressType)
          ? 'regional_unit'
          : null;
      if (!precision) continue;

      const latitude = Number(result.lat);
      const longitude = Number(result.lon);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;

      return { latitude, longitude, precision };
    }

    return null;
  }

  /** Unlike geocode(), returns every result with no addresstype filtering — for a human to choose from, not an automated pipeline. */
  async search(query: string): Promise<LocationSearchResult[]> {
    const results = await this.fetchResults(query);
    const found: LocationSearchResult[] = [];
    for (const result of results) {
      const latitude = Number(result.lat);
      const longitude = Number(result.lon);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
      found.push({ displayName: result.display_name ?? '', latitude, longitude });
    }
    return found;
  }
}
