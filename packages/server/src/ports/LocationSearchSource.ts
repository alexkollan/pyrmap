import type { LocationSearchResult } from '@pyrmap/shared';

/** Free-text place-name search returning multiple raw candidates for a human to pick from — unlike
 * GeocodingSource, results are NOT restricted to "trusted" address types, since a human (not an
 * automated pipeline) is the one judging each result's name before choosing. */
export interface LocationSearchSource {
  search(query: string): Promise<LocationSearchResult[]>;
}
