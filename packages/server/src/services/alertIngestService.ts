import { GREECE_BBOX } from '@pyrmap/shared';
import { computeDedupKey } from '../domain/dedup.js';
import { persistNewDetections } from './ingestService.js';
import type { FireAlertSource } from '../ports/FireAlertSource.js';
import type { FireRepository, InsertedDetection, NewDetectionRow } from '../ports/FireRepository.js';

/** Latest N bulletins/slots per poll; dedup makes overlap across polls free. */
const ALERTS_PER_POLL = 3;

export interface AlertIngestResult {
  rowsParsed: number;
  rowsInserted: number;
  error: string | null;
}

/** Identifies which geo source a batch of alert circles came from, for source/satellite/instrument tagging. */
export interface AlertSourceConfig {
  sourceId: string;
  satellite: string;
  instrument: string;
}

/**
 * Ingests geostationary fire-alert circles as geo-tier detections, dev-plan §5 conventions:
 * never throws, failures land in fetch_log. Bulletins are full-disc — only circles inside
 * the Greece bbox are kept. Shared by every FireAlertSource (EUMETSAT CAP, LSA SAF HDF5, ...);
 * sourceConfig carries the per-source identity so dedup keys and satellite/instrument tags differ.
 */
export async function ingestFireAlerts(
  alertSource: FireAlertSource,
  sourceConfig: AlertSourceConfig,
  repository: FireRepository,
  now: () => Date,
  onLog?: (message: string) => void,
  onInserted?: (rows: InsertedDetection[]) => void,
): Promise<AlertIngestResult> {
  const fetchedAt = now().toISOString();

  let alerts;
  try {
    alerts = await alertSource.fetchRecentAlerts(ALERTS_PER_POLL);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    repository.recordFetchLog({
      source: sourceConfig.sourceId,
      fetchedAt,
      httpStatus: null,
      rowsParsed: 0,
      rowsInserted: 0,
      error: message,
    });
    return { rowsParsed: 0, rowsInserted: 0, error: message };
  }

  const rows: NewDetectionRow[] = [];
  for (const alert of alerts) {
    for (const circle of alert.circles) {
      const inGreece =
        circle.latitude >= GREECE_BBOX.south &&
        circle.latitude <= GREECE_BBOX.north &&
        circle.longitude >= GREECE_BBOX.west &&
        circle.longitude <= GREECE_BBOX.east;
      if (!inGreece) continue;

      rows.push({
        dedupKey: computeDedupKey({
          source: sourceConfig.sourceId,
          latitude: circle.latitude,
          longitude: circle.longitude,
          acquiredAt: alert.acquiredAt,
        }),
        tier: 'geo',
        source: sourceConfig.sourceId,
        latitude: circle.latitude,
        longitude: circle.longitude,
        acquiredAt: alert.acquiredAt,
        frp: circle.frpMw ?? null,
        confidence: circle.confidence != null ? `${Math.round(circle.confidence * 100)}%` : null,
        satellite: sourceConfig.satellite,
        instrument: sourceConfig.instrument,
        daynight: null,
        // radius r -> scan=track=2r so the frontend footprint radius ((scan+track)/4) equals r.
        scanKm: circle.radiusKm * 2,
        trackKm: circle.radiusKm * 2,
      });
    }
  }

  const inserted = persistNewDetections(repository, 'geo', rows, now, onInserted);
  onLog?.(`source=${sourceConfig.sourceId} alerts=${alerts.length} inGreece=${rows.length} inserted=${inserted}`);

  repository.recordFetchLog({
    source: sourceConfig.sourceId,
    fetchedAt,
    httpStatus: 200,
    rowsParsed: rows.length,
    rowsInserted: inserted,
    error: null,
  });

  return { rowsParsed: rows.length, rowsInserted: inserted, error: null };
}
