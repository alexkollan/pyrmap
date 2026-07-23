import { describe, expect, it } from 'vitest';
import { findRegionalUnit, geocodeGreekLocation } from '../src/domain/incidentGeocoding.js';

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

  it('resolves a masculine genitive "-ου" ending via the "-ος" nominative pattern ("Ωρωπού" -> Ωρωπός)', () => {
    // "του δήμου Ωρωπού" (genitive of a masc. -ος place, Oropos) matched no existing transform:
    // it doesn't end in -ς or -ων, so it fell straight to zero candidates.
    const result = geocodeGreekLocation('Ωρωπού', 'Αττικής');
    expect(result).toEqual({ latitude: 38.3033, longitude: 23.7555, precision: 'settlement' });
  });

  it('resolves a neuter genitive "-ου" ending by stripping to the "-ο" nominative ("Λαυρίου" -> Λαύριο)', () => {
    // "του δήμου Λαυρίου" (genitive of a neuter -ο place, Lavrio) — same missing-transform gap as
    // above, but the correct nominative is reached by dropping the trailing "υ", not by "+ος".
    const result = geocodeGreekLocation('Λαυρίου', 'Αττικής');
    expect(result).toEqual({ latitude: 37.7144, longitude: 24.0565, precision: 'settlement' });
  });

  it('rejoins a split two-word settlement name when the "region" half is not a real region ("Νέα Μάκρη")', () => {
    // extractLocationPhrase splits any multi-word capture on its last word, assuming "settlement
    // region"; when the settlement name is itself two words with nothing following it (e.g. "στη
    // Νέα Μάκρη." with no region), that produces settlement="Νέα", regionGenitive="Μάκρη" — and
    // "Μάκρη" isn't a real region. The whole phrase should be retried as one settlement name.
    const result = geocodeGreekLocation('Νέα', 'Μάκρη');
    expect(result).toEqual({ latitude: 38.0873, longitude: 23.9764, precision: 'settlement' });
  });

  it('rejoins AND declines each word of a genitive compound municipality name ("Αγίου Δημητρίου" -> Άγιος Δημήτριος)', () => {
    // "στο δήμο Αγίου Δημητρίου." (genitive of the compound "Άγιος Δημήτριος") splits to
    // settlement="Αγίου", regionGenitive="Δημητρίου" — neither word is in its nominative form, so
    // the rejoin must decline BOTH words (Αγίου->Άγιος, Δημητρίου->Δημήτριος), not just the
    // phrase's tail, to find the dominant "Άγιος Δημήτριος" (Athens suburb, pop. 71294) among 36
    // national namesakes.
    const result = geocodeGreekLocation('Αγίου', 'Δημητρίου');
    expect(result).toEqual({ latitude: 37.9333, longitude: 23.7333, precision: 'settlement' });
  });

  it('resolves an "-ι" stem genitive ending in "-ίου" by stripping the "-ου" suffix ("Κορωπίου" -> Κορωπί)', () => {
    // "-ι"-ending Greek place names (Κορωπί, Περιστέρι, Χαϊδάρι, Μαρούσι, ...) are an extremely
    // common toponym class, and "του δήμου Κορωπίου" is exactly how the account phrases a
    // municipality reference. Neither the "-ος" nor the plain "-ο" genitive transform recovers
    // "Κορωπί" (they'd try "Κορωπιος"/"Κορωπιο"), so this was falling through to, at best, the
    // coarse regional_unit tier — verified live: previously returned null with no region at all.
    const result = geocodeGreekLocation('Κορωπίου', null);
    expect(result).toEqual({ latitude: 37.8989, longitude: 23.8718, precision: 'settlement' });
  });

  it('does not fall back to a spurious bare-first-word match when a split compound name is genuinely ambiguous', () => {
    // "Άγιος" alone IS a real, unrelated gazetteer entry (pop. 801) — a trap if the code ever
    // fell back to the bare first word after the rejoined phrase fails to resolve. "Άγιος
    // Ιωάννης" (37 namesakes, no dominant one, same shape as "Άγιος Γεώργιος" above) must return
    // null, not the wrong pop.-801 "Άγιος".
    expect(geocodeGreekLocation('Άγιο', 'Ιωάννη')).toBeNull();
  });

  it('resolves the popular name "Κεφαλονιά" for the region the gazetteer only had as "Κεφαλληνία"', () => {
    // Real missed post, 2026-07-22: "...περιοχή Καλλιγάτα Κεφαλονιάς." The gazetteer (built from
    // official ADM2 records) only had the formal name "Κεφαλληνία"/"Κεφαλληνίας" — but the Fire
    // Service, like virtually everyone, calls the island/regional unit "Κεφαλονιά" (or
    // "Κεφαλλονιά", both spellings common). "Καλλιγάτα" itself isn't in the settlements
    // gazetteer at all (a real small-village coverage gap, not fixable in code), so this
    // resolves at regional_unit precision, not settlement — still far better than being dropped.
    const result = geocodeGreekLocation('Καλλιγάτα', 'Κεφαλονιάς');
    expect(result).toEqual({ latitude: 38.25, longitude: 20.5, precision: 'regional_unit' });
  });

  it('peels a trailing broader-area qualifier off a 3-word clause when it is not itself a region ("Βορίζια Ηρακλείου Κρήτης")', () => {
    // Real missed post, 2026-07-22: "...περιοχή Βορίζια Ηρακλείου Κρήτης." extractLocationPhrase's
    // "last word = region" rule captures settlement="Βορίζια Ηρακλείου", regionGenitive="Κρήτης"
    // — but "Κρήτης" (Crete) is a wider periphery, not one of the 54 regional units, so it never
    // resolves. Crete has 4 regional units (Ηράκλειο, Χανιά, Ρέθυμνο, Λασίθι) and posts often
    // name the specific one AND the island for extra disambiguation. "Ηρακλείου" — the real
    // regional unit — got swallowed into the settlement half of the naive split; peeling it back
    // off recovers it. "Βορίζια" itself isn't in the settlements gazetteer, so this resolves at
    // regional_unit precision (Ηράκλειο), not settlement.
    const result = geocodeGreekLocation('Βορίζια Ηρακλείου', 'Κρήτης');
    expect(result).toEqual({ latitude: 35.3297, longitude: 25.1299, precision: 'regional_unit' });
  });
});

describe('findRegionalUnit', () => {
  it('resolves a known regional unit by its genitive form', () => {
    const unit = findRegionalUnit('Θεσσαλονίκης');
    expect(unit).toMatchObject({ nominative: 'Θεσσαλονίκη' });
  });

  it('returns null for a name that matches no regional unit', () => {
    expect(findRegionalUnit('Κυκλάδων')).not.toBeNull(); // Κυκλάδες IS in the 54-unit gazetteer, even though it has no boundary polygon (a separate, later concern)
    expect(findRegionalUnit('Ανύπαρκτης')).toBeNull();
  });
});
