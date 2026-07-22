import { describe, expect, it } from 'vitest';
import { isWithinGreece } from '../src/domain/greeceBoundary.js';

describe('isWithinGreece', () => {
  it('accepts Greek islands within a few km of the Turkish coast', () => {
    expect(isWithinGreece(36.1487, 29.5883)).toBe(true); // Kastellorizo town
    expect(isWithinGreece(37.7561, 26.9757)).toBe(true); // Samos, Vathy
    expect(isWithinGreece(38.3656, 26.1358)).toBe(true); // Chios town
    expect(isWithinGreece(39.108, 26.5541)).toBe(true); // Lesbos, Mytilene
    expect(isWithinGreece(36.4341, 28.2176)).toBe(true); // Rhodes town
    expect(isWithinGreece(36.893, 27.2879)).toBe(true); // Kos town
  });

  it('rejects the nearest Turkish town across the strait from each island above', () => {
    expect(isWithinGreece(36.1963, 29.6394)).toBe(false); // Kaş, TR (across from Kastellorizo)
    expect(isWithinGreece(37.8582, 27.2611)).toBe(false); // Kuşadası, TR (across from Samos)
    expect(isWithinGreece(38.3244, 26.3033)).toBe(false); // Çeşme, TR (across from Chios)
    expect(isWithinGreece(39.3178, 26.689)).toBe(false); // Ayvalık, TR (across from Lesbos)
    expect(isWithinGreece(36.6217, 29.1164)).toBe(false); // Fethiye, TR (near Rhodes)
    expect(isWithinGreece(37.0344, 27.4305)).toBe(false); // Bodrum, TR (across from Kos)
  });

  it('accepts mainland Greek cities and rejects mainland Turkish cities', () => {
    expect(isWithinGreece(37.9838, 23.7275)).toBe(true); // Athens
    expect(isWithinGreece(40.6401, 22.9444)).toBe(true); // Thessaloniki
    expect(isWithinGreece(38.4237, 27.1428)).toBe(false); // Izmir, TR
  });

  it('rejects a point far out at sea, well outside any polygon part', () => {
    expect(isWithinGreece(34.0, 25.0)).toBe(false);
  });
});
