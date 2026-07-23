import { describe, expect, it, vi } from 'vitest';
import type { LocationSearchResult } from '@pyrmap/shared';
import { NominatimClient } from '../src/adapters/nominatim/NominatimClient.js';

// Real response shape for "Βορίζια Ηρακλείου Κρήτης", live-verified 2026-07-22 — see docs/DECISIONS.md.
const REAL_VILLAGE_RESULT = [
  {
    place_id: 54980366,
    lat: '35.1502871',
    lon: '24.8470873',
    addresstype: 'village',
    name: 'Βορίζια',
    display_name: 'Βορίζια',
  },
];

// Real response shape for "Κρήτη" alone, live-verified 2026-07-22 — islands are region-tier, not
// one of the 54 regional units, but still a legitimate place to pin at regional_unit precision.
const REAL_ISLAND_RESULT = [
  {
    place_id: 54865671,
    lat: '35.3084952',
    lon: '24.4633423',
    addresstype: 'island',
    name: 'Κρήτη',
  },
];

// Real response shape for "Νάουσας" alone, live-verified 2026-07-22: the top 4 matches are all
// roads named after the town in unrelated suburbs (280km from the real one); the actual
// municipality is 5th. This is the exact bug this test guards against — accepting whichever
// result comes first regardless of type would pin the wrong location on the map.
const REAL_ROADS_THEN_MUNICIPALITY_RESULT = [
  { place_id: 1, lat: '38.0902891', lon: '23.7067253', addresstype: 'road', name: 'Νάουσας' },
  { place_id: 2, lat: '38.0146898', lon: '23.8657785', addresstype: 'road', name: 'Νάουσας' },
  { place_id: 3, lat: '35.3135850', lon: '25.1445424', addresstype: 'road', name: 'Νάουσας' },
  { place_id: 4, lat: '40.7988832', lon: '22.0513175', addresstype: 'road', name: 'Νάουσας' },
  {
    place_id: 5,
    lat: '40.6181235',
    lon: '22.0389250',
    addresstype: 'municipality',
    name: 'Δήμος Ηρωικής Πόλεως Νάουσας',
  },
];

// Real response shape for "Αττική" alone, live-verified 2026-07-22: a railway station, a
// neighbourhood, and a peninsula all share the name — none of which is the actual region, and
// none of which is a type this client trusts. Must return null, not a wrong coordinate.
const REAL_ALL_UNTRUSTED_RESULT = [
  { place_id: 1, lat: '37.9995238', lon: '23.7228379', addresstype: 'railway', name: 'Αττική', display_name: 'Αττική' },
  { place_id: 2, lat: '37.9960777', lon: '23.7224191', addresstype: 'neighbourhood', name: 'Αττική', display_name: 'Αττική' },
  { place_id: 3, lat: '37.9946543', lon: '23.7994025', addresstype: 'peninsula', name: 'Αττική', display_name: 'Αττική' },
];

function fakeFetch(body: unknown, status = 200): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe('NominatimClient', () => {
  it('resolves a village-level match to settlement precision', async () => {
    const client = new NominatimClient(fakeFetch(REAL_VILLAGE_RESULT));
    const result = await client.geocode('Βορίζια Ηρακλείου Κρήτης');
    expect(result).toEqual({ latitude: 35.1502871, longitude: 24.8470873, precision: 'settlement' });
  });

  it('resolves an island-level match to regional_unit precision', async () => {
    const client = new NominatimClient(fakeFetch(REAL_ISLAND_RESULT));
    const result = await client.geocode('Κρήτη');
    expect(result).toEqual({ latitude: 35.3084952, longitude: 24.4633423, precision: 'regional_unit' });
  });

  it('skips untrusted-type matches (roads, shops, railways, ...) ranked ahead of the real place', async () => {
    // Real live bug, 2026-07-22: a bare "Νάουσας" query's top 4 results are all roads named after
    // the town in unrelated suburbs; the actual municipality is only the 5th result. Accepting
    // the first result regardless of type would have pinned a location 280km from the real town.
    const client = new NominatimClient(fakeFetch(REAL_ROADS_THEN_MUNICIPALITY_RESULT));
    const result = await client.geocode('Νάουσας');
    expect(result).toEqual({ latitude: 40.6181235, longitude: 22.0389250, precision: 'settlement' });
  });

  it('returns null when every returned match is an untrusted type', async () => {
    // Real live bug, 2026-07-22: a bare "Αττική" query returns only a railway station, a
    // neighbourhood, and a peninsula sharing the name — none of them the actual region.
    const client = new NominatimClient(fakeFetch(REAL_ALL_UNTRUSTED_RESULT));
    expect(await client.geocode('Αττική')).toBeNull();
  });

  it('returns null when Nominatim finds nothing at all', async () => {
    const client = new NominatimClient(fakeFetch([]));
    expect(await client.geocode('Καλλιγάτα Κεφαλονιάς')).toBeNull();
  });

  it('returns null (never throws) on a non-2xx response', async () => {
    const client = new NominatimClient(fakeFetch({}, 503));
    expect(await client.geocode('anything')).toBeNull();
  });

  it('returns null (never throws) on a network error', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const client = new NominatimClient(fetchImpl);
    expect(await client.geocode('anything')).toBeNull();
  });

  it('sends the Nominatim-required User-Agent, format, country restriction, and a wide-enough result count to filter past untrusted types', async () => {
    const fetchImpl = fakeFetch(REAL_VILLAGE_RESULT);
    const client = new NominatimClient(fetchImpl);
    await client.geocode('Βορίζια Ηρακλείου Κρήτης');

    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit?][];
    const [url, init] = calls[0]!;
    expect((init?.headers as Record<string, string>)['User-Agent']).toBe('PyrMap (https://pyrmap.alexcoll.in)');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('format')).toBe('jsonv2');
    expect(parsed.searchParams.get('countrycodes')).toBe('gr');
    expect(parsed.searchParams.get('limit')).toBe('5');
    expect(parsed.searchParams.get('q')).toBe('Βορίζια Ηρακλείου Κρήτης');
  });

  it('spaces consecutive calls at least ~1.1s apart to respect the 1 req/sec usage policy', async () => {
    let currentTime = 1_700_000_000_000; // realistic epoch-ms scale, so lastCallAt=0 never triggers a wait on the first call
    const now = vi.fn(() => currentTime);
    const sleep = vi.fn(async () => undefined);
    const client = new NominatimClient(fakeFetch(REAL_VILLAGE_RESULT), now, sleep);

    await client.geocode('a');
    expect(sleep).not.toHaveBeenCalled();

    currentTime += 50; // only 50ms later, well under the 1100ms minimum spacing
    await client.geocode('b');
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep.mock.calls[0]![0]).toBeGreaterThan(1000);
  });
});

describe('NominatimClient.search', () => {
  it('returns every result unfiltered by addresstype, unlike geocode()', async () => {
    // Same fixture geocode() rejects entirely (all untrusted types) — search() must still surface them,
    // since a human is choosing, not an automated pipeline.
    const client = new NominatimClient(fakeFetch(REAL_ALL_UNTRUSTED_RESULT));
    const results = await client.search('Αττική');
    expect(results).toEqual<LocationSearchResult[]>([
      { displayName: 'Αττική', latitude: 37.9995238, longitude: 23.7228379 },
      { displayName: 'Αττική', latitude: 37.9960777, longitude: 23.7224191 },
      { displayName: 'Αττική', latitude: 37.9946543, longitude: 23.7994025 },
    ]);
  });

  it('returns an empty array when Nominatim finds nothing', async () => {
    const client = new NominatimClient(fakeFetch([]));
    expect(await client.search('nonexistent')).toEqual([]);
  });

  it('returns an empty array (never throws) on a non-2xx response or network error', async () => {
    const client = new NominatimClient(fakeFetch({}, 503));
    expect(await client.search('anything')).toEqual([]);

    const throwing = new NominatimClient(
      vi.fn(async () => {
        throw new Error('network down');
      }) as unknown as typeof fetch,
    );
    expect(await throwing.search('anything')).toEqual([]);
  });

  it('shares the same request throttle as geocode()', async () => {
    let currentTime = 1_700_000_000_000;
    const now = vi.fn(() => currentTime);
    const sleep = vi.fn(async () => undefined);
    const client = new NominatimClient(fakeFetch(REAL_VILLAGE_RESULT), now, sleep);

    await client.geocode('a');
    currentTime += 50;
    await client.search('b');
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep.mock.calls[0]![0]).toBeGreaterThan(1000);
  });
});

describe('NominatimClient.findAreaPolygon', () => {
  it('returns a Polygon from a trusted-type result that has real boundary geometry', async () => {
    const results = [
      {
        lat: '40.64',
        lon: '22.94',
        addresstype: 'county',
        display_name: 'Περιφερειακή Ενότητα Θεσσαλονίκης',
        geojson: { type: 'Polygon', coordinates: [[[22.9, 40.6], [23.0, 40.6], [23.0, 40.7], [22.9, 40.6]]] },
      },
    ];
    const client = new NominatimClient(fakeFetch(results));
    const polygon = await client.findAreaPolygon('Περιφερειακή Ενότητα Θεσσαλονίκης');
    expect(polygon).toEqual({ type: 'Polygon', coordinates: [[[22.9, 40.6], [23.0, 40.6], [23.0, 40.7], [22.9, 40.6]]] });
  });

  it('returns null when the trusted-type result has no geojson (a point node, not a way/relation)', async () => {
    const results = [{ lat: '40.64', lon: '22.94', addresstype: 'city', geojson: { type: 'Point', coordinates: [22.94, 40.64] } }];
    const client = new NominatimClient(fakeFetch(results));
    expect(await client.findAreaPolygon('somewhere')).toBeNull();
  });

  it('skips an untrusted addresstype (e.g. a road) even if it has a geometry', async () => {
    const results = [
      { lat: '40.64', lon: '22.94', addresstype: 'road', geojson: { type: 'LineString', coordinates: [[22.9, 40.6], [23.0, 40.6]] } },
    ];
    const client = new NominatimClient(fakeFetch(results));
    expect(await client.findAreaPolygon('somewhere')).toBeNull();
  });

  it('returns null when Nominatim finds nothing or the request fails', async () => {
    expect(await new NominatimClient(fakeFetch([])).findAreaPolygon('x')).toBeNull();
    expect(await new NominatimClient(fakeFetch({}, 503)).findAreaPolygon('x')).toBeNull();
  });

  it('requests polygon_geojson=1 without changing what geocode() itself requests', async () => {
    const fetchImpl = fakeFetch([]);
    const client = new NominatimClient(fetchImpl);

    await client.geocode('x');
    await client.findAreaPolygon('y');

    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit?][];
    expect(new URL(calls[0]![0] as string).searchParams.get('polygon_geojson')).toBeNull();
    expect(new URL(calls[1]![0] as string).searchParams.get('polygon_geojson')).toBe('1');
  });
});
