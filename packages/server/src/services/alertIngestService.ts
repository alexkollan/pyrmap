import { GREECE_BBOX, MTG_FIR_SOURCE_ID } from '@pyrmap/shared';
import { computeDedupKey } from '../domain/dedup.js';
import { persistNewDetections } from './ingestService.js';
import type { FireAlertSource } from '../ports/FireAlertSource.js';
import type { FireRepository, NewDetectionRow } from '../ports/FireRepository.js';

/** Latest N bulletins per poll; at 10-min cadence this covers ~30 min, dedup makes overlap free. */
const ALERTS_PER_POLL = 3;

export interface AlertIngestResult {
  rowsParsed: number;
  rowsInserted: number;
  error: string | null;
}

/**
 * Ingests Meteosat MTG fire-alert circles as geo-tier detections, dev-plan §5 conventions:
 * never throws, failures land in fetch_log. Bulletins are full-disc — only circles inside
 * the Greece bbox are kept.
 */
export async function ingestFireAlerts(
  alertSource: FireAlertSource,
  repository: FireRepository,
  now: () => Date,
  onLog?: (message: string) => void,
): Promise<AlertIngestResult> {
  const fetchedAt = now().toISOString();

  let alerts;
  try {
    alerts = await alertSource.fetchRecentAlerts(ALERTS_PER_POLL);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    repository.recordFetchLog({
      source: MTG_FIR_SOURCE_ID,
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
          source: MTG_FIR_SOURCE_ID,
          latitude: circle.latitude,
          longitude: circle.longitude,
          acquiredAt: alert.acquiredAt,
        }),
        tier: 'geo',
        source: MTG_FIR_SOURCE_ID,
        latitude: circle.latitude,
        longitude: circle.longitude,
        acquiredAt: alert.acquiredAt,
        frp: null, // the CAP bulletin reports location+radius only, no radiative power
        confidence: null,
        satellite: 'MTG-I1',
        instrument: 'FCI',
        daynight: null,
        // radius r -> scan=track=2r so the frontend footprint radius ((scan+track)/4) equals r.
        scanKm: circle.radiusKm * 2,
        trackKm: circle.radiusKm * 2,
      });
    }
  }

  const inserted = persistNewDetections(repository, 'geo', rows, now);
  onLog?.(`source=${MTG_FIR_SOURCE_ID} alerts=${alerts.length} inGreece=${rows.length} inserted=${inserted}`);

  repository.recordFetchLog({
    source: MTG_FIR_SOURCE_ID,
    fetchedAt,
    httpStatus: 200,
    rowsParsed: rows.length,
    rowsInserted: inserted,
    error: null,
  });

  return { rowsParsed: rows.length, rowsInserted: inserted, error: null };
}
