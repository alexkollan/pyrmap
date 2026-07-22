import { haversineDistanceKm } from '@pyrmap/shared';
import regionalUnitsData from './data/greeceRegionalUnits.json' with { type: 'json' };
import settlementsData from './data/greeceSettlements.json' with { type: 'json' };

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

const regionalUnits = regionalUnitsData as RegionalUnit[];
const settlements = settlementsData as Settlement[];

export interface NearestPlace {
  name: string;
  precision: 'settlement' | 'regional_unit';
}

// A satellite pixel this far or closer from a named settlement is reasonably described as "near"
// it; geo-tier pixels are ~3-4km, polar ~375m-1km, so 15km is generous without being meaningless.
const NEARBY_SETTLEMENT_KM = 15;

/**
 * Reverse-geocodes a detection's raw coordinates to a human-readable place name, for
 * notification text — Detection rows carry no place name of their own. Nearest settlement
 * within NEARBY_SETTLEMENT_KM, else nearest regional unit (Greece's 54 regional units fully
 * cover the country, so this always resolves to something in practice).
 */
export function nearestPlace(latitude: number, longitude: number): NearestPlace {
  let bestSettlement: Settlement | null = null;
  let bestSettlementKm = Infinity;
  for (const settlement of settlements) {
    const distance = haversineDistanceKm(latitude, longitude, settlement.lat, settlement.lon);
    if (distance < bestSettlementKm) {
      bestSettlementKm = distance;
      bestSettlement = settlement;
    }
  }
  if (bestSettlement && bestSettlementKm <= NEARBY_SETTLEMENT_KM) {
    return { name: bestSettlement.names[0]!, precision: 'settlement' };
  }

  let bestRegion: RegionalUnit | null = null;
  let bestRegionKm = Infinity;
  for (const region of regionalUnits) {
    const distance = haversineDistanceKm(latitude, longitude, region.lat, region.lon);
    if (distance < bestRegionKm) {
      bestRegionKm = distance;
      bestRegion = region;
    }
  }
  return { name: bestRegion?.nominative ?? bestRegion?.genitives[0] ?? 'Ελλάδα', precision: 'regional_unit' };
}
