import { describe, expect, it } from 'vitest';
import type { Detection } from '@pyrmap/shared';
import { footprintRadiusMeters } from './footprint.js';

const base: Detection = {
  id: 1,
  tier: 'polar',
  source: 'VIIRS_NOAA20_NRT',
  latitude: 38,
  longitude: 23,
  acquiredAt: '2026-07-15T09:30:00Z',
  frp: null,
  confidence: null,
  satellite: null,
  instrument: null,
  daynight: null,
  scanKm: null,
  trackKm: null,
};

describe('footprintRadiusMeters', () => {
  it('uses scan/track for a polar detection that reports them', () => {
    // scan=0.4km, track=0.4km -> radius = (0.4+0.4)/4 * 1000 = 200m
    expect(footprintRadiusMeters({ ...base, scanKm: 0.4, trackKm: 0.4 })).toBe(200);
  });

  it('averages asymmetric scan/track values', () => {
    // scan=1.0km, track=0.6km -> (1.0+0.6)/4 * 1000 = 400m
    expect(footprintRadiusMeters({ ...base, scanKm: 1.0, trackKm: 0.6 })).toBe(400);
  });

  it('falls back to the nominal VIIRS resolution for a polar row missing scan/track', () => {
    expect(footprintRadiusMeters({ ...base, scanKm: null, trackKm: null })).toBe(250); // 0.5km / 2 * 1000
  });

  it('falls back to the nominal Meteosat resolution for geo detections (never reports scan/track)', () => {
    expect(footprintRadiusMeters({ ...base, tier: 'geo', scanKm: null, trackKm: null })).toBe(1500); // 3km / 2 * 1000
  });
});
