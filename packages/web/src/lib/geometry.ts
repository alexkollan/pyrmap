export interface LatLon {
  lat: number;
  lon: number;
}

function cross(o: LatLon, a: LatLon, b: LatLon): number {
  return (a.lon - o.lon) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lon - o.lon);
}

/**
 * Convex hull via Andrew's monotone chain, treating (lon, lat) as planar (lon,lat) coordinates —
 * a fine approximation at the scale of a single fire (a few to tens of km).
 * Fewer than 3 distinct, non-collinear points can't form an area; returns the input unchanged.
 */
export function convexHull(points: LatLon[]): LatLon[] {
  if (points.length < 3) return points;

  const sorted = [...points].sort((a, b) => a.lon - b.lon || a.lat - b.lat);

  const lower: LatLon[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: LatLon[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

const KM_PER_DEG_LAT = 110.574;

/** Area (km²) of a lat/lon polygon via the shoelace formula, using a local equirectangular approximation. */
export function polygonAreaKm2(points: LatLon[]): number {
  if (points.length < 3) return 0;

  const avgLatRad = (points.reduce((sum, p) => sum + p.lat, 0) / points.length) * (Math.PI / 180);
  const kmPerDegLon = 111.32 * Math.cos(avgLatRad);

  let twiceArea = 0;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i]!;
    const p2 = points[(i + 1) % points.length]!;
    const x1 = p1.lon * kmPerDegLon;
    const y1 = p1.lat * KM_PER_DEG_LAT;
    const x2 = p2.lon * kmPerDegLon;
    const y2 = p2.lat * KM_PER_DEG_LAT;
    twiceArea += x1 * y2 - x2 * y1;
  }
  return Math.abs(twiceArea) / 2;
}
