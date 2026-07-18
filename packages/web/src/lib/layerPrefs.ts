import { FIRE_CLUSTER_DISTANCE_KM } from '@pyrmap/shared';

/** Per-user map layer preferences: which detection sources and overlays are visible. Persisted to localStorage. */
export interface LayerPrefs {
  /** FIRMS source ids the user has hidden (default: none hidden). */
  hiddenSources: string[];
  /** EFFIS hotspots WMS overlay (independent MODIS/VIIRS processing by JRC). */
  effisHotspots: boolean;
  /** EFFIS current-season burnt-area polygons WMS overlay. */
  effisBurntAreas: boolean;
  /** Wind arrows at fire-cluster centroids (Open-Meteo). */
  wind: boolean;
  /** Area-view clustering distance in km, user-tunable. */
  clusterKm: number;
}

export const DEFAULT_LAYER_PREFS: LayerPrefs = {
  hiddenSources: [],
  effisHotspots: false,
  effisBurntAreas: false,
  wind: false,
  clusterKm: FIRE_CLUSTER_DISTANCE_KM,
};

const STORAGE_KEY = 'pyrmap-layers';
const CLUSTER_KM_MIN = 1;
const CLUSTER_KM_MAX = 10;

export function loadStoredLayerPrefs(): LayerPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_LAYER_PREFS;
    const parsed = JSON.parse(raw) as Partial<LayerPrefs>;
    return {
      hiddenSources: Array.isArray(parsed.hiddenSources) ? parsed.hiddenSources.filter((s) => typeof s === 'string') : [],
      effisHotspots: parsed.effisHotspots === true,
      effisBurntAreas: parsed.effisBurntAreas === true,
      wind: parsed.wind === true,
      clusterKm: clampClusterKm(typeof parsed.clusterKm === 'number' ? parsed.clusterKm : DEFAULT_LAYER_PREFS.clusterKm),
    };
  } catch {
    return DEFAULT_LAYER_PREFS;
  }
}

export function storeLayerPrefs(prefs: LayerPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // localStorage unavailable; prefs just won't persist.
  }
}

export function clampClusterKm(km: number): number {
  if (!Number.isFinite(km)) return DEFAULT_LAYER_PREFS.clusterKm;
  return Math.min(CLUSTER_KM_MAX, Math.max(CLUSTER_KM_MIN, km));
}
