import Database, { type Database as DatabaseType } from 'better-sqlite3';
import type { AlertAreaPolygon, AlertPrecision, CivilProtectionAlert } from '@pyrmap/shared';
import type {
  AlertFetchLogEntry,
  CivilProtectionAlertRepository,
  NewAlertRow,
} from '../../ports/CivilProtectionAlertRepository.js';
import { runMigrations } from './migrations.js';

interface AlertRow {
  id: number;
  source: string;
  text: string;
  url: string;
  published_at: string;
  latitude: number;
  longitude: number;
  precision: string;
  area_polygon: string | null;
}

function rowToAlert(row: AlertRow): CivilProtectionAlert {
  return {
    id: row.id,
    source: row.source,
    text: row.text,
    url: row.url,
    publishedAt: row.published_at,
    latitude: row.latitude,
    longitude: row.longitude,
    precision: row.precision as AlertPrecision,
    areaPolygon: row.area_polygon ? (JSON.parse(row.area_polygon) as AlertAreaPolygon) : null,
  };
}

/** Own connection to the same DB file as the other repositories (WAL mode makes that safe) — kept
 * separate since 112 alerts are a structurally different concept (any hazard, official source,
 * area polygon) from incident_reports, mirroring why incident_reports itself is separate from
 * detections (docs/superpowers/specs/2026-07-23-112-civil-protection-alerts-design.md). */
export class SqliteCivilProtectionAlertRepository implements CivilProtectionAlertRepository {
  private readonly db: DatabaseType;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    runMigrations(this.db);
  }

  insertAlerts(rows: NewAlertRow[]): NewAlertRow[] {
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO civil_protection_alerts
        (external_id, source, text, url, published_at, latitude, longitude, precision, area_polygon)
      VALUES (@externalId, @source, @text, @url, @publishedAt, @latitude, @longitude, @precision, @areaPolygon)
    `);

    const insertedRows: NewAlertRow[] = [];
    const runAll = this.db.transaction((batch: NewAlertRow[]) => {
      for (const row of batch) {
        const params = { ...row, areaPolygon: row.areaPolygon ? JSON.stringify(row.areaPolygon) : null };
        if (insert.run(params).changes === 1) insertedRows.push(row);
      }
    });
    runAll(rows);

    return insertedRows;
  }

  findLatestExternalId(source: string): string | null {
    const row = this.db
      .prepare(
        `SELECT external_id FROM (
           SELECT external_id FROM civil_protection_alerts WHERE source = ?
           UNION ALL
           SELECT external_id FROM alert_failed_posts WHERE source = ?
         ) ORDER BY CAST(external_id AS INTEGER) DESC LIMIT 1`,
      )
      .get(source, source) as { external_id: string } | undefined;
    return row?.external_id ?? null;
  }

  recordFailedPostIfNew(source: string, externalId: string, reason: string, text: string, seenAtIso: string): boolean {
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO alert_failed_posts (source, external_id, reason, text, first_seen_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(source, externalId, reason, text, seenAtIso);
    return result.changes === 1;
  }

  findAlertsSince(sinceIso: string): CivilProtectionAlert[] {
    const rows = this.db
      .prepare(`SELECT * FROM civil_protection_alerts WHERE published_at >= ? AND hidden = 0 ORDER BY published_at DESC`)
      .all(sinceIso) as AlertRow[];
    return rows.map(rowToAlert);
  }

  findExternalIdsSince(source: string, sinceIso: string): Set<string> {
    const rows = this.db
      .prepare('SELECT external_id FROM civil_protection_alerts WHERE source = ? AND published_at >= ?')
      .all(source, sinceIso) as { external_id: string }[];
    return new Set(rows.map((row) => row.external_id));
  }

  updateAlertLocation(id: number, latitude: number, longitude: number): boolean {
    return (
      this.db
        .prepare(
          `UPDATE civil_protection_alerts SET latitude = ?, longitude = ?, precision = 'locality', area_polygon = NULL WHERE id = ?`,
        )
        .run(latitude, longitude, id).changes === 1
    );
  }

  hideAlert(id: number): boolean {
    return this.db.prepare('UPDATE civil_protection_alerts SET hidden = 1 WHERE id = ?').run(id).changes === 1;
  }

  deleteAlert(id: number): boolean {
    return this.db.prepare('DELETE FROM civil_protection_alerts WHERE id = ?').run(id).changes === 1;
  }

  recordFetchLog(entry: AlertFetchLogEntry): void {
    this.db
      .prepare(
        `INSERT INTO fetch_log (source, fetched_at, http_status, rows_parsed, rows_inserted, error)
         VALUES (@source, @fetchedAt, @httpStatus, @rowsParsed, @rowsInserted, @error)`,
      )
      .run(entry);
  }

  deleteAlertsBefore(cutoffIso: string): number {
    return this.db.prepare('DELETE FROM civil_protection_alerts WHERE published_at < ?').run(cutoffIso).changes;
  }

  close(): void {
    this.db.close();
  }
}
