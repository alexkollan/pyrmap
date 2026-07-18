export interface WindReading {
  latitude: number;
  longitude: number;
  speedKmh: number;
  /** Meteorological convention: degrees the wind blows FROM (0 = from north). */
  directionFromDeg: number;
}

/** Rotation (deg clockwise from up) for an arrow that points where the wind blows TO. */
export function arrowRotationDeg(directionFromDeg: number): number {
  return (directionFromDeg + 180) % 360;
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/** Compass label for the direction the wind blows TOWARD, e.g. 270 (from W) -> "E". */
export function blowsToward(directionFromDeg: number): string {
  const toward = (directionFromDeg + 180) % 360;
  return COMPASS[Math.round(toward / 45) % 8]!;
}

interface OpenMeteoLocation {
  latitude: number;
  longitude: number;
  current?: { wind_speed_10m?: number; wind_direction_10m?: number };
}

/**
 * Current 10m wind for up to ~50 points in one request. Open-Meteo is free and keyless
 * (justification for the external call: dev-plan §15 whitelists no weather source, but this is a
 * frontend-only fetch — no npm dependency — logged in docs/DECISIONS.md 2026-07-18).
 */
export async function fetchWind(points: { lat: number; lon: number }[]): Promise<WindReading[]> {
  if (points.length === 0) return [];
  const lats = points.map((p) => p.lat.toFixed(3)).join(',');
  const lons = points.map((p) => p.lon.toFixed(3)).join(',');
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=kmh`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Open-Meteo request failed: HTTP ${response.status}`);
  }
  const body = (await response.json()) as OpenMeteoLocation | OpenMeteoLocation[];
  const locations = Array.isArray(body) ? body : [body];

  return locations.flatMap((loc) => {
    const speed = loc.current?.wind_speed_10m;
    const direction = loc.current?.wind_direction_10m;
    if (speed == null || direction == null) return [];
    return [{ latitude: loc.latitude, longitude: loc.longitude, speedKmh: speed, directionFromDeg: direction }];
  });
}
