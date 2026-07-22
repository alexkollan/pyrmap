import boundaryData from './data/greeceBoundary.json' with { type: 'json' };

type Ring = [number, number][]; // [lon, lat] pairs, GeoJSON order
type Polygon = Ring[]; // first ring is the exterior shell, rest are holes
type MultiPolygon = Polygon[];

interface GreeceBoundaryGeoJson {
  type: 'MultiPolygon';
  coordinates: MultiPolygon;
}

const boundary = boundaryData as GreeceBoundaryGeoJson;

interface BoundingBox {
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}

function ringBoundingBox(ring: Ring): BoundingBox {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of ring) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return { minLon, maxLon, minLat, maxLat };
}

// Precomputed once at module load — one polygon part's bounding box, so a query point far from a
// given island/mainland part can skip its (potentially thousands of points) ray-casting test entirely.
const polygonBoxes: BoundingBox[] = boundary.coordinates.map((polygon) => ringBoundingBox(polygon[0]!));

function isInsideBoundingBox(lon: number, lat: number, box: BoundingBox): boolean {
  return lon >= box.minLon && lon <= box.maxLon && lat >= box.minLat && lat <= box.maxLat;
}

// Standard ray-casting point-in-ring test (boundary-inclusive isn't attempted — floating-point
// exact-boundary hits are not a real concern for satellite pixel coordinates).
function isInsideRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    const intersects = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function isInsidePolygon(lon: number, lat: number, polygon: Polygon): boolean {
  const [shell, ...holes] = polygon;
  if (!isInsideRing(lon, lat, shell!)) return false;
  for (const hole of holes) {
    if (isInsideRing(lon, lat, hole)) return false;
  }
  return true;
}

/**
 * True if (latitude, longitude) in decimal degrees is within Greece's actual land boundary
 * (mainland and islands). Uses precise boundary geometry because some Greek islands are only
 * km from Turkey's coast.
 */
export function isWithinGreece(latitude: number, longitude: number): boolean {
  for (let i = 0; i < boundary.coordinates.length; i++) {
    if (!isInsideBoundingBox(longitude, latitude, polygonBoxes[i]!)) continue;
    if (isInsidePolygon(longitude, latitude, boundary.coordinates[i]!)) return true;
  }
  return false;
}
