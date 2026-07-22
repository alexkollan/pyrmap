const COOLDOWN_STORAGE_KEY = 'pyrmap-rescan-cooldown';
/** Minimum time between rescans — each one is a real paid X API read, not the free since_id path. */
export const RESCAN_COOLDOWN_MS = 5 * 60 * 1000;

/** Epoch ms after which the rescan control is usable again; 0 if never used or storage is unavailable/corrupted. */
export function loadRescanCooldownUntil(): number {
  try {
    const raw = localStorage.getItem(COOLDOWN_STORAGE_KEY);
    if (!raw) return 0;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

export function storeRescanCooldownUntil(timestampMs: number): void {
  try {
    localStorage.setItem(COOLDOWN_STORAGE_KEY, String(timestampMs));
  } catch {
    // localStorage unavailable; cooldown just won't persist across reloads.
  }
}
