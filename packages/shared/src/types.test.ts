import { describe, expect, it } from 'vitest';
import type { CivilProtectionAlert, GeoJsonPolygon } from './types.js';
import { ALERT_112_SOURCE_ID } from './constants.js';

describe('CivilProtectionAlert shape', () => {
  it('accepts a value with a null area polygon (point-only pin)', () => {
    const alert: CivilProtectionAlert = {
      id: 1,
      source: ALERT_112_SOURCE_ID,
      text: 't',
      url: 'u',
      publishedAt: '2026-07-23T00:00:00Z',
      latitude: 38.0,
      longitude: 23.0,
      precision: 'locality',
      areaPolygon: null,
    };
    expect(alert.areaPolygon).toBeNull();
  });

  it('accepts a value with a real Polygon area', () => {
    const polygon: GeoJsonPolygon = { type: 'Polygon', coordinates: [[[23.0, 38.0], [23.1, 38.0], [23.1, 38.1], [23.0, 38.0]]] };
    const alert: CivilProtectionAlert = {
      id: 2,
      source: ALERT_112_SOURCE_ID,
      text: 't',
      url: 'u',
      publishedAt: '2026-07-23T00:00:00Z',
      latitude: 38.05,
      longitude: 23.05,
      precision: 'locality',
      areaPolygon: polygon,
    };
    expect(alert.areaPolygon?.type).toBe('Polygon');
  });
});
