import type { Database } from 'better-sqlite3';

/** Ordered schema migrations, dev-plan §4.1. Append new entries; never edit a committed one. */
export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE detections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dedup_key TEXT NOT NULL UNIQUE,
    tier TEXT NOT NULL CHECK (tier IN ('geo','polar')),
    source TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    acquired_at TEXT NOT NULL,
    frp REAL,
    confidence TEXT,
    satellite TEXT,
    instrument TEXT,
    daynight TEXT,
    inserted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );
  CREATE INDEX idx_detections_acquired ON detections (acquired_at);
  CREATE INDEX idx_detections_tier ON detections (tier);

  CREATE TABLE geo_status (
    detection_id INTEGER PRIMARY KEY REFERENCES detections(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('unconfirmed','confirmed','expired')),
    confirmed_by INTEGER REFERENCES detections(id),
    updated_at TEXT NOT NULL
  );

  CREATE TABLE fetch_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    http_status INTEGER,
    rows_parsed INTEGER NOT NULL DEFAULT 0,
    rows_inserted INTEGER NOT NULL DEFAULT 0,
    error TEXT
  );
  `,
  `
  ALTER TABLE detections ADD COLUMN scan_km REAL;
  ALTER TABLE detections ADD COLUMN track_km REAL;
  `,
  `
  CREATE TABLE incident_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id TEXT NOT NULL UNIQUE,
    source TEXT NOT NULL,
    text TEXT NOT NULL,
    url TEXT NOT NULL,
    published_at TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    precision TEXT NOT NULL CHECK (precision IN ('settlement','regional_unit')),
    ingested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );
  CREATE INDEX idx_incident_reports_published ON incident_reports (published_at);
  `,
  `
  CREATE TABLE push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  `,
  `
  ALTER TABLE incident_reports ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
  `,
  `
  CREATE TABLE incident_failed_posts (
    source TEXT NOT NULL,
    external_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    text TEXT NOT NULL,
    first_seen_at TEXT NOT NULL,
    PRIMARY KEY (source, external_id)
  );
  `,
];

/** Applies pending migrations in order, tracked by index in a `migrations` table. */
export function runMigrations(db: Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS migrations (id INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const appliedCount = (db.prepare('SELECT COUNT(*) AS c FROM migrations').get() as { c: number }).c;

  for (let i = appliedCount; i < MIGRATIONS.length; i++) {
    const migration = MIGRATIONS[i]!;
    db.exec(migration);
    db.prepare('INSERT INTO migrations (id, applied_at) VALUES (?, ?)').run(i, new Date().toISOString());
  }
}
