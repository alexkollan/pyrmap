import { describe, expect, it } from 'vitest';
import { geocodeGreekLocation } from '../src/domain/incidentGeocoding.js';

describe('geocodeGreekLocation', () => {
  it('resolves an unambiguous settlement + region pair to settlement precision', () => {
    const result = geocodeGreekLocation('Κορωπί', 'Αττικής');
    expect(result).toEqual({ latitude: 37.8989, longitude: 23.8718, precision: 'settlement' });
  });

  it('disambiguates a settlement name that exists in multiple places by proximity to the region', () => {
    // "Πέραμα" exists 7x in Greece; only one is in Attica.
    const result = geocodeGreekLocation('Πέραμα', 'Αττικής');
    expect(result?.precision).toBe('settlement');
    expect(result?.latitude).toBeCloseTo(37.99, 1);
  });

  it('falls back to the accusative-case "+ς" candidate when the gazetteer only has the nominative', () => {
    // Tweets say "στον Ωρωπό" (accusative); the gazetteer has "Ωρωπός" (nominative).
    const result = geocodeGreekLocation('Ωρωπό', 'Αττικής');
    expect(result?.precision).toBe('settlement');
  });

  it('is accent-insensitive on the region name (Greek toponyms have more than one accepted stress placement)', () => {
    // Gazetteer stores "Εύβοιας"; the account writes "Ευβοίας".
    const result = geocodeGreekLocation('Μηλάκι', 'Ευβοίας');
    expect(result).toEqual({ latitude: 38.5, longitude: 24, precision: 'regional_unit' });
  });

  it('falls back to regional-unit precision when the settlement is not in the gazetteer', () => {
    // "Βοΐου" is a municipality name, not a populated place — only the region resolves.
    const result = geocodeGreekLocation('Βοΐου', 'Κοζάνης');
    expect(result).toEqual({ latitude: 40.3333, longitude: 21.7167, precision: 'regional_unit' });
  });

  it('resolves a single-token island name with no region as a settlement', () => {
    const result = geocodeGreekLocation('Ρόδος', null);
    expect(result?.precision).toBe('settlement');
  });

  it('returns null rather than guessing when neither settlement nor region resolve', () => {
    expect(geocodeGreekLocation('Ανύπαρκτοχώρι', 'Ανύπαρκτονομού')).toBeNull();
  });

  it('returns null for an ambiguous settlement with no region to disambiguate it', () => {
    // "Άγιος Γεώργιος" (Saint George) exists dozens of times across Greece.
    expect(geocodeGreekLocation('Άγιος Γεώργιος', null)).toBeNull();
  });
});
