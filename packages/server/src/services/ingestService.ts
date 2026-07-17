import type { Tier } from '@pyrmap/shared';
import { parseFirmsCsv } from '../adapters/firms/csvParser.js';
import { computeDedupKey } from '../domain/dedup.js';
import type { FireDataSource } from '../ports/FireDataSource.js';
import type { FireRepository, NewDetectionRow } from '../ports/FireRepository.js';

export interface IngestParams {
  dataSource: FireDataSource;
  repository: FireRepository;
  sourceId: string;
  tier: Tier;
  bboxString: string;
  dayRange: number;
  now: () => Date;
  onLog?: (message: string) => void;
}

export interface IngestResult {
  source: string;
  rowsParsed: number;
  rowsSkipped: number;
  rowsInserted: number;
  error: string | null;
}

/** Fetches one FIRMS source, parses, dedups, and persists. Never throws — failures are recorded in fetch_log. Dev-plan §5. */
export async function ingestSource(params: IngestParams): Promise<IngestResult> {
  const { dataSource, repository, sourceId, tier, bboxString, dayRange, now, onLog } = params;
  const fetchedAt = now().toISOString();

  let fetchResult;
  try {
    fetchResult = await dataSource.fetchAreaCsv(sourceId, bboxString, dayRange);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    repository.recordFetchLog({
      source: sourceId,
      fetchedAt,
      httpStatus: null,
      rowsParsed: 0,
      rowsInserted: 0,
      error: message,
    });
    return { source: sourceId, rowsParsed: 0, rowsSkipped: 0, rowsInserted: 0, error: message };
  }

  const { rows, parsed, skipped } = parseFirmsCsv(fetchResult.body);
  onLog?.(`source=${sourceId} parsed=${parsed} skipped=${skipped}`);

  const newRows: NewDetectionRow[] = rows.map((parsedRow) => ({
    dedupKey: computeDedupKey({
      source: sourceId,
      latitude: parsedRow.latitude,
      longitude: parsedRow.longitude,
      acquiredAt: parsedRow.acquiredAt,
    }),
    tier,
    source: sourceId,
    latitude: parsedRow.latitude,
    longitude: parsedRow.longitude,
    acquiredAt: parsedRow.acquiredAt,
    frp: parsedRow.frp,
    confidence: parsedRow.confidence,
    satellite: parsedRow.satellite,
    instrument: parsedRow.instrument,
    daynight: parsedRow.daynight,
    scanKm: parsedRow.scanKm,
    trackKm: parsedRow.trackKm,
  }));

  const inserted = repository.insertDetections(newRows);

  if (tier === 'geo' && inserted.length > 0) {
    repository.insertUnconfirmedGeoStatus(
      inserted.map((d) => d.id),
      now().toISOString(),
    );
  }

  repository.recordFetchLog({
    source: sourceId,
    fetchedAt,
    httpStatus: fetchResult.httpStatus,
    rowsParsed: parsed,
    rowsInserted: inserted.length,
    error: null,
  });

  return { source: sourceId, rowsParsed: parsed, rowsSkipped: skipped, rowsInserted: inserted.length, error: null };
}
