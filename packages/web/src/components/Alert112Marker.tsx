import { useState } from 'react';
import { Marker, Popup } from 'react-leaflet';
import { divIcon } from 'leaflet';
import type { Marker as LeafletMarkerInstance } from 'leaflet';
import type { CivilProtectionAlert } from '@pyrmap/shared';
import { formatAthensTime, formatRelativeTime } from '../lib/formatting.js';
import { Alert112EditControls } from './Alert112EditControls.js';
import { updateAlertLocation } from '../api/client.js';
import { trackEvent } from '../lib/analytics.js';

const PRECISION_LABEL: Record<CivilProtectionAlert['precision'], string> = {
  locality: 'Location: the specific named area (from the alert text)',
  regional_unit: 'Location: regional-unit-level only — the alert named only the wider region',
};

const ALERT_COLOR = '#dc2626';

// A pin silhouette matching the same conventions as IncidentMarker (tip-anchored, "someone
// pointed here"), with an exclamation mark instead of a flame — deliberately distinct so this
// reads as "official emergency alert", not "someone reported a fire". Fixed color, not an
// age-gradient: unlike a Fire Service situational update, a 112 activation should stay visually
// prominent for as long as it's shown, not fade over the course of a few hours.
function alertPinSvg(): string {
  return `<svg width="26" height="34" viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg">
  <path d="M13 0C5.82 0 0 5.82 0 13c0 9.75 13 21 13 21s13-11.25 13-21C26 5.82 20.18 0 13 0z" fill="${ALERT_COLOR}"/>
  <circle cx="13" cy="13" r="7.5" fill="#fff"/>
  <path d="M13 7.5v6" stroke="${ALERT_COLOR}" stroke-width="2.2" stroke-linecap="round"/>
  <circle cx="13" cy="17.2" r="1.1" fill="${ALERT_COLOR}"/>
</svg>`;
}

const ICON = divIcon({
  className: 'alert112-marker-icon',
  html: alertPinSvg(),
  iconSize: [26, 34],
  iconAnchor: [13, 34],
  popupAnchor: [0, -30],
});

/** A 112 civil-protection activation (@112Greece) — see docs/superpowers/specs/2026-07-23-112-civil-protection-alerts-design.md. */
export function Alert112Marker({ alert, editMode }: { alert: CivilProtectionAlert; editMode: boolean }): JSX.Element {
  const [dragError, setDragError] = useState<string | null>(null);

  return (
    <Marker
      position={[alert.latitude, alert.longitude]}
      icon={ICON}
      draggable={editMode}
      eventHandlers={{
        click: () => trackEvent('marker_click', { tier: 'alert112' }),
        ...(editMode
          ? {
              dragend: (event: { target: LeafletMarkerInstance }) => {
                const marker = event.target;
                trackEvent('alert112_pin_dragged');
                const { lat, lng } = marker.getLatLng();
                updateAlertLocation(alert.id, lat, lng).catch(() => {
                  setDragError('Move failed — try again.');
                  marker.setLatLng([alert.latitude, alert.longitude]);
                });
              },
            }
          : {}),
      }}
    >
      <Popup>
        <div className="fire-popup">
          <strong>112 Alert (official civil-protection activation)</strong>
          <div>
            {formatAthensTime(alert.publishedAt)} ({formatRelativeTime(alert.publishedAt)})
          </div>
          <div lang="el">{alert.text}</div>
          <div className="fire-popup-caveat">
            <div>{PRECISION_LABEL[alert.precision]}</div>
          </div>
          <div>
            <a href={alert.url} target="_blank" rel="noreferrer" onClick={() => trackEvent('alert112_original_post_click')}>
              View original post ↗
            </a>
          </div>
          {editMode && <Alert112EditControls alert={alert} />}
          {dragError && <div className="incident-edit-error">{dragError}</div>}
        </div>
      </Popup>
    </Marker>
  );
}
