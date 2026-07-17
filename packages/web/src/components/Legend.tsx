import { useState } from 'react';

/** Bottom-left legend. Collapsible via a toggle button that only appears below 640px (dev-plan §8.5). */
export function Legend(): JSX.Element {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="legend-container">
      <button type="button" className="legend-toggle" onClick={() => setCollapsed((c) => !c)}>
        {collapsed ? 'Show legend' : 'Hide legend'}
      </button>
      <div className={collapsed ? 'legend legend-collapsed' : 'legend'}>
        <div className="legend-row">
          <span className="swatch swatch-polar" /> Confirmed (VIIRS/MODIS)
        </div>
        <div className="legend-row">
          <span className="swatch swatch-geo-confirmed" /> Confirmed (Meteosat, corroborated)
        </div>
        <div className="legend-row">
          <span className="swatch swatch-geo-unconfirmed" /> Unconfirmed hotspot (Meteosat)
        </div>
      </div>
    </div>
  );
}
