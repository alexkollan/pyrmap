import { describe, expect, it } from 'vitest';
import { boundingBoxAround, haversineDistanceKm } from './geo.js';

describe('haversineDistanceKm', () => {
  it('computes ~300km between Athens and Thessaloniki', () => {
    const athens = { lat: 37.9838, lon: 23.7275 };
    const thessaloniki = { lat: 40.6401, lon: 22.9444 };
    const distance = haversineDistanceKm(athens.lat, athens.lon, thessaloniki.lat, thessaloniki.lon);
    expect(distance).toBeGreaterThanOrEqual(295);
    expect(distance).toBeLessThanOrEqual(305);
  });

  it('returns 0 for identical points', () => {
    expect(haversineDistanceKm(38.0, 24.0, 38.0, 24.0)).toBe(0);
  });
});

describe('boundingBoxAround', () => {
  it('expands symmetrically around the center point', () => {
    const bbox = boundingBoxAround(38.0, 24.0, 0.1);
    expect(bbox).toEqual({ west: 23.9, south: 37.9, east: 24.1, north: 38.1 });
  });
});
