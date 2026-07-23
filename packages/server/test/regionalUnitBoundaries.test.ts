import { describe, expect, it } from 'vitest';
import { findRegionalUnitBoundary } from '../src/domain/regionalUnitBoundaries.js';

describe('findRegionalUnitBoundary', () => {
  it('returns a real polygon for a resolved regional unit', () => {
    const polygon = findRegionalUnitBoundary('Θεσσαλονίκη');
    expect(polygon).not.toBeNull();
    expect(['Polygon', 'MultiPolygon']).toContain(polygon!.type);
    expect(polygon!.coordinates.length).toBeGreaterThan(0);
  });

  it('returns null for a documented gap (periphery-level grouping, not a single regional unit)', () => {
    expect(findRegionalUnitBoundary('Κυκλάδες')).toBeNull();
  });

  it('returns null for an unknown name', () => {
    expect(findRegionalUnitBoundary('Not A Real Unit')).toBeNull();
  });
});
