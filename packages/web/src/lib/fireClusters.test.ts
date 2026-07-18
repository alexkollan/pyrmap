import { describe, expect, it } from 'vitest';
import type { Detection, GeoDetection } from '@pyrmap/shared';
import { buildFireClusters } from './fireClusters.js';

let nextId = 1;

function polarDetection(overrides: Partial<Detection>): Detection {
  return {
    id: nextId++,
    tier: 'polar',
    source: 'VIIRS_NOAA20_NRT',
    latitude: 38.0,
    longitude: 23.0,
    acquiredAt: '2026-07-15T09:30:00Z',
    frp: 10,
    confidence: 'n',
    satellite: 'N',
    instrument: 'VIIRS',
    daynight: 'D',
    scanKm: 0.4,
    trackKm: 0.4,
    ...overrides,
  };
}

function geoDetection(overrides: Partial<GeoDetection>): GeoDetection {
  return {
    id: nextId++,
    tier: 'geo',
    source: 'MSG_NRT',
    latitude: 38.0,
    longitude: 23.0,
    acquiredAt: '2026-07-15T09:30:00Z',
    frp: 20,
    confidence: null,
    satellite: 'MSG',
    instrument: null,
    daynight: null,
    scanKm: null,
    trackKm: null,
    status: 'unconfirmed',
    confirmedBy: null,
    ...overrides,
  };
}

describe('buildFireClusters', () => {
  it('groups a wide fire (many nearby points) into one confirmed cluster with a hull', () => {
    const points = [
      polarDetection({ latitude: 38.0, longitude: 23.0 }),
      polarDetection({ latitude: 38.01, longitude: 23.0 }),
      polarDetection({ latitude: 38.01, longitude: 23.01 }),
      polarDetection({ latitude: 38.0, longitude: 23.01 }),
    ];
    const [cluster] = buildFireClusters(points, [], 5);

    expect(cluster!.detections).toHaveLength(4);
    expect(cluster!.hull).not.toBeNull();
    expect(cluster!.areaKm2).toBeGreaterThan(0);
    expect(cluster!.isConfirmed).toBe(true);
  });

  it('keeps a single isolated detection as a hull-less cluster', () => {
    const [cluster] = buildFireClusters([polarDetection({ latitude: 40.0, longitude: 22.0 })], [], 5);

    expect(cluster!.detections).toHaveLength(1);
    expect(cluster!.hull).toBeNull();
    expect(cluster!.areaKm2).toBe(0);
  });

  it('splits far-apart fires into separate clusters', () => {
    const clusters = buildFireClusters(
      [polarDetection({ latitude: 38.0, longitude: 23.0 }), polarDetection({ latitude: 40.5, longitude: 21.5 })],
      [],
      5,
    );
    expect(clusters).toHaveLength(2);
  });

  it('marks a cluster unconfirmed when it contains only unconfirmed geo detections', () => {
    const points = [
      geoDetection({ latitude: 38.0, longitude: 23.0, status: 'unconfirmed' }),
      geoDetection({ latitude: 38.01, longitude: 23.0, status: 'unconfirmed' }),
      geoDetection({ latitude: 38.01, longitude: 23.01, status: 'unconfirmed' }),
    ];
    const [cluster] = buildFireClusters([], points, 5);
    expect(cluster!.isConfirmed).toBe(false);
  });

  it('excludes expired geo detections entirely', () => {
    const clusters = buildFireClusters([], [geoDetection({ status: 'expired' })], 5);
    expect(clusters).toHaveLength(0);
  });

  it('reports the max FRP and the earliest/latest acquired times across the group', () => {
    const points = [
      polarDetection({ latitude: 38.0, longitude: 23.0, frp: 5, acquiredAt: '2026-07-15T09:00:00Z' }),
      polarDetection({ latitude: 38.01, longitude: 23.0, frp: 50, acquiredAt: '2026-07-15T11:00:00Z' }),
      polarDetection({ latitude: 38.01, longitude: 23.01, frp: 15, acquiredAt: '2026-07-15T10:00:00Z' }),
    ];
    const [cluster] = buildFireClusters(points, [], 5);
    expect(cluster!.maxFrp).toBe(50);
    expect(cluster!.earliestAcquiredAt).toBe('2026-07-15T09:00:00Z');
    expect(cluster!.latestAcquiredAt).toBe('2026-07-15T11:00:00Z');
  });
});
