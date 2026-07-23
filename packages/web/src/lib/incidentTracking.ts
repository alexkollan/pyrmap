import type { Detection, GeoDetection, IncidentReport } from '@pyrmap/shared';
import { trackEvent } from './analytics.js';

// In-memory only (not persisted) — "once per unique incident per visitor" means once per
// browser tab/session, not forever; a fresh page load starts a clean set.
const seen = new Set<string>();

function roundCoord(n: number): number {
  return Math.round(n * 100) / 100;
}

function logIfNew(key: string, type: 'satellite' | 'reported', id: number, source: string, lat: number, lon: number): void {
  if (seen.has(key)) return;
  seen.add(key);
  trackEvent('incident_view', { type, id, source, lat: roundCoord(lat), lon: roundCoord(lon) });
}

/**
 * Logs each satellite detection and reported (X post) incident to analytics exactly once per
 * visitor (per tab lifetime) — call whenever the fetched data changes (e.g. from MapApp's
 * useFires effect). Based on the raw fetched arrays, not further client-side visibility filtering
 * (hidden-source/layer toggles) — this is "did this visitor's session see this incident exist",
 * not "was this exact pixel drawn on their screen".
 */
export function trackNewIncidents(polar: Detection[], geo: GeoDetection[], incidents: IncidentReport[]): void {
  for (const d of polar) logIfNew(`polar:${d.id}`, 'satellite', d.id, d.source, d.latitude, d.longitude);
  for (const d of geo) logIfNew(`geo:${d.id}`, 'satellite', d.id, d.source, d.latitude, d.longitude);
  for (const i of incidents) logIfNew(`incident:${i.id}`, 'reported', i.id, i.source, i.latitude, i.longitude);
}
