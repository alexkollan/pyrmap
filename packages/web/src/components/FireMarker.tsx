import { CircleMarker } from 'react-leaflet';
import type { Detection, GeoDetection } from '@pyrmap/shared';
import { FirePopup } from './FirePopup.js';

const RED = '#dc2626';
const ORANGE = '#f97316';

/** Polar detections are confirmed by nature: solid red circle. Marker styles per dev-plan §8.2. */
export function PolarMarker({ detection }: { detection: Detection }): JSX.Element {
  return (
    <CircleMarker
      center={[detection.latitude, detection.longitude]}
      radius={8}
      pathOptions={{ color: RED, weight: 1, fillColor: RED, fillOpacity: 0.9 }}
    >
      <FirePopup detection={detection} kind="polar" />
    </CircleMarker>
  );
}

/** Geo detections: confirmed = solid orange w/ red border; unconfirmed = hollow dashed pulsing; expired = not rendered. */
export function GeoMarker({ detection }: { detection: GeoDetection }): JSX.Element | null {
  if (detection.status === 'expired') return null;

  if (detection.status === 'confirmed') {
    return (
      <CircleMarker
        center={[detection.latitude, detection.longitude]}
        radius={10}
        pathOptions={{ color: RED, weight: 2, fillColor: ORANGE, fillOpacity: 0.9 }}
      >
        <FirePopup detection={detection} kind="geo-confirmed" />
      </CircleMarker>
    );
  }

  return (
    <CircleMarker
      center={[detection.latitude, detection.longitude]}
      radius={12}
      pathOptions={{
        color: ORANGE,
        weight: 2,
        dashArray: '4 3',
        fillColor: ORANGE,
        fillOpacity: 0.25,
        className: 'pulse-marker',
      }}
    >
      <FirePopup detection={detection} kind="geo-unconfirmed" />
    </CircleMarker>
  );
}
