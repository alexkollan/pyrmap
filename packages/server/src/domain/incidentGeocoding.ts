import regionalUnitsData from './data/greeceRegionalUnits.json' with { type: 'json' };
import settlementsData from './data/greeceSettlements.json' with { type: 'json' };
import type { IncidentPrecision } from '@pyrmap/shared';

interface RegionalUnit {
  nominative: string | null;
  genitives: string[];
  lat: number;
  lon: number;
}

interface Settlement {
  names: string[];
  lat: number;
  lon: number;
  population: number;
}

export interface GeocodedLocation {
  latitude: number;
  longitude: number;
  precision: IncidentPrecision;
}

const regionalUnits = regionalUnitsData as RegionalUnit[];
const settlements = settlementsData as Settlement[];

// Greek toponyms commonly have more than one accepted stress-accent placement (e.g. "Εύβοιας" vs
// "Ευβοίας" — both mean "of Evia"). Matching on the accent-stripped form absorbs that variation
// instead of requiring every spelling to be enumerated by hand; NFD + stripping combining marks
// (U+0300-U+036F) removes Greek diacritics without touching the base letters.
function foldAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/gu, '');
}

// Keyed by every genitive AND nominative spelling, since posts occasionally use either.
const regionByName = new Map<string, RegionalUnit>();
for (const unit of regionalUnits) {
  for (const genitive of unit.genitives) regionByName.set(foldAccents(genitive), unit);
  if (unit.nominative) regionByName.set(foldAccents(unit.nominative), unit);
}

const settlementsByName = new Map<string, Settlement[]>();
for (const settlement of settlements) {
  for (const name of settlement.names) {
    const key = foldAccents(name);
    const existing = settlementsByName.get(key);
    if (existing) existing.push(settlement);
    else settlementsByName.set(key, [settlement]);
  }
}

function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// "Ν." is the standard abbreviation for "Νέα" (New) in compound place names (Ν. Σμύρνη, Ν. Ιωνία,
// Ν. Μάκρη, ...) — all overwhelmingly feminine, so "Νέα" (not "Νέος"/"Νέο") is the safe expansion.
// Only handling the one form actually seen in real posts (2026-07-20, see docs/DECISIONS.md) —
// add more here only once observed for real, not speculatively.
const ABBREVIATION_RE = /^Ν\.\s+/u;

/** The gazetteer (GeoNames GR dump, see docs/DECISIONS.md 2026-07-20) stores names in nominative
 * case, undeclined; posts write them in whatever case the sentence needs. Tries, in order: as
 * written; with the common "Ν." -> "Νέα" abbreviation expanded; "+ς" for the masculine -ος
 * accusative pattern ("Ωρωπό" -> "Ωρωπός"); "-ς" stripped for the feminine/consonant-stem
 * genitive pattern ("Σμύρνης" -> "Σμύρνη") — each tried against both the as-written and the
 * abbreviation-expanded form. Genuinely irregular declensions (rare) simply won't match and the
 * post is skipped rather than mismapped. */
function settlementCandidates(name: string): Settlement[] {
  const expanded = ABBREVIATION_RE.test(name) ? name.replace(ABBREVIATION_RE, 'Νέα ') : null;

  for (const base of expanded ? [name, expanded] : [name]) {
    const folded = foldAccents(base);
    const variants = [folded, `${folded}ς`, folded.endsWith('ς') ? folded.slice(0, -1) : null];
    for (const variant of variants) {
      if (!variant) continue;
      const match = settlementsByName.get(variant);
      if (match) return match;
    }
  }
  return [];
}

// How far a settlement candidate may sit from its region's (crude) reference point and still
// count as "in the right area" — generous, since these reference points aren't true geometric
// centroids (see the population-priority comment below for why that matters).
const REGION_PLAUSIBLE_KM = 80;

/**
 * Among same-named settlement candidates, prefer the most populous one within a plausible
 * distance of the region, not merely the nearest. A real, live miss: two places are both named
 * "Πέραμα" — the real port town near Piraeus (population 25,389) and an unpopulated GeoNames
 * entry (population 0) — and the unpopulated one happened to sit closer to Attica's stored
 * reference point, which is a single crude coordinate for the whole (large, irregular) region,
 * not a true centroid. Distance-to-a-bad-reference-point is not a reliable disambiguator;
 * "which of these is actually a place people mean" mostly is. Falls back to all candidates if
 * none are within range, rather than guessing outside the region entirely.
 */
function pickBestInRegion(candidates: Settlement[], region: { lat: number; lon: number }): Settlement {
  const nearby = candidates.filter((c) => distanceKm(region, c) <= REGION_PLAUSIBLE_KM);
  const pool = nearby.length > 0 ? nearby : candidates;
  return pool.reduce((best, candidate) => (candidate.population > best.population ? candidate : best));
}

/**
 * Resolves a Greek place-name pair (settlement, region-in-genitive-case) to coordinates.
 * Tiered, never guesses: settlement matched near the right region -> settlement precision;
 * only the region resolves -> its centroid, coarser; neither resolves -> null (skip the post).
 */
export function geocodeGreekLocation(settlement: string, regionGenitive: string | null): GeocodedLocation | null {
  const region = regionGenitive ? (regionByName.get(foldAccents(regionGenitive)) ?? null) : null;

  const candidates = settlementCandidates(settlement);
  if (candidates.length > 0) {
    const best = region ? pickBestInRegion(candidates, region) : candidates.length === 1 ? candidates[0]! : null;
    if (best) return { latitude: best.lat, longitude: best.lon, precision: 'settlement' };
  }

  // Single-token mentions (e.g. an island name) can themselves be a regional unit.
  const asRegion = region ?? regionByName.get(foldAccents(settlement)) ?? null;
  if (asRegion) return { latitude: asRegion.lat, longitude: asRegion.lon, precision: 'regional_unit' };

  return null;
}
