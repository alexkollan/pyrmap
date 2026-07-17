import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FireDataSource, FirmsFetchResult } from '../../ports/FireDataSource.js';

// packages/server/{src,dist}/adapters/firms -> packages/server/test/fixtures (same depth from src or dist).
const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../test/fixtures');

const FIXTURE_BY_SOURCE: Record<string, string> = {
  MSG_NRT: 'msg_geo_sample.csv',
  VIIRS_NOAA20_NRT: 'viirs_sample.csv',
  VIIRS_NOAA21_NRT: 'viirs_sample.csv',
  VIIRS_SNPP_NRT: 'viirs_sample.csv',
  MODIS_NRT: 'viirs_sample.csv',
};

// Fixture rows are dated around this anchor. Every acq_date/acq_time gets shifted by the same
// amount so mock data always falls inside the confirmation/decay windows regardless of when
// `dev:mock` is started, while preserving the relative timing between rows those demos depend on.
const FIXTURE_ANCHOR_MS = new Date('2026-07-15T09:30:00Z').getTime();

/** Serves committed fixture CSVs (timestamps shifted to "now") instead of hitting the real FIRMS API — used by `pnpm dev:mock`. */
export class MockFireDataSource implements FireDataSource {
  private readonly shiftMs: number;

  constructor(now: () => Date = () => new Date()) {
    this.shiftMs = now().getTime() - FIXTURE_ANCHOR_MS;
  }

  async fetchAreaCsv(sourceId: string): Promise<FirmsFetchResult> {
    const fixture = FIXTURE_BY_SOURCE[sourceId];
    if (!fixture) return { httpStatus: 200, body: '' };
    const raw = readFileSync(path.join(FIXTURES_DIR, fixture), 'utf-8');
    return { httpStatus: 200, body: shiftFixtureTimestamps(raw, this.shiftMs) };
  }

  async fetchAvailableSourceIds(): Promise<string[]> {
    return Object.keys(FIXTURE_BY_SOURCE);
  }
}

/** Rewrites every row's acq_date/acq_time by shiftMs, keeping every other column untouched. */
export function shiftFixtureTimestamps(csv: string, shiftMs: number): string {
  const lines = csv.trim().split(/\r?\n/);
  const header = lines[0]!.split(',').map((h) => h.trim().toLowerCase());
  const dateIdx = header.indexOf('acq_date');
  const timeIdx = header.indexOf('acq_time');
  if (dateIdx === -1 || timeIdx === -1) return csv;

  const rewritten = lines.map((line, i) => {
    if (i === 0) return line;
    const cols = line.split(',');
    const date = cols[dateIdx]?.trim();
    const time = cols[timeIdx]?.trim().padStart(4, '0');
    if (!date || !time) return line;

    const original = new Date(`${date}T${time.slice(0, 2)}:${time.slice(2, 4)}:00Z`);
    if (Number.isNaN(original.getTime())) return line;

    const shifted = new Date(original.getTime() + shiftMs);
    cols[dateIdx] = shifted.toISOString().slice(0, 10);
    cols[timeIdx] = shifted.toISOString().slice(11, 16).replace(':', '');
    return cols.join(',');
  });

  return rewritten.join('\n');
}
