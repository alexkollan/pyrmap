import { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, WMSTileLayer, useMap } from 'react-leaflet';
import type { Detection, GeoDetection, IncidentReport } from '@pyrmap/shared';
import { GeoMarker, PolarMarker } from './FireMarker.js';
import { FireClusterShape } from './FireClusterShape.js';
import { WindLayer } from './WindLayer.js';
import { IncidentMarker } from './IncidentMarker.js';
import type { Theme } from '../lib/theme.js';
import type { ViewMode } from '../lib/viewMode.js';
import type { LayerPrefs } from '../lib/layerPrefs.js';
import { buildFireClusters } from '../lib/fireClusters.js';
import type { FocusTarget } from '../lib/focusTarget.js';

const GREECE_CENTER: [number, number] = [38.5, 24.0];
const INITIAL_ZOOM = 7;

const CARTO_ATTRIBUTION =
  '&copy; OpenStreetMap contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

// Light mode was tile.openstreetmap.org directly; that server's usage policy explicitly excludes
// production/heavy-traffic apps (docs/DECISIONS.md 2026-07-23) — switched to CARTO's light_all,
// the same provider dark mode already uses, same attribution requirement already met.
const TILE_LAYERS: Record<Theme, { url: string; attribution: string }> = {
  light: {
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: CARTO_ATTRIBUTION,
  },
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: CARTO_ATTRIBUTION,
  },
};

// EFFIS WMS (Copernicus/JRC). Layer names verified against GetCapabilities 2026-07-18:
// all.hs = MODIS+VIIRS hotspots as EFFIS processes them; effis.nrt.ba.poly = current-season burnt areas.
const EFFIS_WMS_URL = 'https://maps.effis.emergency.copernicus.eu/effis';
const EFFIS_ATTRIBUTION = '&copy; <a href="https://forest-fire.emergency.copernicus.eu/">EFFIS</a>';

/** Pans the map to a deep-linked detection (from a push notification click) once, when it appears. */
function FocusHandler({ target }: { target: FocusTarget | null }): null {
  const map = useMap();
  useEffect(() => {
    if (target) map.setView([target.lat, target.lon], 13);
  }, [target, map]);
  return null;
}

export interface FireMapProps {
  polar: Detection[];
  geo: GeoDetection[];
  incidents: IncidentReport[];
  theme: Theme;
  viewMode: ViewMode;
  prefs: LayerPrefs;
  focusTarget?: FocusTarget | null;
  editMode: boolean;
}

export function FireMap({ polar, geo, incidents, theme, viewMode, prefs, focusTarget, editMode }: FireMapProps): JSX.Element {
  const tileLayer = TILE_LAYERS[theme];

  const visiblePolar = useMemo(
    () => polar.filter((d) => !prefs.hiddenSources.includes(d.source)),
    [polar, prefs.hiddenSources],
  );
  const visibleGeo = useMemo(
    () =>
      geo.filter(
        (d) => !prefs.hiddenSources.includes(d.source) && (prefs.showUnconfirmed || d.status !== 'unconfirmed'),
      ),
    [geo, prefs.hiddenSources, prefs.showUnconfirmed],
  );

  const clusters = useMemo(
    () => buildFireClusters(visiblePolar, visibleGeo, prefs.clusterKm),
    [visiblePolar, visibleGeo, prefs.clusterKm],
  );

  return (
    <MapContainer center={GREECE_CENTER} zoom={INITIAL_ZOOM} className="fire-map">
      <FocusHandler target={focusTarget ?? null} />
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

      {prefs.reportedIncidents &&
        incidents.map((incident) => <IncidentMarker key={incident.id} incident={incident} editMode={editMode} />)}
    </MapContainer>
  );
}
