import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Detection, GeoDetection, IncidentReport } from '@pyrmap/shared';

const trackEvent = vi.fn();
vi.mock('./analytics.js', () => ({ trackEvent: (...args: unknown[]) => trackEvent(...args) }));

// Imported after the mock so the module under test picks up the mocked trackEvent.
const { trackNewIncidents } = await import('./incidentTracking.js');

const POLAR: Detection = {
  id: 1,
  tier: 'polar',
  source: 'VIIRS_NOAA20_NRT',
  latitude: 38.12345,
  longitude: 23.98765,
  acquiredAt: '2026-07-23T10:00:00Z',
  frp: null,
  confidence: null,
  satellite: null,
  instrument: null,
  daynight: null,
  scanKm: null,
  trackKm: null,
};

const GEO: GeoDetection = {
  ...POLAR,
  id: 2,
  tier: 'geo',
  source: 'MSG_NRT',
  status: 'confirmed',
  confirmedBy: null,
};

const INCIDENT: IncidentReport = {
  id: 3,
  source: 'PYROSVESTIKI_X',
  text: 'Πυρκαγιά',
  url: 'https://x.com/pyrosvestiki/status/3',
  publishedAt: '2026-07-23T10:00:00Z',
  latitude: 40.111,
  longitude: 22.222,
  precision: 'settlement',
};

beforeEach(() => {
  trackEvent.mockClear();
});

describe('trackNewIncidents', () => {
  it('logs a new polar detection as type satellite with rounded coordinates', () => {
    trackNewIncidents([POLAR], [], []);
    expect(trackEvent).toHaveBeenCalledWith('incident_view', {
      type: 'satellite',
      id: 1,
      source: 'VIIRS_NOAA20_NRT',
      lat: 38.12,
      lon: 23.99,
    });
  });

  it('logs a new geo detection as type satellite', () => {
    trackNewIncidents([], [GEO], []);
    expect(trackEvent).toHaveBeenCalledWith('incident_view', {
      type: 'satellite',
      id: 2,
      source: 'MSG_NRT',
      lat: 38.12,
      lon: 23.99,
    });
  });

  it('logs a new incident report as type reported', () => {
    trackNewIncidents([], [], [INCIDENT]);
    expect(trackEvent).toHaveBeenCalledWith('incident_view', {
      type: 'reported',
      id: 3,
      source: 'PYROSVESTIKI_X',
      lat: 40.11,
      lon: 22.22,
    });
  });

  it('does not re-log the same detection on a second call (already seen this session)', () => {
    trackNewIncidents([POLAR], [], []);
    trackEvent.mockClear();
    trackNewIncidents([POLAR], [], []);
    expect(trackEvent).not.toHaveBeenCalled();
  });

  it('does not confuse a polar id with a geo/incident id sharing the same number', () => {
    const geoWithSameId: GeoDetection = { ...GEO, id: 1 };
    const incidentWithSameId: IncidentReport = { ...INCIDENT, id: 1 };
    trackNewIncidents([POLAR], [], []);
    trackEvent.mockClear();
    trackNewIncidents([], [geoWithSameId], [incidentWithSameId]);
    expect(trackEvent).toHaveBeenCalledTimes(2);
  });
});
