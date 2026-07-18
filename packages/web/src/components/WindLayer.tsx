import { useEffect, useMemo, useState } from 'react';
import { Marker, Tooltip } from 'react-leaflet';
import { divIcon } from 'leaflet';
import type { FireCluster } from '../lib/fireClusters.js';
import { clusterCentroid } from '../lib/fireClusters.js';
import { arrowRotationDeg, blowsToward, fetchWind, type WindReading } from '../lib/wind.js';

/**
 * Wind arrows at fire-cluster centroids, from Open-Meteo (free, keyless). The arrow points where
 * the wind blows TOWARD — i.e. the direction a fire would be pushed. Uses a divIcon (not a
 * CircleMarker): wind is a vector, not a detection; needs rotation. Logged in DECISIONS 2026-07-18.
 */
export function WindLayer({ clusters }: { clusters: FireCluster[] }): JSX.Element | null {
  const [readings, setReadings] = useState<WindReading[]>([]);

  const centroids = useMemo(() => clusters.map((c) => clusterCentroid(c)), [clusters]);
  // Refetch only when the set of fire locations meaningfully changes, not on every re-render.
  const signature = useMemo(
    () => centroids.map((c) => `${c.lat.toFixed(2)},${c.lon.toFixed(2)}`).join(';'),
    [centroids],
  );

  useEffect(() => {
    if (centroids.length === 0) {
      setReadings([]);
      return;
    }
    let cancelled = false;
    fetchWind(centroids.map((c) => ({ lat: c.lat, lon: c.lon })))
      .then((result) => {
        if (!cancelled) setReadings(result);
      })
      .catch(() => {
        if (!cancelled) setReadings([]); // wind is decorative context; fail silently rather than break the map
      });
    return () => {
      cancelled = true;
    };
    // Depends on `signature` (the stable identity of the centroid set), deliberately not `centroids` itself.
  }, [signature]);

  if (readings.length === 0) return null;

  return (
    <>
      {readings.map((reading, i) => {
        const anchor = centroids[i];
        if (!anchor) return null;
        const icon = divIcon({
          className: 'wind-arrow-icon',
          // The &#10148; glyph points right (east); arrowRotationDeg is 0=up, so offset by -90.
          html: `<div class="wind-arrow" style="transform: rotate(${arrowRotationDeg(reading.directionFromDeg) - 90}deg)">&#10148;</div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        });
        return (
          <Marker key={`${anchor.lat}-${anchor.lon}`} position={[anchor.lat, anchor.lon]} icon={icon}>
            <Tooltip direction="top" offset={[0, -12]}>
              Wind {Math.round(reading.speedKmh)} km/h, pushing {blowsToward(reading.directionFromDeg)}
            </Tooltip>
          </Marker>
        );
      })}
    </>
  );
}
