import { useState } from 'react';
import { loadStoredPanelCollapsed, storePanelCollapsed } from '../lib/uiPrefs.js';

/**
 * Bottom-left legend. Collapsible via a toggle button that only appears below 640px (dev-plan
 * §8.5). Marker color now encodes age (a gradient bar, not fixed swatches) and marker
 * shape/border encodes trust — see docs/DECISIONS.md 2026-07-20.
 */
export function Legend(): JSX.Element {
  const [collapsed, setCollapsed] = useState(() => loadStoredPanelCollapsed('legend'));

  return (
    <div className="legend-container">
      <button
        type="button"
        className="legend-toggle"
        onClick={() => {
          setCollapsed((c) => {
            const next = !c;
            storePanelCollapsed('legend', next);
            return next;
          });
        }}
      >
        {collapsed ? 'Show legend' : 'Hide legend'}
      </button>
      <div className={collapsed ? 'legend legend-collapsed' : 'legend'}>
        <div className="legend-section-title">Color = how old</div>
        <div className="legend-gradient-bar" />
        <div className="legend-gradient-labels">
          <span>now</span>
          <span>12h</span>
          <span>24h</span>
        </div>
        <div className="legend-caption">Reported fires (X) use the same scale, compressed to 12h</div>

        <div className="legend-section-title legend-section-spaced">Shape = trust</div>
        <div className="legend-row">
          <span className="swatch swatch-polar" /> Polar satellite (VIIRS/MODIS)
        </div>
        <div className="legend-row">
          <span className="swatch swatch-geo-confirmed" /> Confirmed (Meteosat, corroborated)
        </div>
        <div className="legend-row">
          <span className="swatch swatch-geo-unconfirmed" /> Unconfirmed hotspot (Meteosat)
        </div>
        <div className="legend-row">
          <span className="swatch swatch-incident" /> Reported fire (Fire Service X)
        </div>
      </div>
    </div>
  );
}
