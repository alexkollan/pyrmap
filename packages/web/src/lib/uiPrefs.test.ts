import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadStoredHours, loadStoredPanelCollapsed, storeHours, storePanelCollapsed } from './uiPrefs.js';

function stubStorage(values: Record<string, string>): { setItem: ReturnType<typeof vi.fn> } {
  const setItem = vi.fn();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values[key] ?? null, setItem });
  return { setItem };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadStoredHours', () => {
  it('defaults to 6 when nothing is stored', () => {
    stubStorage({});
    expect(loadStoredHours()).toBe(6);
  });

  it('round-trips a stored value', () => {
    stubStorage({ 'pyrmap-hours': '24' });
    expect(loadStoredHours()).toBe(24);
  });

  it('falls back to the default for a corrupted value', () => {
    stubStorage({ 'pyrmap-hours': 'nonsense' });
    expect(loadStoredHours()).toBe(6);
  });
});

describe('storeHours', () => {
  it('stores the value', () => {
    const { setItem } = stubStorage({});
    storeHours(12);
    expect(setItem).toHaveBeenCalledWith('pyrmap-hours', '12');
  });
});

describe('panel collapsed state', () => {
  it('defaults to not-collapsed (expanded) for both panels when nothing is stored', () => {
    stubStorage({});
    expect(loadStoredPanelCollapsed('layers')).toBe(false);
    expect(loadStoredPanelCollapsed('legend')).toBe(false);
  });

  it('round-trips a stored collapsed state per panel independently', () => {
    stubStorage({ 'pyrmap-panel-layers': 'true', 'pyrmap-panel-legend': 'false' });
    expect(loadStoredPanelCollapsed('layers')).toBe(true);
    expect(loadStoredPanelCollapsed('legend')).toBe(false);
  });

  it('stores per-panel', () => {
    const { setItem } = stubStorage({});
    storePanelCollapsed('legend', true);
    expect(setItem).toHaveBeenCalledWith('pyrmap-panel-legend', 'true');
  });
});
