import type { FiresResponse, StatusResponse } from '@pyrmap/shared';
import type { FireRepository } from '../ports/FireRepository.js';
import type { IncidentReportRepository } from '../ports/IncidentReportRepository.js';

const MS_PER_HOUR = 60 * 60 * 1000;
const STATUS_POLAR_WINDOW_HOURS = 24;

export interface GetFiresParams {
  hours: number;
  includeExpired: boolean;
  now: () => Date;
}

/** Builds the GET /api/fires response, dev-plan §7. incidentRepository is optional — absent when no incident source is configured. */
export function getFires(
  repository: FireRepository,
  params: GetFiresParams,
  incidentRepository?: IncidentReportRepository,
): FiresResponse {
  const nowDate = params.now();
  const sinceIso = new Date(nowDate.getTime() - params.hours * MS_PER_HOUR).toISOString();

  return {
    generatedAt: nowDate.toISOString(),
    polar: repository.findPolarDetectionsSince(sinceIso),
    geo: repository.findGeoDetectionsSince(sinceIso, params.includeExpired),
    incidents: incidentRepository?.findIncidentReportsSince(sinceIso) ?? [],
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
