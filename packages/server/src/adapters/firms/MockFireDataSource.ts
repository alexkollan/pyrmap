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

/** Serves committed fixture CSVs instead of hitting the real FIRMS API — used by `pnpm dev:mock`. */
export class MockFireDataSource implements FireDataSource {
  async fetchAreaCsv(sourceId: string): Promise<FirmsFetchResult> {
    const fixture = FIXTURE_BY_SOURCE[sourceId];
    if (!fixture) return { httpStatus: 200, body: '' };
    const body = readFileSync(path.join(FIXTURES_DIR, fixture), 'utf-8');
    return { httpStatus: 200, body };
  }

  async fetchAvailableSourceIds(): Promise<string[]> {
    return Object.keys(FIXTURE_BY_SOURCE);
  }
}
