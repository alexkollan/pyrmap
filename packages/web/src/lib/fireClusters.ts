import { FIRE_CLUSTER_DISTANCE_KM, type Detection, type GeoDetection } from '@pyrmap/shared';
import { clusterByDistance } from './clustering.js';
import { convexHull, polygonAreaKm2, type LatLon } from './geometry.js';

export type ClusterMember = Detection | GeoDetection;

export interface FireCluster {
  id: string;
  detections: ClusterMember[];
  /** null when fewer than 3 non-collinear points — not enough to describe an area. */
  hull: LatLon[] | null;
  areaKm2: number;
  /** true if any polar detection or confirmed geo detection is in the group. */
  isConfirmed: boolean;
  earliestAcquiredAt: string;
  latestAcquiredAt: string;
  maxFrp: number | null;
}

function isConfirmedMember(detection: ClusterMember): boolean {
  return detection.tier === 'polar' || (detection as GeoDetection).status === 'confirmed';
}

/** Groups nearby detections (both tiers, non-expired) into approximate fire-extent shapes for "area view". */
export function buildFireClusters(
  polar: Detection[],
  geo: GeoDetection[],
  maxDistanceKm: number = FIRE_CLUSTER_DISTANCE_KM,
): FireCluster[] {
  const members: ClusterMember[] = [...polar, ...geo.filter((d) => d.status !== 'expired')];
  const groups = clusterByDistance(members, maxDistanceKm);

  return groups.map((group) => {
    const points: LatLon[] = group.map((d) => ({ lat: d.latitude, lon: d.longitude }));
    const hullPoints = points.length >= 3 ? convexHull(points) : [];
    const hull = hullPoints.length >= 3 ? hullPoints : null;

    const acquiredTimes = group.map((d) => d.acquiredAt).sort();
    const frps = group.map((d) => d.frp).filter((frp): frp is number => frp !== null);

    return {
      id: group
        .map((d) => d.id)
        .sort((a, b) => a - b)
        .join('-'),
      detections: group,
      hull,
      areaKm2: hull ? polygonAreaKm2(hull) : 0,
      isConfirmed: group.some(isConfirmedMember),
      earliestAcquiredAt: acquiredTimes[0]!,
      latestAcquiredAt: acquiredTimes[acquiredTimes.length - 1]!,
      maxFrp: frps.length > 0 ? Math.max(...frps) : null,
    };
  });
}
