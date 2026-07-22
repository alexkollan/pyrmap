export interface FocusTarget {
  lat: number;
  lon: number;
}

/** Parses a "?focus=lat,lon" query string (from a push notification's deep link) into
 * coordinates the map should pan to. Null when absent or malformed. */
export function parseFocusTarget(search: string): FocusTarget | null {
  const params = new URLSearchParams(search);
  const raw = params.get('focus');
  if (!raw) return null;
  const [latStr, lonStr] = raw.split(',');
  const lat = Number(latStr);
  const lon = Number(lonStr);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}
