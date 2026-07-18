import { useMemo } from 'react';
import { MapContainer, TileLayer, WMSTileLayer } from 'react-leaflet';
import type { Detection, GeoDetection } from '@pyrmap/shared';
import { GeoMarker, PolarMarker } from './FireMarker.js';
import { FireClusterShape } from './FireClusterShape.js';
import { WindLayer } from './WindLayer.js';
import type { Theme } from '../lib/theme.js';
import type { ViewMode } from '../lib/viewMode.js';
import type { LayerPrefs } from '../lib/layerPrefs.js';
import { buildFireClusters } from '../lib/fireClusters.js';

const GREECE_CENTER: [number, number] = [38.5, 24.0];
const INITIAL_ZOOM = 7;

const OSM_ATTRIBUTION = '&copy; OpenStreetMap contributors';
const CARTO_ATTRIBUTION =
  '&copy; OpenStreetMap contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

const TILE_LAYERS: Record<Theme, { url: string; attribution: string }> = {
  light: { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: OSM_ATTRIBUTION },
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: CARTO_ATTRIBUTION,
  },
};

// EFFIS WMS (Copernicus/JRC). Layer names verified against GetCapabilities 2026-07-18:
// all.hs = MODIS+VIIRS hotspots as EFFIS processes them; effis.nrt.ba.poly = current-season burnt areas.
const EFFIS_WMS_URL = 'https://maps.effis.emergency.copernicus.eu/effis';
const EFFIS_ATTRIBUTION = '&copy; <a href="https://forest-fire.emergency.copernicus.eu/">EFFIS</a>';

export interface FireMapProps {
  polar: Detection[];
  geo: GeoDetection[];
  theme: Theme;
  viewMode: ViewMode;
  prefs: LayerPrefs;
}

export function FireMap({ polar, geo, theme, viewMode, prefs }: FireMapProps): JSX.Element {
  const tileLayer = TILE_LAYERS[theme];

  const visiblePolar = useMemo(
    () => polar.filter((d) => !prefs.hiddenSources.includes(d.source)),
    [polar, prefs.hiddenSources],
  );
  const visibleGeo = useMemo(
    () => geo.filter((d) => !prefs.hiddenSources.includes(d.source)),
    [geo, prefs.hiddenSources],
  );

  const clusters = useMemo(
    () => buildFireClusters(visiblePolar, visibleGeo, prefs.clusterKm),
    [visiblePolar, visibleGeo, prefs.clusterKm],
  );

  return (
    <MapContainer center={GREECE_CENTER} zoom={INITIAL_ZOOM} className="fire-map">
      <TileLayer key={theme} url={tileLayer.url} attribution={tileLayer.attribution} />

      {prefs.effisBurntAreas && (
        <WMSTileLayer
          url={EFFIS_WMS_URL}
          params={{ layers: 'effis.nrt.ba.poly', format: 'image/png', transparent: true }}
          attribution={EFFIS_ATTRIBUTION}
          opacity={0.7}
        />
      )}
      {prefs.effisHotspots && (
        <WMSTileLayer
          url={EFFIS_WMS_URL}
          params={{ layers: 'all.hs', format: 'image/png', transparent: true }}
          attribution={EFFIS_ATTRIBUTION}
          opacity={0.8}
        />
      )}

      {viewMode === 'points' ? (
        <>
          {visiblePolar.map((detection) => (
            <PolarMarker key={detection.id} detection={detection} />
          ))}
          {visibleGeo.map((detection) => (
            <GeoMarker key={detection.id} detection={detection} />
          ))}
        </>
      ) : (
        clusters.map((cluster) => <FireClusterShape key={cluster.id} cluster={cluster} />)
      )}

      {prefs.wind && <WindLayer clusters={clusters} />}
    </MapContainer>
  );
}
