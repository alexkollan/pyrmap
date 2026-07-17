import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFirmsCsv } from '../src/adapters/firms/csvParser.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const readFixture = (name: string): string => readFileSync(path.join(fixturesDir, name), 'utf-8');

describe('parseFirmsCsv', () => {
  it('parses a valid VIIRS sample, pads acq_time, computes acquiredAt, and skips malformed rows', () => {
    const result = parseFirmsCsv(readFixture('viirs_sample.csv'));

    expect(result.parsed).toBe(3);
    expect(result.skipped).toBe(1); // the row with a blank latitude

    expect(result.rows[0]).toEqual({
      latitude: 38.1234,
      longitude: 23.5678,
      acquiredAt: '2026-07-15T09:30:00Z',
      frp: 12.3,
      confidence: 'n',
      satellite: 'N',
      instrument: 'VIIRS',
      daynight: 'D',
      scanKm: 0.4,
      trackKm: 0.4,
    });

    // acq_time "111" -> padded to "0111" -> 01:11
    expect(result.rows[2]?.acquiredAt).toBe('2026-07-15T01:11:00Z');
  });

  it('parses a geo (MSG) sample with a minimal column set, leaving scan/track null (not reported for geo)', () => {
    const result = parseFirmsCsv(readFixture('msg_geo_sample.csv'));

    expect(result.parsed).toBe(2);
    expect(result.rows[0]).toMatchObject({ latitude: 38.125, longitude: 23.569, frp: 45.2, scanKm: null, trackKm: null });
    // acq_time "5" -> padded to "0005" -> 00:05
    expect(result.rows[1]?.acquiredAt).toBe('2026-07-15T00:05:00Z');
  });

  it('returns [] for a header-only (empty result) body', () => {
    expect(parseFirmsCsv(readFixture('empty_header_only.csv'))).toEqual({ rows: [], parsed: 0, skipped: 0 });
  });

  it('returns [] for a "No data found" body', () => {
    expect(parseFirmsCsv(readFixture('no_data_found.csv'))).toEqual({ rows: [], parsed: 0, skipped: 0 });
  });

  it('returns [] for a fully empty body', () => {
    expect(parseFirmsCsv('')).toEqual({ rows: [], parsed: 0, skipped: 0 });
  });
});
