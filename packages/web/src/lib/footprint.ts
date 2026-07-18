import { GEO_PIXEL_SIZE_KM, POLAR_FALLBACK_PIXEL_SIZE_KM, type Detection } from '@pyrmap/shared';

/**
 * Radius (meters) of the circle to draw for a detection's satellite pixel footprint.
 * Polar detections report their actual scan/track pixel size; geo detections and any
 * polar row missing scan/track fall back to a nominal sensor resolution.
 */
export function footprintRadiusMeters(detection: Detection): number {
  if (detection.tier === 'polar' && detection.scanKm != null && detection.trackKm != null) {
    return ((detection.scanKm + detection.trackKm) / 4) * 1000;
  }
  const fallbackKm = detection.tier === 'polar' ? POLAR_FALLBACK_PIXEL_SIZE_KM : GEO_PIXEL_SIZE_KM;
  return (fallbackKm / 2) * 1000;
}
