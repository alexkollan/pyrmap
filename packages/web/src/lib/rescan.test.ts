import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadRescanCooldownUntil, storeRescanCooldownUntil } from './rescan.js';

function stubStorage(value: string | null): { setItem: ReturnType<typeof vi.fn> } {
  const setItem = vi.fn();
  vi.stubGlobal('localStorage', { getItem: () => value, setItem });
  return { setItem };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('rescan cooldown persistence', () => {
  it('defaults to 0 (no cooldown) when nothing is stored', () => {
    stubStorage(null);
    expect(loadRescanCooldownUntil()).toBe(0);
  });

  it('round-trips a stored timestamp', () => {
    stubStorage('1700000000000');
    expect(loadRescanCooldownUntil()).toBe(1700000000000);
  });

  it('returns 0 for corrupted storage rather than throwing', () => {
    stubStorage('not-a-number');
    expect(loadRescanCooldownUntil()).toBe(0);
  });

  it('stores the timestamp as a string', () => {
    const { setItem } = stubStorage(null);
    storeRescanCooldownUntil(1700000000000);
    expect(setItem).toHaveBeenCalledWith('pyrmap-rescan-cooldown', '1700000000000');
  });
});
