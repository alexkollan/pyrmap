import { useMemo, useState } from 'react';
import { FireMap } from './components/FireMap.js';
import { StatusBar } from './components/StatusBar.js';
import { Legend } from './components/Legend.js';
import { LayersPanel } from './components/LayersPanel.js';
import { useFires } from './hooks/useFires.js';
import { loadStoredTheme, storeTheme, type Theme } from './lib/theme.js';
import { loadStoredViewMode, storeViewMode, type ViewMode } from './lib/viewMode.js';
import { clampClusterKm, loadStoredLayerPrefs, storeLayerPrefs, type LayerPrefs } from './lib/layerPrefs.js';

const DEFAULT_HOURS = 24;

export interface MapAppProps {
  /** Only shown when the server actually has auth enabled — hidden entirely in open-access (local dev) mode. */
  onLogout?: () => void;
}

export function MapApp({ onLogout }: MapAppProps): JSX.Element {
  const [hours, setHours] = useState<number>(DEFAULT_HOURS);
  const [theme, setTheme] = useState<Theme>(loadStoredTheme);
  const [viewMode, setViewMode] = useState<ViewMode>(loadStoredViewMode);
  const [layerPrefs, setLayerPrefs] = useState<LayerPrefs>(loadStoredLayerPrefs);
  const { data, loading, error, lastSuccessAt, refresh } = useFires(hours);

  function toggleTheme(): void {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    storeTheme(next);
  }

  function toggleViewMode(): void {
    const next: ViewMode = viewMode === 'points' ? 'areas' : 'points';
    setViewMode(next);
    storeViewMode(next);
  }

  function changeLayerPrefs(next: LayerPrefs): void {
    const clamped = { ...next, clusterKm: clampClusterKm(next.clusterKm) };
    setLayerPrefs(clamped);
    storeLayerPrefs(clamped);
  }

  const activeSources = useMemo(() => {
    const ids = new Set<string>();
    for (const d of data?.polar ?? []) ids.add(d.source);
    for (const d of data?.geo ?? []) ids.add(d.source);
    return [...ids].sort();
  }, [data]);

  return (
    <div className="app" data-theme={theme}>
      <StatusBar
        hours={hours}
        onHoursChange={setHours}
        lastSuccessAt={lastSuccessAt}
        loading={loading}
        error={error}
        onRefresh={refresh}
        theme={theme}
        onToggleTheme={toggleTheme}
        viewMode={viewMode}
        onToggleViewMode={toggleViewMode}
        onLogout={onLogout}
      />
      <FireMap
        polar={data?.polar ?? []}
        geo={data?.geo ?? []}
        incidents={data?.incidents ?? []}
        theme={theme}
        viewMode={viewMode}
        prefs={layerPrefs}
      />
      <LayersPanel activeSources={activeSources} prefs={layerPrefs} onChange={changeLayerPrefs} viewMode={viewMode} />
      <Legend />
    </div>
  );
}
