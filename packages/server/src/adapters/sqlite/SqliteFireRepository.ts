import { statSync } from 'node:fs';
import Database, { type Database as DatabaseType } from 'better-sqlite3';
import type { BoundingBox, Detection, GeoDetection, GeoStatus, Tier } from '@pyrmap/shared';
import type {
  FetchLogEntry,
  FireRepository,
  GeoStatusCounts,
  InsertedDetection,
  LastFetchInfo,
  NewDetectionRow,
} from '../../ports/FireRepository.js';
import { runMigrations } from './migrations.js';

interface DetectionRow {
  id: number;
  tier: string;
  source: string;
  latitude: number;
  longitude: number;
  acquired_at: string;
  frp: number | null;
  confidence: string | null;
  satellite: string | null;
  instrument: string | null;
  daynight: string | null;
}

function rowToDetection(row: DetectionRow): Detection {
  return {
    id: row.id,
    tier: row.tier as Tier,
    source: row.source,
    latitude: row.latitude,
    longitude: row.longitude,
    acquiredAt: row.acquired_at,
    frp: row.frp,
    confidence: row.confidence,
    satellite: row.satellite,
    instrument: row.instrument,
    daynight: row.daynight,
  };
}

interface GeoDetectionRow extends DetectionRow {
  status: string;
  confirmed_by: number | null;
}

function rowToGeoDetection(row: GeoDetectionRow): GeoDetection {
  return {
    ...rowToDetection(row),
    tier: 'geo',
    status: row.status as GeoDetection['status'],
    confirmedBy: row.confirmed_by,
  };
}

export class SqliteFireRepository implements FireRepository {
  private readonly db: DatabaseType;
  private readonly dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    runMigrations(this.db);
  }

  insertDetections(rows: NewDetectionRow[]): InsertedDetection[] {
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO detections
        (dedup_key, tier, source, latitude, longitude, acquired_at, frp, confidence, satellite, instrument, daynight)
      VALUES (@dedupKey, @tier, @source, @latitude, @longitude, @acquiredAt, @frp, @confidence, @satellite, @instrument, @daynight)
    `);

    const inserted: InsertedDetection[] = [];
    const runAll = this.db.transaction((batch: NewDetectionRow[]) => {
      for (const row of batch) {
        const info = insert.run(row);
        if (info.changes === 1) {
          inserted.push({ ...row, id: Number(info.lastInsertRowid) });
        }
      }
    });
    runAll(rows);

    return inserted;
  }

  insertUnconfirmedGeoStatus(detectionIds: number[], updatedAt: string): void {
    const insert = this.db.prepare(
      `INSERT INTO geo_status (detection_id, status, updated_at) VALUES (?, 'unconfirmed', ?)`,
    );
    const runAll = this.db.transaction((ids: number[]) => {
      for (const id of ids) insert.run(id, updatedAt);
    });
    runAll(detectionIds);
  }

  recordFetchLog(entry: FetchLogEntry): void {
    this.db
      .prepare(
        `INSERT INTO fetch_log (source, fetched_at, http_status, rows_parsed, rows_inserted, error)
         VALUES (@source, @fetchedAt, @httpStatus, @rowsParsed, @rowsInserted, @error)`,
      )
      .run(entry);
  }

  findUnconfirmedGeoDetections(sinceIso?: string): Detection[] {
    const sql = `
      SELECT d.* FROM detections d
      JOIN geo_status g ON g.detection_id = d.id
      WHERE g.status = 'unconfirmed'${sinceIso ? ' AND d.acquired_at >= ?' : ''}
    `;
    const rows = (sinceIso ? this.db.prepare(sql).all(sinceIso) : this.db.prepare(sql).all()) as DetectionRow[];
    return rows.map(rowToDetection);
  }

  findPolarCandidatesNear(bbox: BoundingBox, fromIso: string, toIso: string): Detection[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM detections
         WHERE tier = 'polar'
           AND latitude BETWEEN @south AND @north
           AND longitude BETWEEN @west AND @east
           AND acquired_at BETWEEN @fromIso AND @toIso`,
      )
      .all({ ...bbox, fromIso, toIso }) as DetectionRow[];
    return rows.map(rowToDetection);
  }

  confirmGeoDetection(detectionId: number, confirmedById: number, updatedAt: string): void {
    this.db
      .prepare(`UPDATE geo_status SET status = 'confirmed', confirmed_by = ?, updated_at = ? WHERE detection_id = ?`)
      .run(confirmedById, updatedAt, detectionId);
  }

  expireGeoDetections(detectionIds: number[], updatedAt: string): void {
    const update = this.db.prepare(`UPDATE geo_status SET status = 'expired', updated_at = ? WHERE detection_id = ?`);
    const runAll = this.db.transaction((ids: number[]) => {
      for (const id of ids) update.run(updatedAt, id);
    });
    runAll(detectionIds);
  }

  findGeoStatus(detectionId: number): { status: GeoStatus; confirmedById: number | null } | null {
    const row = this.db
      .prepare('SELECT status, confirmed_by FROM geo_status WHERE detection_id = ?')
      .get(detectionId) as { status: string; confirmed_by: number | null } | undefined;
    if (!row) return null;
    return { status: row.status as GeoStatus, confirmedById: row.confirmed_by };
  }

  findPolarDetectionsSince(sinceIso: string): Detection[] {
    const rows = this.db
      .prepare(`SELECT * FROM detections WHERE tier = 'polar' AND acquired_at >= ? ORDER BY acquired_at DESC`)
      .all(sinceIso) as DetectionRow[];
    return rows.map(rowToDetection);
  }

  findGeoDetectionsSince(sinceIso: string, includeExpired: boolean): GeoDetection[] {
    const sql = `
      SELECT d.*, g.status, g.confirmed_by FROM detections d
      JOIN geo_status g ON g.detection_id = d.id
      WHERE d.tier = 'geo' AND d.acquired_at >= ?${includeExpired ? '' : " AND g.status != 'expired'"}
      ORDER BY d.acquired_at DESC
    `;
    const rows = this.db.prepare(sql).all(sinceIso) as GeoDetectionRow[];
    return rows.map(rowToGeoDetection);
  }

  findLastFetchPerSource(): Record<string, LastFetchInfo> {
    const rows = this.db
      .prepare(
        `SELECT f.source, f.fetched_at, f.rows_inserted, f.error
         FROM fetch_log f
         JOIN (SELECT source, MAX(id) AS max_id FROM fetch_log GROUP BY source) latest
           ON f.source = latest.source AND f.id = latest.max_id`,
      )
      .all() as { source: string; fetched_at: string; rows_inserted: number; error: string | null }[];

    const result: Record<string, LastFetchInfo> = {};
    for (const row of rows) {
      result[row.source] = { fetchedAt: row.fetched_at, ok: row.error === null, rowsInserted: row.rows_inserted };
    }
    return result;
  }

  countGeoStatuses(): GeoStatusCounts {
    const rows = this.db.prepare('SELECT status, COUNT(*) AS c FROM geo_status GROUP BY status').all() as {
      status: string;
      c: number;
    }[];
    const counts: GeoStatusCounts = { unconfirmed: 0, confirmed: 0 };
    for (const row of rows) {
      if (row.status === 'unconfirmed') counts.unconfirmed = row.c;
      if (row.status === 'confirmed') counts.confirmed = row.c;
    }
    return counts;
  }

  countPolarSince(sinceIso: string): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS c FROM detections WHERE tier = 'polar' AND acquired_at >= ?`)
      .get(sinceIso) as { c: number };
    return row.c;
  }

  getDbSizeBytes(): number {
    return statSync(this.dbPath).size;
  }

  healthCheck(): boolean {
    return this.db.prepare('SELECT 1').get() !== undefined;
  }

  close(): void {
    this.db.close();
  }
}
