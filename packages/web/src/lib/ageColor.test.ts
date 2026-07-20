import { describe, expect, it } from 'vitest';
import { ageToColor, hoursSince } from './ageColor.js';

describe('ageToColor', () => {
  it('is exactly red at age 0', () => {
    expect(ageToColor(0, 24)).toBe('rgb(220, 38, 38)');
  });

  it('is exactly grey at the max age', () => {
    expect(ageToColor(24, 24)).toBe('rgb(107, 114, 128)');
  });

  it('is exactly green at the midpoint, matching "12h ago should be in the middle"', () => {
    expect(ageToColor(12, 24)).toBe('rgb(34, 197, 94)');
  });

  it('is exactly orange and blue at the quarter and three-quarter marks', () => {
    expect(ageToColor(6, 24)).toBe('rgb(249, 115, 22)');
    expect(ageToColor(18, 24)).toBe('rgb(59, 130, 246)');
  });

  it('interpolates between two stops rather than jumping', () => {
    const quarterWay = ageToColor(3, 24); // halfway between red and orange
    expect(quarterWay).toBe('rgb(235, 77, 30)');
  });

  it('clamps beyond the max age to grey, not extrapolated', () => {
    expect(ageToColor(48, 24)).toBe(ageToColor(24, 24));
  });

  it('clamps negative ages (clock skew) to red, not extrapolated', () => {
    expect(ageToColor(-5, 24)).toBe(ageToColor(0, 24));
  });

  it('the same gradient works on a compressed scale (e.g. 12h for incident reports)', () => {
    expect(ageToColor(6, 12)).toBe('rgb(34, 197, 94)'); // halfway through 12h = midpoint = green
    expect(ageToColor(12, 12)).toBe('rgb(107, 114, 128)');
  });
});

describe('hoursSince', () => {
  it('computes elapsed hours against an injected reference time', () => {
    expect(hoursSince('2026-07-20T00:00:00Z', new Date('2026-07-20T12:00:00Z'))).toBeCloseTo(12);
    expect(hoursSince('2026-07-20T12:00:00Z', new Date('2026-07-20T12:00:00Z'))).toBe(0);
  });
});
