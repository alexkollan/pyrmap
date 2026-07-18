import { Circle, Polygon } from 'react-leaflet';
import type { FireCluster } from '../lib/fireClusters.js';
import { footprintRadiusMeters } from '../lib/footprint.js';
import { ClusterPopup } from './ClusterPopup.js';

const RED = '#dc2626';
const ORANGE = '#f97316';

/** Renders a cluster as a filled hull (3+ points) or, when there's no hull, a circle per point. */
export function FireClusterShape({ cluster }: { cluster: FireCluster }): JSX.Element {
  const color = cluster.isConfirmed ? RED : ORANGE;

  if (cluster.hull) {
    return (
      <Polygon
        positions={cluster.hull.map((p) => [p.lat, p.lon])}
        pathOptions={{
          color,
          weight: 2,
          fillColor: color,
          fillOpacity: 0.35,
          dashArray: cluster.isConfirmed ? undefined : '6 4',
        }}
      >
        <ClusterPopup cluster={cluster} />
      </Polygon>
    );
  }

  return (
    <>
      {cluster.detections.map((detection) => (
        <Circle
          key={detection.id}
          center={[detection.latitude, detection.longitude]}
          radius={footprintRadiusMeters(detection)}
          pathOptions={{
            color,
            weight: 2,
            fillColor: color,
            fillOpacity: cluster.isConfirmed ? 0.9 : 0.25,
            dashArray: cluster.isConfirmed ? undefined : '4 3',
          }}
        >
          <ClusterPopup cluster={cluster} />
        </Circle>
      ))}
    </>
  );
}
