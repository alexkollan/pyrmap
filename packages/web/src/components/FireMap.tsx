import { MapContainer, TileLayer } from 'react-leaflet';
import type { Detection, GeoDetection } from '@pyrmap/shared';
import { GeoMarker, PolarMarker } from './FireMarker.js';
import { FireClusterShape } from './FireClusterShape.js';
import type { Theme } from '../lib/theme.js';
import type { ViewMode } from '../lib/viewMode.js';
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

export function FireMap({
  polar,
  geo,
  theme,
  viewMode,
}: {
  polar: Detection[];
  geo: GeoDetection[];
  theme: Theme;
  viewMode: ViewMode;
}): JSX.Element {
  const tileLayer = TILE_LAYERS[theme];

  return (
    <MapContainer center={GREECE_CENTER} zoom={INITIAL_ZOOM} className="fire-map">
      <TileLayer key={theme} url={tileLayer.url} attribution={tileLayer.attribution} />
      {viewMode === 'points' ? (
        <>
          {polar.map((detection) => (
            <PolarMarker key={detection.id} detection={detection} />
          ))}
          {geo.map((detection) => (
            <GeoMarker key={detection.id} detection={detection} />
          ))}
        </>
      ) : (
        buildFireClusters(polar, geo).map((cluster) => <FireClusterShape key={cluster.id} cluster={cluster} />)
      )}
    </MapContainer>
  );
}
