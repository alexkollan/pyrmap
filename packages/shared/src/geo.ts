const EARTH_RADIUS_KM = 6371;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance between two lat/lon points, in km. */
export function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

export interface BoundingBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Coarse degree-based bounding box around a point, for pre-filtering candidates before exact haversine checks. */
export function boundingBoxAround(lat: number, lon: number, marginDegrees: number): BoundingBox {
  return {
    west: lon - marginDegrees,
    south: lat - marginDegrees,
    east: lon + marginDegrees,
    north: lat + marginDegrees,
  };
}
