const HOURS_STORAGE_KEY = 'pyrmap-hours';
export const DEFAULT_HOURS = 6;

export function loadStoredHours(): number {
  try {
    const raw = localStorage.getItem(HOURS_STORAGE_KEY);
    if (!raw) return DEFAULT_HOURS;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_HOURS;
  } catch {
    return DEFAULT_HOURS;
  }
}

export function storeHours(hours: number): void {
  try {
    localStorage.setItem(HOURS_STORAGE_KEY, String(hours));
  } catch {
    // localStorage unavailable; the window just won't persist across reloads.
  }
}

export type CollapsiblePanel = 'layers' | 'legend';

function panelStorageKey(panel: CollapsiblePanel): string {
  return `pyrmap-panel-${panel}`;
}

/** Both panels default to expanded (false) — matches today's behavior before this preference existed. */
export function loadStoredPanelCollapsed(panel: CollapsiblePanel): boolean {
  try {
    return localStorage.getItem(panelStorageKey(panel)) === 'true';
  } catch {
    return false;
  }
}

export function storePanelCollapsed(panel: CollapsiblePanel, collapsed: boolean): void {
  try {
    localStorage.setItem(panelStorageKey(panel), String(collapsed));
  } catch {
    // localStorage unavailable; collapsed state just won't persist across reloads.
  }
}
