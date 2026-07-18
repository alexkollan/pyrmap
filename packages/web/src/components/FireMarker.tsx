import { Circle } from 'react-leaflet';
import type { Detection, GeoDetection } from '@pyrmap/shared';
import { FirePopup } from './FirePopup.js';
import { footprintRadiusMeters } from '../lib/footprint.js';

const RED = '#dc2626';
const ORANGE = '#f97316';

/**
 * Markers are sized to the satellite pixel's true ground footprint (meters, via Leaflet's Circle —
 * not CircleMarker's fixed screen pixels), so a wide wildfire naturally reads as a cluster of
 * overlapping circles rather than a single dot indistinguishable from a small fire.
 */

/** Polar detections are confirmed by nature: solid red circle. Marker styles per dev-plan §8.2. */
export function PolarMarker({ detection }: { detection: Detection }): JSX.Element {
  return (
    <Circle
      center={[detection.latitude, detection.longitude]}
      radius={footprintRadiusMeters(detection)}
      pathOptions={{ color: RED, weight: 2, fillColor: RED, fillOpacity: 0.9 }}
    >
      <FirePopup detection={detection} kind="polar" />
    </Circle>
  );
}

/** Geo detections: confirmed = solid orange w/ red border; unconfirmed = hollow dashed pulsing; expired = not rendered. */
export function GeoMarker({ detection }: { detection: GeoDetection }): JSX.Element | null {
  if (detection.status === 'expired') return null;

  const radius = footprintRadiusMeters(detection);

  if (detection.status === 'confirmed') {
    return (
      <Circle
        center={[detection.latitude, detection.longitude]}
        radius={radius}
        pathOptions={{ color: RED, weight: 2, fillColor: ORANGE, fillOpacity: 0.9 }}
      >
        <FirePopup detection={detection} kind="geo-confirmed" />
      </Circle>
    );
  }

  return (
    <Circle
      center={[detection.latitude, detection.longitude]}
      radius={radius}
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
    </Circle>
  );
}
