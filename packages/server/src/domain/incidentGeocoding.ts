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

/** The gazetteer (GeoNames GR dump, see docs/DECISIONS.md 2026-07-20) stores names in nominative
 * case; posts use accusative ("Ωρωπό") where the gazetteer has nominative ("Ωρωπός"). Trying
 * "+ς" catches the common masculine -ος noun pattern; genuinely irregular declensions (rare)
 * simply won't match and the post is skipped rather than mismapped. */
function settlementCandidates(name: string): Settlement[] {
  const folded = foldAccents(name);
  const direct = settlementsByName.get(folded);
  if (direct) return direct;
  return settlementsByName.get(`${folded}ς`) ?? [];
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
    const best = region
      ? candidates.reduce((a, b) => (distanceKm(region, a) <= distanceKm(region, b) ? a : b))
      : candidates.length === 1
        ? candidates[0]!
        : null;
    if (best) return { latitude: best.lat, longitude: best.lon, precision: 'settlement' };
  }

  // Single-token mentions (e.g. an island name) can themselves be a regional unit.
  const asRegion = region ?? regionByName.get(foldAccents(settlement)) ?? null;
  if (asRegion) return { latitude: asRegion.lat, longitude: asRegion.lon, precision: 'regional_unit' };

  return null;
}
