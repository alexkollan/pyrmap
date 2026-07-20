import { useState } from 'react';
import type { LayerPrefs } from '../lib/layerPrefs.js';
import type { ViewMode } from '../lib/viewMode.js';

/** Human-readable labels for the FIRMS source ids we poll. */
const SOURCE_LABELS: Record<string, string> = {
  VIIRS_NOAA20_NRT: 'VIIRS NOAA-20',
  VIIRS_NOAA21_NRT: 'VIIRS NOAA-21',
  VIIRS_SNPP_NRT: 'VIIRS Suomi NPP',
  MODIS_NRT: 'MODIS Terra/Aqua',
  MSG_NRT: 'Meteosat (geo)',
  MTG_FCI_FIR: 'Meteosat MTG alerts (geo, 10-min)',
  MSG_FRP_PIXEL: 'Meteosat MSG raw pixels (geo, 15-min)',
};

export interface LayersPanelProps {
  /** Source ids actually present in the current data. */
  activeSources: string[];
  prefs: LayerPrefs;
  onChange: (prefs: LayerPrefs) => void;
  viewMode: ViewMode;
}

/** Top-right panel: per-source visibility, external overlays (EFFIS, wind), and the cluster-distance slider. */
export function LayersPanel({ activeSources, prefs, onChange, viewMode }: LayersPanelProps): JSX.Element {
  const [collapsed, setCollapsed] = useState(false);

  function toggleSource(sourceId: string): void {
    const hidden = prefs.hiddenSources.includes(sourceId)
      ? prefs.hiddenSources.filter((s) => s !== sourceId)
      : [...prefs.hiddenSources, sourceId];
    onChange({ ...prefs, hiddenSources: hidden });
  }

  return (
    <div className="layers-panel-container">
      <button type="button" className="layers-toggle" onClick={() => setCollapsed((c) => !c)}>
        {collapsed ? 'Layers' : 'Hide layers'}
      </button>
      {!collapsed && (
        <div className="layers-panel">
          <div className="layers-group">
            <div className="layers-group-title">Detections</div>
            {activeSources.map((sourceId) => (
              <label key={sourceId} className="layers-row">
                <input
                  type="checkbox"
                  checked={!prefs.hiddenSources.includes(sourceId)}
                  onChange={() => toggleSource(sourceId)}
                />
                {SOURCE_LABELS[sourceId] ?? sourceId}
              </label>
            ))}
            {activeSources.length === 0 && <div className="layers-empty">No detections in window</div>}
            <label className="layers-row">
              <input
                type="checkbox"
                checked={prefs.showUnconfirmed}
                onChange={() => onChange({ ...prefs, showUnconfirmed: !prefs.showUnconfirmed })}
              />
              Unconfirmed hotspots
            </label>
          </div>

          <div className="layers-group">
            <div className="layers-group-title">Overlays</div>
            <label className="layers-row">
              <input
                type="checkbox"
                checked={prefs.effisHotspots}
                onChange={() => onChange({ ...prefs, effisHotspots: !prefs.effisHotspots })}
              />
              EFFIS hotspots (JRC)
            </label>
            <label className="layers-row">
              <input
                type="checkbox"
                checked={prefs.effisBurntAreas}
                onChange={() => onChange({ ...prefs, effisBurntAreas: !prefs.effisBurntAreas })}
              />
              EFFIS burnt areas (season)
            </label>
            <label className="layers-row">
              <input
                type="checkbox"
                checked={prefs.wind}
                onChange={() => onChange({ ...prefs, wind: !prefs.wind })}
              />
              Wind at fires (Open-Meteo)
            </label>
          </div>

          {viewMode === 'areas' && (
            <div className="layers-group">
              <div className="layers-group-title">Cluster distance: {prefs.clusterKm} km</div>
              <input
                type="range"
                min={1}
                max={10}
                step={0.5}
                value={prefs.clusterKm}
                onChange={(event) => onChange({ ...prefs, clusterKm: Number(event.target.value) })}
                aria-label="Cluster distance in kilometers"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
