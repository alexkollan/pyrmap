import { describe, expect, it } from 'vitest';
import { nearestPlace } from '../src/domain/reverseGeocoding.js';

describe('nearestPlace', () => {
  it('resolves settlement precision when a detection is close to a real place', () => {
    // Exact coordinates of Λαύριο in the gazetteer (pop. 7078) — distance 0, unambiguous.
    expect(nearestPlace(37.7144, 24.0565)).toEqual({ name: 'Λαύριο', precision: 'settlement' });
  });

  it('falls back to regional-unit precision when nothing is nearby (open sea)', () => {
    // South Aegean, ~51km from the nearest settlement (Κλησίδι) — too far to call "near" it.
    // Nearest regional unit is Λασίθι at these coordinates (verified against the gazetteer).
    expect(nearestPlace(35.9, 25.9)).toEqual({ name: 'Λασίθι', precision: 'regional_unit' });
  });
});
