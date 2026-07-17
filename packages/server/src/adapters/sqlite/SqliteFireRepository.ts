import Database, { type Database as DatabaseType } from 'better-sqlite3';
import type {
  FetchLogEntry,
  FireRepository,
  InsertedDetection,
  NewDetectionRow,
} from '../../ports/FireRepository.js';
import { runMigrations } from './migrations.js';

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

  healthCheck(): boolean {
    return this.db.prepare('SELECT 1').get() !== undefined;
  }

  close(): void {
    this.db.close();
  }
}
