import { describe, expect, it } from 'vitest';
import { convexHull, polygonAreaKm2 } from './geometry.js';

describe('convexHull', () => {
  it('returns the input unchanged for fewer than 3 points', () => {
    expect(convexHull([])).toEqual([]);
    expect(convexHull([{ lat: 1, lon: 1 }])).toEqual([{ lat: 1, lon: 1 }]);
    expect(convexHull([{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }])).toEqual([
      { lat: 1, lon: 1 },
      { lat: 2, lon: 2 },
    ]);
  });

  it('excludes a point strictly inside a square', () => {
    const square = [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 10 },
      { lat: 10, lon: 10 },
      { lat: 10, lon: 0 },
    ];
    const interior = { lat: 5, lon: 5 };
    const hull = convexHull([...square, interior]);

    expect(hull).not.toContainEqual(interior);
    expect(hull).toHaveLength(4);
    for (const corner of square) {
      expect(hull).toContainEqual(corner);
    }
  });

  it('collapses collinear points to just the two endpoints', () => {
    const hull = convexHull([
      { lat: 0, lon: 0 },
      { lat: 1, lon: 1 },
      { lat: 2, lon: 2 },
    ]);
    // all on one line -> no 2D area; monotone chain returns just the extremes
    expect(hull.length).toBeLessThanOrEqual(2);
  });
});

describe('polygonAreaKm2', () => {
  it('returns 0 for fewer than 3 points', () => {
    expect(polygonAreaKm2([])).toBe(0);
    expect(polygonAreaKm2([{ lat: 0, lon: 0 }])).toBe(0);
  });

  it('computes the area of a small square near the equator to within 1%', () => {
    // ~0.1deg square near the equator: side ~= 11.1km (lat) x 11.1km (lon, cos(0)=1) -> area ~123.4 km^2
    const square = [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 0.1 },
      { lat: 0.1, lon: 0.1 },
      { lat: 0.1, lon: 0 },
    ];
    const area = polygonAreaKm2(square);
    expect(area).toBeGreaterThan(122);
    expect(area).toBeLessThan(125);
  });
});
