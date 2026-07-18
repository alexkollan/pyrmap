export type ViewMode = 'points' | 'areas';

const STORAGE_KEY = 'pyrmap-view-mode';

/** Reads the persisted view mode; defaults to 'points' (individual detections) if unset or unavailable. */
export function loadStoredViewMode(): ViewMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'areas' ? 'areas' : 'points';
  } catch {
    return 'points';
  }
}

export function storeViewMode(mode: ViewMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // localStorage unavailable; view mode just won't persist.
  }
}
