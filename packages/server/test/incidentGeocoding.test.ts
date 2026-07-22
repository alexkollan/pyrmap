import { describe, expect, it } from 'vitest';
import { geocodeGreekLocation } from '../src/domain/incidentGeocoding.js';

describe('geocodeGreekLocation', () => {
  it('resolves an unambiguous settlement + region pair to settlement precision', () => {
    const result = geocodeGreekLocation('Κορωπί', 'Αττικής');
    expect(result).toEqual({ latitude: 37.8989, longitude: 23.8718, precision: 'settlement' });
  });

  it('disambiguates same-named settlements by population within the region, not raw distance to a crude region reference point', () => {
    // Real live bug, 2026-07-20: "Πέραμα" exists 7x in Greece. Two are in the Attica area — the
    // real port town near Piraeus (pop. 25,389) and an unpopulated GeoNames entry (pop. 0) that
    // happened to sit closer to Attica's stored reference point. Nearest-distance picked the
    // empty one; population correctly picks the real town instead.
    const result = geocodeGreekLocation('Πέραμα', 'Αττικής');
    expect(result).toEqual({ latitude: 37.9678, longitude: 23.5721, precision: 'settlement' });
  });

  it('expands the "Ν." (Νέα) abbreviation and strips a genitive "-ς" to match a compound settlement name', () => {
    // Real live bug, 2026-07-20: "Ν. Σμύρνης" (Nea Smyrni, genitive, abbreviated) fell through to
    // the coarse regional_unit fallback because it matched neither "Ν. Σμύρνης" nor "Ν. Σμύρνηςς"
    // (the old blind "+ς" fallback) against the gazetteer's "Νέα Σμύρνη". Nea Smyrni is a major
    // Athens municipality (pop. 73,076) that should always resolve at settlement precision.
    const result = geocodeGreekLocation('Ν. Σμύρνης', 'Αττικής');
    expect(result).toEqual({ latitude: 37.945, longitude: 23.7142, precision: 'settlement' });
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
    // "Άγιος Γεώργιος" (Saint George) exists 61x across Greece; the top two by population
    // (3853, 2045) are comparably sized — no dominant candidate, so this must stay null rather
    // than guess the single biggest of 61 similarly-sized villages nationwide.
    expect(geocodeGreekLocation('Άγιος Γεώργιος', null)).toBeNull();
  });

  it('picks the dominant candidate when a settlement name is nationally ambiguous but one place clearly outweighs the rest', () => {
    // Real missed post, 2026-07-22: "...στο δήμο Νάουσας." with no region word. Three places are
    // named Νάουσα nationally (Imathia, pop. 19887; two on Paros, pop. 3134 and 0) — 19887 dwarfs
    // the other two combined (3134), so unlike the "Άγιος Γεώργιος" case above this should resolve.
    const result = geocodeGreekLocation('Νάουσας', null);
    expect(result).toEqual({ latitude: 40.6294, longitude: 22.0681, precision: 'settlement' });
  });

  it('resolves a genitive-plural municipality name via the "-ών" -> "-ές" declension pattern', () => {
    // Real missed post, 2026-07-22: "...στο δήμο Αχαρνών." Greek municipality names that are
    // plural "-ές" nouns (Αχαρνές = Menidi, Attica, pop. 99346) take genitive "-ών"; the previous
    // declension transforms (only "+ς" and trailing "-ς" strip) never matched it, so it always
    // fell through to zero candidates even though the settlement is in the gazetteer.
    const result = geocodeGreekLocation('Αχαρνών', null);
    expect(result).toEqual({ latitude: 38.0833, longitude: 23.7333, precision: 'settlement' });
  });
});
