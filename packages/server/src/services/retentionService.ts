import { RETENTION_DETECTIONS_DAYS, RETENTION_FETCH_LOG_DAYS } from '@pyrmap/shared';
import type { FireRepository } from '../ports/FireRepository.js';
import type { IncidentReportRepository } from '../ports/IncidentReportRepository.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface RetentionResult {
  deletedDetections: number;
  deletedFetchLogs: number;
  deletedIncidentReports: number;
}

/** Daily 03:00 UTC sweep, dev-plan §4.2: drops detections older than 7d and fetch_log rows older than 14d.
 * Incident reports (a different concept, no confirmation/decay) share the 7d detections window. */
export function runRetention(
  repository: FireRepository,
  now: () => Date,
  incidentRepository?: IncidentReportRepository,
): RetentionResult {
  const nowMs = now().getTime();
  const detectionsCutoff = new Date(nowMs - RETENTION_DETECTIONS_DAYS * MS_PER_DAY).toISOString();
  const fetchLogCutoff = new Date(nowMs - RETENTION_FETCH_LOG_DAYS * MS_PER_DAY).toISOString();

  return {
    deletedDetections: repository.deleteDetectionsBefore(detectionsCutoff),
    deletedFetchLogs: repository.deleteFetchLogsBefore(fetchLogCutoff),
    deletedIncidentReports: incidentRepository?.deleteIncidentReportsBefore(detectionsCutoff) ?? 0,
  };
}
