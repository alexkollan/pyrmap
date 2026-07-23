import { describe, expect, it } from 'vitest';
import { geocodeAlertArea } from '../src/domain/alert112Geocoding.js';
import type { GeocodingSource } from '../src/ports/GeocodingSource.js';
import type { AreaPolygonSource } from '../src/ports/AreaPolygonSource.js';

const FAKE_POLYGON = { type: 'Polygon' as const, coordinates: [[[23.0, 38.0], [23.1, 38.0], [23.1, 38.1], [23.0, 38.0]]] };

describe('geocodeAlertArea', () => {
  it('resolves locality + region via the offline gazetteer when no geocodingSource is given, with a locality polygon', async () => {
    const polygonSource: AreaPolygonSource = { findAreaPolygon: async () => FAKE_POLYGON };
    const result = await geocodeAlertArea('Κορωπί', 'Αττικής', undefined, polygonSource);
    expect(result).toMatchObject({ precision: 'locality', areaPolygon: FAKE_POLYGON });
  });

  it('falls back to the regional unit polygon when the locality has no polygon of its own', async () => {
    const polygonSource: AreaPolygonSource = { findAreaPolygon: async () => null };
    const result = await geocodeAlertArea('Δερβένι', 'Θεσσαλονίκης', undefined, polygonSource);
    expect(result!.precision).toBe('locality');
    expect(result!.areaPolygon).not.toBeNull(); // Θεσσαλονίκης's bundled regional-unit polygon
  });

  it('prefers a configured geocodingSource result over the offline gazetteer', async () => {
    const geocodingSource: GeocodingSource = { geocode: async () => ({ latitude: 1.1, longitude: 2.2, precision: 'settlement' }) };
    const result = await geocodeAlertArea('Κορωπί', 'Αττικής', geocodingSource, undefined);
    expect(result).toMatchObject({ latitude: 1.1, longitude: 2.2, precision: 'locality' });
  });

  it('resolves region-only (no locality named) directly to the regional unit, with its bundled polygon', async () => {
    const result = await geocodeAlertArea(null, 'Θεσσαλονίκης', undefined, undefined);
    expect(result!.precision).toBe('regional_unit');
    expect(result!.areaPolygon).not.toBeNull();
  });

  it('returns null when neither the locality nor the region resolves to anything', async () => {
    const geocodingSource: GeocodingSource = { geocode: async () => null };
    const result = await geocodeAlertArea('Ανύπαρκτο Χωριό', 'Ανύπαρκτης', geocodingSource, undefined);
    expect(result).toBeNull();
  });

  it('returns null for a region-only post whose region is not in the 54-unit gazetteer', async () => {
    expect(await geocodeAlertArea(null, 'Ανύπαρκτης', undefined, undefined)).toBeNull();
  });

  it('never calls polygonSource when precision comes out regional_unit from the locality branch', async () => {
    let called = false;
    const polygonSource: AreaPolygonSource = {
      findAreaPolygon: async () => {
        called = true;
        return FAKE_POLYGON;
      },
    };
    // A locality name that only resolves as a region itself (rare, mirrors geocodeGreekLocation's
    // own "single-token mention can itself be a regional unit" branch, since "Ημαθία" has no
    // entry in the settlements gazetteer) — precision is regional_unit, so the locality-polygon
    // lookup must be skipped.
    await geocodeAlertArea('Ημαθίας', 'Ημαθίας', undefined, polygonSource);
    expect(called).toBe(false);
  });
});
