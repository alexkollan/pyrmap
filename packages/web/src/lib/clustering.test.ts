import { describe, expect, it } from 'vitest';
import { clusterByDistance } from './clustering.js';

interface Point {
  id: number;
  latitude: number;
  longitude: number;
}

const pt = (id: number, latitude: number, longitude: number): Point => ({ id, latitude, longitude });

describe('clusterByDistance', () => {
  it('groups points within the threshold into one cluster', () => {
    const a = pt(1, 38.0, 23.0);
    const b = pt(2, 38.001, 23.001); // ~150m away
    const groups = clusterByDistance([a, b], 1);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
  });

  it('keeps far-apart points in separate clusters', () => {
    const a = pt(1, 38.0, 23.0);
    const b = pt(2, 40.0, 22.0); // >100km away
    const groups = clusterByDistance([a, b], 5);
    expect(groups).toHaveLength(2);
  });

  it('transitively merges a chain of points each within threshold of the next', () => {
    // Athens (38.0,23.0) roughly, points staggered ~2km apart, threshold 3km:
    // each pair is close, but A and C are far enough apart alone -- should still merge via B.
    const a = pt(1, 38.0, 23.0);
    const b = pt(2, 38.018, 23.0); // ~2km north of a
    const c = pt(3, 38.036, 23.0); // ~2km north of b, ~4km from a
    const groups = clusterByDistance([a, b, c], 3);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(3);
  });

  it('returns one cluster per point when the list has a single item', () => {
    expect(clusterByDistance([pt(1, 38, 23)], 5)).toEqual([[pt(1, 38, 23)]]);
  });

  it('returns [] for an empty list', () => {
    expect(clusterByDistance([], 5)).toEqual([]);
  });
});
