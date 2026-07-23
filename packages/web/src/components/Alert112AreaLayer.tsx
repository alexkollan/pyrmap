import { GeoJSON } from 'react-leaflet';
import type { CivilProtectionAlert } from '@pyrmap/shared';

const PATH_OPTIONS = { color: '#dc2626', weight: 2, fillOpacity: 0.15 };

/** Highlights a 112 alert's best-effort area polygon (locality boundary, or the containing
 * regional unit's as a coarser fallback) — see docs/superpowers/specs/2026-07-23-112-civil-protection-alerts-design.md.
 * react-leaflet's <GeoJSON> only reads its `data` prop once (on mount); this alert's polygon never
 * changes after ingestion except via a manual relocate, which clears it entirely (Alert112Marker
 * simply stops rendering this component in that case), so no `key` remount trick is needed. */
export function Alert112AreaLayer({ alert }: { alert: CivilProtectionAlert }): JSX.Element | null {
  if (!alert.areaPolygon) return null;
  return <GeoJSON data={alert.areaPolygon} pathOptions={PATH_OPTIONS} />;
}
