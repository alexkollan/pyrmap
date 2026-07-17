import { describe, expect, it } from 'vitest';
import { resolveSources } from './sourceResolution.js';

const configured = { MSG_NRT: 'geo', VIIRS_NOAA20_NRT: 'polar' } as const;

describe('resolveSources', () => {
  it('keeps a configured source that is available as-is', () => {
    const { effective, warnings } = resolveSources(configured, ['MSG_NRT', 'VIIRS_NOAA20_NRT']);
    expect(effective).toEqual({ MSG_NRT: 'geo', VIIRS_NOAA20_NRT: 'polar' });
    expect(warnings).toEqual([]);
  });

  it('falls back to a SEVIRI-named source when MSG_NRT is absent', () => {
    const { effective, warnings } = resolveSources(configured, ['MSG_SEVIRI_NRT', 'VIIRS_NOAA20_NRT']);
    expect(effective).toEqual({ MSG_SEVIRI_NRT: 'geo', VIIRS_NOAA20_NRT: 'polar' });
    expect(warnings).toEqual(['MSG_NRT not available; using fallback source MSG_SEVIRI_NRT']);
  });

  it('skips and warns when MSG_NRT is absent with no MSG/SEVIRI fallback', () => {
    const { effective, warnings } = resolveSources(configured, ['VIIRS_NOAA20_NRT']);
    expect(effective).toEqual({ VIIRS_NOAA20_NRT: 'polar' });
    expect(warnings).toEqual(['configured source MSG_NRT not available; skipping']);
  });

  it('skips and warns for a non-MSG source that is unavailable', () => {
    const { effective, warnings } = resolveSources(configured, ['MSG_NRT']);
    expect(effective).toEqual({ MSG_NRT: 'geo' });
    expect(warnings).toEqual(['configured source VIIRS_NOAA20_NRT not available; skipping']);
  });
});
