import { CircleMarker } from 'react-leaflet';
import type { Detection, GeoDetection } from '@pyrmap/shared';
import { FirePopup } from './FirePopup.js';
import { ageToColor, hoursSince, SATELLITE_MAX_AGE_HOURS } from '../lib/ageColor.js';
import { trackEvent } from '../lib/analytics.js';

// Confirmed detections keep a red ring regardless of age — that's the trust signal (two
// independent satellites agree), kept separate from the age gradient below so both stay legible.
const CONFIRMED_BORDER = '#dc2626';

/**
 * Point view uses the original dev-plan §8.2 fixed-pixel markers (readable at any zoom), but
 * deviates from its fixed red/orange fill colors: fill now fades red -> orange -> green -> blue
 * -> grey over 24h based on acquiredAt, so age is readable at a glance (explicit user request,
 * see docs/DECISIONS.md 2026-07-20). Confirmed/unconfirmed trust stays visible via border color
 * and dash pattern, which are unaffected by age.
 */

/** Polar detections are confirmed by nature: solid circle, radius 8px, colored by age. */
export function PolarMarker({ detection }: { detection: Detection }): JSX.Element {
  const color = ageToColor(hoursSince(detection.acquiredAt), SATELLITE_MAX_AGE_HOURS);
  return (
    <CircleMarker
      center={[detection.latitude, detection.longitude]}
      radius={8}
      pathOptions={{ color, weight: 1, fillColor: color, fillOpacity: 0.9 }}
      eventHandlers={{ click: () => trackEvent('marker_click', { tier: 'polar' }) }}
    >
      <FirePopup detection={detection} kind="polar" />
    </CircleMarker>
  );
}

/** Geo detections: confirmed = age-colored fill w/ red border; unconfirmed = hollow dashed pulsing, age-colored; expired = not rendered. */
export function GeoMarker({ detection }: { detection: GeoDetection }): JSX.Element | null {
  if (detection.status === 'expired') return null;

  const color = ageToColor(hoursSince(detection.acquiredAt), SATELLITE_MAX_AGE_HOURS);

  if (detection.status === 'confirmed') {
    return (
      <CircleMarker
        center={[detection.latitude, detection.longitude]}
        radius={10}
        pathOptions={{ color: CONFIRMED_BORDER, weight: 2, fillColor: color, fillOpacity: 0.9 }}
        eventHandlers={{ click: () => trackEvent('marker_click', { tier: 'geo' }) }}
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
        color,
        weight: 2,
        dashArray: '4 3',
        fillColor: color,
        fillOpacity: 0.25,
        className: 'pulse-marker',
      }}
      eventHandlers={{ click: () => trackEvent('marker_click', { tier: 'geo' }) }}
    >
      <FirePopup detection={detection} kind="geo-unconfirmed" />
    </CircleMarker>
  );
}
