import type { AlertAreaPolygon, AlertPrecision } from '@pyrmap/shared';
import { findRegionalUnit, geocodeGreekLocation } from './incidentGeocoding.js';
import { findRegionalUnitBoundary } from './regionalUnitBoundaries.js';
import type { GeocodingSource } from '../ports/GeocodingSource.js';
import type { AreaPolygonSource } from '../ports/AreaPolygonSource.js';

export interface AlertGeocodeResult {
  latitude: number;
  longitude: number;
  precision: AlertPrecision;
  areaPolygon: AlertAreaPolygon | null;
}

/**
 * Resolves a 112 alert's parsed area (domain/alert112Parsing.ts) to a point (for the pin) and,
 * best-effort, a boundary polygon (for the map highlight): a named locality's own OSM boundary
 * when one exists, else the containing regional unit's pre-bundled polygon, else no polygon at
 * all (point pin only) if even the regional unit is outside our 54-entry gazetteer. Point
 * resolution reuses the exact same live-Nominatim-then-offline-gazetteer chain incident reports
 * already use — see docs/superpowers/specs/2026-07-23-112-civil-protection-alerts-design.md.
 */
export async function geocodeAlertArea(
  locality: string | null,
  regionGenitive: string,
  geocodingSource: GeocodingSource | undefined,
  polygonSource: AreaPolygonSource | undefined,
): Promise<AlertGeocodeResult | null> {
  if (locality) {
    const query = `${locality} ${regionGenitive}`;
    const geocoded =
      (geocodingSource ? await geocodingSource.geocode(query) : null) ?? geocodeGreekLocation(locality, regionGenitive);

    if (geocoded) {
      const precision: AlertPrecision = geocoded.precision === 'settlement' ? 'locality' : 'regional_unit';
      const localityPolygon = precision === 'locality' && polygonSource ? await polygonSource.findAreaPolygon(query) : null;
      const regionalUnit = findRegionalUnit(regionGenitive);
      const fallbackPolygon = regionalUnit?.nominative ? findRegionalUnitBoundary(regionalUnit.nominative) : null;

      return {
        latitude: geocoded.latitude,
        longitude: geocoded.longitude,
        precision,
        areaPolygon: localityPolygon ?? fallbackPolygon,
      };
    }
  }

  const regionalUnit = findRegionalUnit(regionGenitive);
  if (!regionalUnit) return null;

  return {
    latitude: regionalUnit.lat,
    longitude: regionalUnit.lon,
    precision: 'regional_unit',
    areaPolygon: regionalUnit.nominative ? findRegionalUnitBoundary(regionalUnit.nominative) : null,
  };
}
