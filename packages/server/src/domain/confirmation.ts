import {
  CONFIRMATION_MAX_DISTANCE_KM,
  CONFIRMATION_MAX_TIME_HOURS,
  haversineDistanceKm,
  type Detection,
} from '@pyrmap/shared';

const MS_PER_HOUR = 60 * 60 * 1000;

/** Finds the nearest polar detection that corroborates a geo detection, dev-plan §6.3. Null if none qualify. */
export function findConfirmation(geo: Detection, polarCandidates: Detection[]): Detection | null {
  let best: Detection | null = null;
  let bestDistanceKm = Infinity;

  for (const polar of polarCandidates) {
    const distanceKm = haversineDistanceKm(geo.latitude, geo.longitude, polar.latitude, polar.longitude);
    if (distanceKm > CONFIRMATION_MAX_DISTANCE_KM) continue;

    const hoursApart =
      Math.abs(new Date(polar.acquiredAt).getTime() - new Date(geo.acquiredAt).getTime()) / MS_PER_HOUR;
    if (hoursApart > CONFIRMATION_MAX_TIME_HOURS) continue;

    if (distanceKm < bestDistanceKm) {
      bestDistanceKm = distanceKm;
      best = polar;
    }
  }

  return best;
}
