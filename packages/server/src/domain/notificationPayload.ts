import type { NewDetectionRow } from '../ports/FireRepository.js';
import type { NewIncidentReportRow } from '../ports/IncidentReportRepository.js';
import type { NewAlertRow } from '../ports/CivilProtectionAlertRepository.js';
import { nearestPlace } from './reverseGeocoding.js';

export interface NotificationPayload {
  title: string;
  body: string;
  url: string;
}

const TIER_LABEL = {
  geo: 'Unconfirmed detection',
  polar: 'Confirmed detection',
} as const;

const MAX_INCIDENT_BODY_CHARS = 140;

/** Builds a push payload for a newly inserted satellite detection. Detection rows carry no
 * place name, so this reverse-geocodes the coordinates first. */
export function buildDetectionPayload(
  detection: Pick<NewDetectionRow, 'tier' | 'latitude' | 'longitude'>,
): NotificationPayload {
  const place = nearestPlace(detection.latitude, detection.longitude);
  const located = place.precision === 'settlement' ? `near ${place.name}` : `in ${place.name}`;
  return {
    title: `🔥 ${TIER_LABEL[detection.tier]}`,
    body: `${located} — tap to view`,
    url: `/?focus=${detection.latitude},${detection.longitude}`,
  };
}

/** Builds a push payload for a newly inserted incident report — its own post text already names
 * the place (Greek Fire Service posts always include one), so no reverse-geocoding needed. */
export function buildIncidentPayload(
  report: Pick<NewIncidentReportRow, 'text' | 'latitude' | 'longitude'>,
): NotificationPayload {
  const collapsed = report.text.replace(/\s+/g, ' ').trim();
  const body =
    collapsed.length > MAX_INCIDENT_BODY_CHARS ? `${collapsed.slice(0, MAX_INCIDENT_BODY_CHARS)}…` : collapsed;
  return {
    title: '📢 Reported fire (X)',
    body,
    url: `/?focus=${report.latitude},${report.longitude}`,
  };
}

/** Builds a push payload for a newly inserted 112 alert — official, so it's flagged distinctly
 * from a Fire Service situational report; its own post text already names the place. */
export function buildAlertPayload(alert: Pick<NewAlertRow, 'text' | 'latitude' | 'longitude'>): NotificationPayload {
  const collapsed = alert.text.replace(/\s+/g, ' ').trim();
  const body = collapsed.length > MAX_INCIDENT_BODY_CHARS ? `${collapsed.slice(0, MAX_INCIDENT_BODY_CHARS)}…` : collapsed;
  return {
    title: '🚨 112 Alert',
    body,
    url: `/?focus=${alert.latitude},${alert.longitude}`,
  };
}
