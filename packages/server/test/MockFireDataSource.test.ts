import { describe, expect, it } from 'vitest';
import { MockFireDataSource, shiftFixtureTimestamps } from '../src/adapters/firms/MockFireDataSource.js';

describe('shiftFixtureTimestamps', () => {
  const csv = 'latitude,longitude,acq_date,acq_time,frp\n38.1,23.5,2026-07-15,930,10.0\n38.2,23.6,2026-07-15,5,12.0\n';

  it('shifts acq_date/acq_time by the given amount and leaves other columns untouched', () => {
    const oneDayMs = 24 * 60 * 60 * 1000;
    const shifted = shiftFixtureTimestamps(csv, oneDayMs);
    const lines = shifted.split('\n');
    expect(lines[1]).toBe('38.1,23.5,2026-07-16,0930,10.0');
    expect(lines[2]).toBe('38.2,23.6,2026-07-16,0005,12.0');
  });

  it('preserves the relative time gap between rows', () => {
    const shifted = shiftFixtureTimestamps(csv, 3 * 60 * 60 * 1000); // +3h
    const lines = shifted.split('\n');
    expect(lines[1]).toBe('38.1,23.5,2026-07-15,1230,10.0');
    expect(lines[2]).toBe('38.2,23.6,2026-07-15,0305,12.0');
  });
});

describe('MockFireDataSource', () => {
  it('serves fixture rows shifted to be recent relative to the injected now', async () => {
    const now = new Date('2026-08-01T00:00:00Z');
    const source = new MockFireDataSource(() => now);

    const { body } = await source.fetchAreaCsv('MSG_NRT', '', 1);
    const dataLine = body.trim().split('\n')[1]!;
    const acqDate = dataLine.split(',')[2];

    // Fixture rows are anchored at 2026-07-15T09:30Z; MSG_NRT's first row is 5 min later,
    // so shifting to now=2026-08-01 should land it on 2026-08-01.
    expect(acqDate).toBe('2026-08-01');
  });
});
