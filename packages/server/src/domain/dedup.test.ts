import { describe, expect, it } from 'vitest';
import { computeDedupKey } from './dedup.js';

const base = { source: 'VIIRS_NOAA20_NRT', latitude: 38.12341, longitude: 23.56781, acquiredAt: '2026-07-15T09:30:00Z' };

describe('computeDedupKey', () => {
  it('produces the same key for the same row twice', () => {
    expect(computeDedupKey(base)).toBe(computeDedupKey({ ...base }));
  });

  it('produces the same key when only the 5th decimal differs', () => {
    const shifted = { ...base, latitude: base.latitude + 0.000005, longitude: base.longitude + 0.000005 };
    expect(computeDedupKey(base)).toBe(computeDedupKey(shifted));
  });

  it('produces a different key for a different source', () => {
    expect(computeDedupKey(base)).not.toBe(computeDedupKey({ ...base, source: 'MODIS_NRT' }));
  });
});
