import { describe, expect, it } from 'vitest';
import { arrowRotationDeg, blowsToward } from './wind.js';

describe('arrowRotationDeg', () => {
  it('points south (180) for a north wind (from 0)', () => {
    expect(arrowRotationDeg(0)).toBe(180);
  });

  it('points north (0) for a south wind (from 180)', () => {
    expect(arrowRotationDeg(180)).toBe(0);
  });

  it('points east (90) for a west wind (from 270)', () => {
    expect(arrowRotationDeg(270)).toBe(90);
  });
});

describe('blowsToward', () => {
  it('a north wind (from 0) blows toward S', () => {
    expect(blowsToward(0)).toBe('S');
  });

  it('a west wind (from 270) blows toward E', () => {
    expect(blowsToward(270)).toBe('E');
  });

  it('a meltemi-style NE wind (from 45) blows toward SW', () => {
    expect(blowsToward(45)).toBe('SW');
  });

  it('rounds to the nearest compass octant', () => {
    expect(blowsToward(200)).toBe('N'); // toward 20deg -> N
  });
});
