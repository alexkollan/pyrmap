import { Marker, Popup } from 'react-leaflet';
import { divIcon } from 'leaflet';
import type { IncidentReport } from '@pyrmap/shared';
import { formatAthensTime, formatRelativeTime } from '../lib/formatting.js';

const PRECISION_LABEL: Record<IncidentReport['precision'], string> = {
  settlement: 'Location: settlement-level (from the report text, not a satellite fix)',
  regional_unit: 'Location: regional-unit-level only — the report named an area, not a specific place',
};

// A flat map-pin silhouette (not an emoji — emoji glyph shape/weight varies by OS and looks
// inconsistent) with a small flame cut out of the white disc. The pin's tip is the anchor point,
// matching normal map-pin conventions (a location someone pointed at, unlike the satellite
// markers' centered circles, which read as "detected here" rather than "reported here").
const PIN_SVG = `<svg width="26" height="34" viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg">
  <path d="M13 0C5.82 0 0 5.82 0 13c0 9.75 13 21 13 21s13-11.25 13-21C26 5.82 20.18 0 13 0z" fill="#7c3aed"/>
  <circle cx="13" cy="13" r="7.5" fill="#fff"/>
  <path d="M13.3 7.6c.9 2 2.7 3 2.7 5.4a3 3 0 01-6 0c0-.5.1-.9.3-1.4-1.2 1.1-1.9 2.5-1.9 4a3.9 3.9 0 007.8 0c0-3.7-1.9-5.4-2.9-8z" fill="#7c3aed"/>
</svg>`;

/**
 * A fire reported by the Fire Service's own X account, geocoded from free Greek text — not a
 * satellite detection, so it deliberately doesn't reuse FireMarker's red/orange palette (same
 * exemption from dev-plan §8.2 as WindLayer's divIcon, see docs/DECISIONS.md 2026-07-20).
 * Regional-unit precision renders at reduced opacity to signal the coarser accuracy without
 * making the less-certain markers visually louder than the precise ones.
 */
export function IncidentMarker({ incident }: { incident: IncidentReport }): JSX.Element {
  const coarse = incident.precision === 'regional_unit';
  const icon = divIcon({
    className: `incident-marker-icon${coarse ? ' incident-marker-coarse' : ''}`,
    html: PIN_SVG,
    iconSize: [26, 34],
    iconAnchor: [13, 34],
    popupAnchor: [0, -30],
  });

  return (
    <Marker position={[incident.latitude, incident.longitude]} icon={icon}>
      <Popup>
        <div className="fire-popup">
          <strong>Reported fire (Fire Service, unverified by satellite)</strong>
          <div>
            {formatAthensTime(incident.publishedAt)} ({formatRelativeTime(incident.publishedAt)})
          </div>
          <div lang="el">{incident.text}</div>
          <div className="fire-popup-caveat">
            <div>{PRECISION_LABEL[incident.precision]}</div>
          </div>
          <div>
            <a href={incident.url} target="_blank" rel="noreferrer">
              View original post ↗
            </a>
          </div>
        </div>
      </Popup>
    </Marker>
  );
}
