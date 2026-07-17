import Database, { type Database as DatabaseType } from 'better-sqlite3';
import type { BoundingBox, Detection, GeoStatus, Tier } from '@pyrmap/shared';
import type {
  FetchLogEntry,
  FireRepository,
  InsertedDetection,
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

export class SqliteFireRepository implements FireRepository {
  private readonly db: DatabaseType;

  constructor(dbPath: string) {
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

  healthCheck(): boolean {
    return this.db.prepare('SELECT 1').get() !== undefined;
  }

  close(): void {
    this.db.close();
  }
}
