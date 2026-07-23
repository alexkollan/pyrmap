import type { FiresResponse, StatusResponse } from '@pyrmap/shared';
import type { FireRepository } from '../ports/FireRepository.js';
import type { IncidentReportRepository } from '../ports/IncidentReportRepository.js';
import type { CivilProtectionAlertRepository } from '../ports/CivilProtectionAlertRepository.js';

const MS_PER_HOUR = 60 * 60 * 1000;
const STATUS_POLAR_WINDOW_HOURS = 24;

export interface GetFiresParams {
  hours: number;
  includeExpired: boolean;
  now: () => Date;
}

/** Builds the GET /api/fires response, dev-plan §7. incidentRepository/alertRepository are
 * optional — absent when no incident source / no 112 alert source is configured. */
export function getFires(
  repository: FireRepository,
  params: GetFiresParams,
  incidentRepository?: IncidentReportRepository,
  alertRepository?: CivilProtectionAlertRepository,
): FiresResponse {
  const nowDate = params.now();
  const sinceIso = new Date(nowDate.getTime() - params.hours * MS_PER_HOUR).toISOString();

  return {
    generatedAt: nowDate.toISOString(),
    polar: repository.findPolarDetectionsSince(sinceIso),
    geo: repository.findGeoDetectionsSince(sinceIso, params.includeExpired),
    incidents: incidentRepository?.findIncidentReportsSince(sinceIso) ?? [],
    alerts: alertRepository?.findAlertsSince(sinceIso) ?? [],
  };
}

/** Builds the GET /api/status response, dev-plan §7. */
export function getStatus(repository: FireRepository, now: () => Date): StatusResponse {
  const sinceIso = new Date(now().getTime() - STATUS_POLAR_WINDOW_HOURS * MS_PER_HOUR).toISOString();
  const { unconfirmed, confirmed } = repository.countGeoStatuses();

  return {
    lastFetch: repository.findLastFetchPerSource(),
    counts: {
      geoUnconfirmed: unconfirmed,
      geoConfirmed: confirmed,
      polarLast24h: repository.countPolarSince(sinceIso),
    },
    dbSizeBytes: repository.getDbSizeBytes(),
  };
}
