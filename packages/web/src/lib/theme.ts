export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'pyrmap-theme';

/** Reads the persisted theme choice; defaults to dark if unset or unavailable. */
export function loadStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function storeTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // localStorage unavailable (e.g. private browsing); theme just won't persist.
  }
}
