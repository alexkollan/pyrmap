import { Popup } from 'react-leaflet';
import type { FireCluster } from '../lib/fireClusters.js';
import { formatAthensTime, formatRelativeTime } from '../lib/formatting.js';

export function ClusterPopup({ cluster }: { cluster: FireCluster }): JSX.Element {
  const polarCount = cluster.detections.filter((d) => d.tier === 'polar').length;
  const geoCount = cluster.detections.length - polarCount;

  return (
    <Popup>
      <div className="fire-popup">
        <strong>{cluster.isConfirmed ? 'Confirmed fire area' : 'Unconfirmed hotspot area'}</strong>
        <div>
          {cluster.detections.length} detections
          {polarCount > 0 && geoCount > 0 ? ` (${polarCount} polar, ${geoCount} Meteosat)` : null}
        </div>
        {cluster.areaKm2 > 0 && <div>Approx. extent: {cluster.areaKm2.toFixed(1)} km² (estimate)</div>}
        {cluster.maxFrp !== null && <div>Peak FRP: {cluster.maxFrp} MW</div>}
        <div>
          Last detected {formatAthensTime(cluster.latestAcquiredAt)} ({formatRelativeTime(cluster.latestAcquiredAt)})
        </div>
        {cluster.earliestAcquiredAt !== cluster.latestAcquiredAt && (
          <div>First detected {formatAthensTime(cluster.earliestAcquiredAt)}</div>
        )}
        {!cluster.isConfirmed && (
          <div className="fire-popup-caveat">
            <div>Estimated extent from clustered Meteosat hotspots — awaiting high-resolution confirmation.</div>
            <div lang="el">
              Εκτιμώμενη έκταση από ομαδοποιημένα σημεία Meteosat. Αναμένεται επιβεβαίωση.
            </div>
          </div>
        )}
      </div>
    </Popup>
  );
}
