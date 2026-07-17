import { describe, expect, it } from 'vitest';
import type { Detection } from '@pyrmap/shared';
import { findConfirmation } from './confirmation.js';

// Pure north-south offsets so distance = R * dLatRadians exactly (no longitude component).
const KM_PER_DEG_LAT = (Math.PI * 6371) / 180;
const deg = (km: number): number => km / KM_PER_DEG_LAT;

let nextId = 1;
const polar = (overrides: Partial<Detection>): Detection => ({
  id: nextId++,
  tier: 'polar',
  source: 'VIIRS_NOAA20_NRT',
  latitude: 38.0,
  longitude: 23.0,
  acquiredAt: '2026-07-15T12:00:00Z',
  frp: null,
  confidence: null,
  satellite: null,
  instrument: null,
  daynight: null,
  scanKm: null,
  trackKm: null,
  ...overrides,
});

const geo: Detection = {
  id: 999,
  tier: 'geo',
  source: 'MSG_NRT',
  latitude: 38.0,
  longitude: 23.0,
  acquiredAt: '2026-07-15T12:00:00Z',
  frp: null,
  confidence: null,
  satellite: null,
  instrument: null,
  daynight: null,
  scanKm: null,
  trackKm: null,
};

describe('findConfirmation', () => {
  it('confirms a polar candidate at 4.9km / 5h', () => {
    const candidate = polar({ latitude: 38.0 + deg(4.9), acquiredAt: '2026-07-15T17:00:00Z' });
    expect(findConfirmation(geo, [candidate])).toBe(candidate);
  });

  it('does not confirm a polar candidate at 5.1km', () => {
    const candidate = polar({ latitude: 38.0 + deg(5.1), acquiredAt: '2026-07-15T17:00:00Z' });
    expect(findConfirmation(geo, [candidate])).toBeNull();
  });

  it('does not confirm a polar candidate 6.5h apart', () => {
    const candidate = polar({ latitude: 38.0 + deg(4.9), acquiredAt: '2026-07-15T18:30:00Z' });
    expect(findConfirmation(geo, [candidate])).toBeNull();
  });

  it('returns the nearest of multiple qualifying candidates', () => {
    const far = polar({ latitude: 38.0 + deg(4.9), acquiredAt: '2026-07-15T17:00:00Z' });
    const near = polar({ latitude: 38.0 + deg(2.0), acquiredAt: '2026-07-15T13:00:00Z' });
    expect(findConfirmation(geo, [far, near])).toBe(near);
  });

  it('returns null when there are no candidates', () => {
    expect(findConfirmation(geo, [])).toBeNull();
  });
});
