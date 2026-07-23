import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteCivilProtectionAlertRepository } from '../src/adapters/sqlite/SqliteCivilProtectionAlertRepository.js';
import type { NewAlertRow } from '../src/ports/CivilProtectionAlertRepository.js';

let tmpDir: string;
let repo: SqliteCivilProtectionAlertRepository;

const BASE_ROW: NewAlertRow = {
  externalId: '1',
  source: 'ALERT_112_X',
  text: 't',
  url: 'u',
  publishedAt: '2026-07-23T10:00:00Z',
  latitude: 38.0,
  longitude: 23.0,
  precision: 'locality',
  areaPolygon: null,
};

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'pyrmap-alertrepo-test-'));
  repo = new SqliteCivilProtectionAlertRepository(path.join(tmpDir, 'test.db'));
});

afterEach(() => {
  repo.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('SqliteCivilProtectionAlertRepository', () => {
  it('inserts a row with a null area polygon and reads it back', () => {
    repo.insertAlerts([BASE_ROW]);
    const [found] = repo.findAlertsSince('2026-07-23T00:00:00Z');
    expect(found).toMatchObject({ latitude: 38.0, longitude: 23.0, precision: 'locality', areaPolygon: null });
  });

  it('inserts a row with a real polygon and round-trips it through JSON', () => {
    const polygon = { type: 'Polygon' as const, coordinates: [[[23.0, 38.0], [23.1, 38.0], [23.1, 38.1], [23.0, 38.0]]] };
    repo.insertAlerts([{ ...BASE_ROW, areaPolygon: polygon }]);
    const [found] = repo.findAlertsSince('2026-07-23T00:00:00Z');
    expect(found!.areaPolygon).toEqual(polygon);
  });

  it('ignores a duplicate external_id', () => {
    repo.insertAlerts([BASE_ROW]);
    const second = repo.insertAlerts([BASE_ROW]);
    expect(second).toHaveLength(0);
    expect(repo.findAlertsSince('2026-07-23T00:00:00Z')).toHaveLength(1);
  });

  it('findLatestExternalId considers both stored alerts and failed posts', () => {
    repo.insertAlerts([{ ...BASE_ROW, externalId: '100' }]);
    repo.recordFailedPostIfNew('ALERT_112_X', '200', 'no-location', 't', '2026-07-23T10:01:00Z');
    expect(repo.findLatestExternalId('ALERT_112_X')).toBe('200');
  });

  it('recordFailedPostIfNew returns true once, then false for the same (source, externalId)', () => {
    expect(repo.recordFailedPostIfNew('ALERT_112_X', '1', 'no-location', 't', '2026-07-23T10:00:00Z')).toBe(true);
    expect(repo.recordFailedPostIfNew('ALERT_112_X', '1', 'no-location', 't', '2026-07-23T10:00:00Z')).toBe(false);
  });

  it('updateAlertLocation clears the area polygon and sets locality precision', () => {
    const polygon = { type: 'Polygon' as const, coordinates: [[[23.0, 38.0], [23.1, 38.0], [23.1, 38.1], [23.0, 38.0]]] };
    repo.insertAlerts([{ ...BASE_ROW, precision: 'regional_unit', areaPolygon: polygon }]);
    const [before] = repo.findAlertsSince('2026-07-23T00:00:00Z');
    expect(repo.updateAlertLocation(before!.id, 39.0, 24.0)).toBe(true);
    const [after] = repo.findAlertsSince('2026-07-23T00:00:00Z');
    expect(after).toMatchObject({ latitude: 39.0, longitude: 24.0, precision: 'locality', areaPolygon: null });
  });

  it('updateAlertLocation returns false for a nonexistent id', () => {
    expect(repo.updateAlertLocation(999, 1, 1)).toBe(false);
  });

  it('hideAlert excludes the row from findAlertsSince but keeps blocking its external_id', () => {
    repo.insertAlerts([BASE_ROW]);
    const [before] = repo.findAlertsSince('2026-07-23T00:00:00Z');
    expect(repo.hideAlert(before!.id)).toBe(true);
    expect(repo.findAlertsSince('2026-07-23T00:00:00Z')).toHaveLength(0);
    expect(repo.insertAlerts([BASE_ROW])).toHaveLength(0);
  });

  it('deleteAlert removes the row entirely, allowing the same external_id to be re-inserted', () => {
    repo.insertAlerts([BASE_ROW]);
    const [before] = repo.findAlertsSince('2026-07-23T00:00:00Z');
    expect(repo.deleteAlert(before!.id)).toBe(true);
    expect(repo.insertAlerts([BASE_ROW])).toHaveLength(1);
  });

  it('findExternalIdsSince filters by source and sinceIso', () => {
    repo.insertAlerts([
      { ...BASE_ROW, externalId: '1', source: 'A', publishedAt: '2026-07-22T10:00:00Z' },
      { ...BASE_ROW, externalId: '2', source: 'A', publishedAt: '2026-07-23T10:00:00Z' },
      { ...BASE_ROW, externalId: '3', source: 'B', publishedAt: '2026-07-23T10:00:00Z' },
    ]);
    expect(repo.findExternalIdsSince('A', '2026-07-23T00:00:00Z')).toEqual(new Set(['2']));
  });

  it('deleteAlertsBefore removes only rows older than the cutoff', () => {
    repo.insertAlerts([
      { ...BASE_ROW, externalId: '1', publishedAt: '2026-07-01T00:00:00Z' },
      { ...BASE_ROW, externalId: '2', publishedAt: '2026-07-23T00:00:00Z' },
    ]);
    expect(repo.deleteAlertsBefore('2026-07-15T00:00:00Z')).toBe(1);
    expect(repo.findAlertsSince('2026-01-01T00:00:00Z')).toHaveLength(1);
  });
});
