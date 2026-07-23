import Database, { type Database as DatabaseType } from 'better-sqlite3';
import type { IncidentPrecision, IncidentReport } from '@pyrmap/shared';
import type {
  IncidentFetchLogEntry,
  IncidentReportRepository,
  NewIncidentReportRow,
} from '../../ports/IncidentReportRepository.js';
import { runMigrations } from './migrations.js';

interface IncidentReportRow {
  id: number;
  source: string;
  text: string;
  url: string;
  published_at: string;
  latitude: number;
  longitude: number;
  precision: string;
}

function rowToIncidentReport(row: IncidentReportRow): IncidentReport {
  return {
    id: row.id,
    source: row.source,
    text: row.text,
    url: row.url,
    publishedAt: row.published_at,
    latitude: row.latitude,
    longitude: row.longitude,
    precision: row.precision as IncidentPrecision,
  };
}

/** Own connection to the same DB file as SqliteFireRepository (WAL mode makes that safe) — kept
 * as a separate class/port since incident reports are a structurally different concept (a
 * geocoded text report, not a satellite pixel detection) with no confirmation/decay logic. */
export class SqliteIncidentReportRepository implements IncidentReportRepository {
  private readonly db: DatabaseType;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    runMigrations(this.db);
  }

  insertIncidentReports(rows: NewIncidentReportRow[]): NewIncidentReportRow[] {
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO incident_reports
        (external_id, source, text, url, published_at, latitude, longitude, precision)
      VALUES (@externalId, @source, @text, @url, @publishedAt, @latitude, @longitude, @precision)
    `);

    const insertedRows: NewIncidentReportRow[] = [];
    const runAll = this.db.transaction((batch: NewIncidentReportRow[]) => {
      for (const row of batch) {
        if (insert.run(row).changes === 1) insertedRows.push(row);
      }
    });
    runAll(rows);

    return insertedRows;
  }

  findLatestExternalId(source: string): string | null {
    const row = this.db
      .prepare(
        `SELECT external_id FROM (
           SELECT external_id FROM incident_reports WHERE source = ?
           UNION ALL
           SELECT external_id FROM incident_failed_posts WHERE source = ?
         ) ORDER BY CAST(external_id AS INTEGER) DESC LIMIT 1`,
      )
      .get(source, source) as { external_id: string } | undefined;
    return row?.external_id ?? null;
  }

  recordFailedPostIfNew(source: string, externalId: string, reason: string, text: string, seenAtIso: string): boolean {
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO incident_failed_posts (source, external_id, reason, text, first_seen_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(source, externalId, reason, text, seenAtIso);
    return result.changes === 1;
  }

  findIncidentReportsSince(sinceIso: string): IncidentReport[] {
    const rows = this.db
      .prepare(`SELECT * FROM incident_reports WHERE published_at >= ? AND hidden = 0 ORDER BY published_at DESC`)
      .all(sinceIso) as IncidentReportRow[];
    return rows.map(rowToIncidentReport);
  }

  findExternalIdsSince(source: string, sinceIso: string): Set<string> {
    const rows = this.db
      .prepare('SELECT external_id FROM incident_reports WHERE source = ? AND published_at >= ?')
      .all(source, sinceIso) as { external_id: string }[];
    return new Set(rows.map((row) => row.external_id));
  }

  updateIncidentReportLocation(id: number, latitude: number, longitude: number): boolean {
    return (
      this.db
        .prepare(`UPDATE incident_reports SET latitude = ?, longitude = ?, precision = 'settlement' WHERE id = ?`)
        .run(latitude, longitude, id).changes === 1
    );
  }

  hideIncidentReport(id: number): boolean {
    return this.db.prepare('UPDATE incident_reports SET hidden = 1 WHERE id = ?').run(id).changes === 1;
  }

  deleteIncidentReport(id: number): boolean {
    return this.db.prepare('DELETE FROM incident_reports WHERE id = ?').run(id).changes === 1;
  }

  recordFetchLog(entry: IncidentFetchLogEntry): void {
    this.db
      .prepare(
        `INSERT INTO fetch_log (source, fetched_at, http_status, rows_parsed, rows_inserted, error)
         VALUES (@source, @fetchedAt, @httpStatus, @rowsParsed, @rowsInserted, @error)`,
      )
      .run(entry);
  }

  deleteIncidentReportsBefore(cutoffIso: string): number {
    return this.db.prepare('DELETE FROM incident_reports WHERE published_at < ?').run(cutoffIso).changes;
  }

  close(): void {
    this.db.close();
  }
}
