import { afterEach, describe, expect, it, vi } from 'vitest';
import { clampClusterKm, DEFAULT_LAYER_PREFS, loadStoredLayerPrefs } from './layerPrefs.js';

function stubStorage(value: string | null): void {
  vi.stubGlobal('localStorage', {
    getItem: () => value,
    setItem: () => undefined,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadStoredLayerPrefs', () => {
  it('defaults to showing unconfirmed hotspots', () => {
    stubStorage(null);
    expect(loadStoredLayerPrefs().showUnconfirmed).toBe(true);
  });

  it('keeps showUnconfirmed true for prefs stored before the field existed', () => {
    stubStorage(JSON.stringify({ hiddenSources: [], wind: true, clusterKm: 5 }));
    const prefs = loadStoredLayerPrefs();
    expect(prefs.showUnconfirmed).toBe(true);
    expect(prefs.wind).toBe(true);
    expect(prefs.clusterKm).toBe(5);
  });

  it('respects an explicit opt-out of unconfirmed hotspots', () => {
    stubStorage(JSON.stringify({ showUnconfirmed: false }));
    expect(loadStoredLayerPrefs().showUnconfirmed).toBe(false);
  });

  it('defaults to showing reported incidents, and keeps that default for pre-existing stored prefs', () => {
    stubStorage(null);
    expect(loadStoredLayerPrefs().reportedIncidents).toBe(true);
    stubStorage(JSON.stringify({ hiddenSources: [] }));
    expect(loadStoredLayerPrefs().reportedIncidents).toBe(true);
  });

  it('respects an explicit opt-out of reported incidents', () => {
    stubStorage(JSON.stringify({ reportedIncidents: false }));
    expect(loadStoredLayerPrefs().reportedIncidents).toBe(false);
  });

  it('returns defaults when storage holds junk', () => {
    stubStorage('not json{');
    expect(loadStoredLayerPrefs()).toEqual(DEFAULT_LAYER_PREFS);
  });
});

describe('clampClusterKm', () => {
  it('clamps into the 1-10km range and falls back on non-finite input', () => {
    expect(clampClusterKm(0)).toBe(1);
    expect(clampClusterKm(25)).toBe(10);
    expect(clampClusterKm(4.5)).toBe(4.5);
    expect(clampClusterKm(Number.NaN)).toBe(DEFAULT_LAYER_PREFS.clusterKm);
  });
});
