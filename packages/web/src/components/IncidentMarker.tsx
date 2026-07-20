import { Marker, Popup } from 'react-leaflet';
import { divIcon } from 'leaflet';
import type { IncidentReport } from '@pyrmap/shared';
import { formatAthensTime, formatRelativeTime } from '../lib/formatting.js';

const PRECISION_LABEL: Record<IncidentReport['precision'], string> = {
  settlement: 'Location: settlement-level (from the report text, not a satellite fix)',
  regional_unit: 'Location: regional-unit-level only — the report named an area, not a specific place',
};

/**
 * A fire reported by the Fire Service's own X account, geocoded from free Greek text — not a
 * satellite detection, so it deliberately doesn't reuse FireMarker's red/orange palette (same
 * exemption from dev-plan §8.2 as WindLayer's divIcon, see docs/DECISIONS.md 2026-07-20).
 * Regional-unit precision renders larger/fainter to visually signal the coarser accuracy.
 */
export function IncidentMarker({ incident }: { incident: IncidentReport }): JSX.Element {
  const coarse = incident.precision === 'regional_unit';
  const icon = divIcon({
    className: 'incident-marker-icon',
    html: `<div class="incident-marker${coarse ? ' incident-marker-coarse' : ''}">📣</div>`,
    iconSize: coarse ? [30, 30] : [22, 22],
    iconAnchor: coarse ? [15, 15] : [11, 11],
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
