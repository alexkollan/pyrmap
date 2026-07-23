import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteIncidentReportRepository } from '../src/adapters/sqlite/SqliteIncidentReportRepository.js';

let tmpDir: string;
let repo: SqliteIncidentReportRepository;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'pyrmap-incidentrepo-test-'));
  repo = new SqliteIncidentReportRepository(path.join(tmpDir, 'test.db'));
});

afterEach(() => {
  repo.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('findExternalIdsSince', () => {
  it('returns only external_ids for the given source, published at or after sinceIso', () => {
    repo.insertIncidentReports([
      {
        externalId: '1',
        source: 'A',
        text: 't',
        url: 'u',
        publishedAt: '2026-07-22T10:00:00Z',
        latitude: 0,
        longitude: 0,
        precision: 'settlement',
      },
      {
        externalId: '2',
        source: 'A',
        text: 't',
        url: 'u',
        publishedAt: '2026-07-21T10:00:00Z', // before the window
        latitude: 0,
        longitude: 0,
        precision: 'settlement',
      },
      {
        externalId: '3',
        source: 'B', // different source
        text: 't',
        url: 'u',
        publishedAt: '2026-07-22T10:00:00Z',
        latitude: 0,
        longitude: 0,
        precision: 'settlement',
      },
    ]);

    const ids = repo.findExternalIdsSince('A', '2026-07-22T00:00:00Z');
    expect(ids).toEqual(new Set(['1']));
  });

  it('returns an empty set when nothing matches', () => {
    expect(repo.findExternalIdsSince('NONE', '2026-07-22T00:00:00Z')).toEqual(new Set());
  });
});

function insertOne(repo: SqliteIncidentReportRepository, externalId: string) {
  repo.insertIncidentReports([
    {
      externalId,
      source: 'A',
      text: 'Πυρκαγιά στο Χ.',
      url: 'https://x.com/pyrosvestiki/status/' + externalId,
      publishedAt: '2026-07-23T10:00:00Z',
      latitude: 38.0,
      longitude: 23.0,
      precision: 'regional_unit',
    },
  ]);
  return repo.findIncidentReportsSince('2026-01-01T00:00:00Z')[0]!.id;
}

describe('updateIncidentReportLocation', () => {
  it('updates latitude/longitude and bumps precision to settlement', () => {
    const id = insertOne(repo, '100');
    expect(repo.updateIncidentReportLocation(id, 40.73, 22.92)).toBe(true);

    const [report] = repo.findIncidentReportsSince('2026-01-01T00:00:00Z');
    expect(report).toMatchObject({ latitude: 40.73, longitude: 22.92, precision: 'settlement' });
  });

  it('returns false for an unknown id and touches nothing', () => {
    expect(repo.updateIncidentReportLocation(999999, 1, 1)).toBe(false);
  });
});

describe('hideIncidentReport', () => {
  it('marks a row hidden so it is excluded from findIncidentReportsSince but a re-insert of the same external_id is still ignored', () => {
    const id = insertOne(repo, '200');
    expect(repo.hideIncidentReport(id)).toBe(true);
    expect(repo.findIncidentReportsSince('2026-01-01T00:00:00Z')).toEqual([]);

    const inserted = repo.insertIncidentReports([
      {
        externalId: '200',
        source: 'A',
        text: 'Πυρκαγιά στο Χ.',
        url: 'https://x.com/pyrosvestiki/status/200',
        publishedAt: '2026-07-23T10:00:00Z',
        latitude: 1,
        longitude: 1,
        precision: 'settlement',
      },
    ]);
    expect(inserted).toEqual([]); // still blocked — hidden, not gone
  });

  it('returns false for an unknown id', () => {
    expect(repo.hideIncidentReport(999999)).toBe(false);
  });
});

describe('deleteIncidentReport', () => {
  it('removes the row entirely, so the same external_id can be re-inserted afterwards', () => {
    const id = insertOne(repo, '300');
    expect(repo.deleteIncidentReport(id)).toBe(true);
    expect(repo.findIncidentReportsSince('2026-01-01T00:00:00Z')).toEqual([]);

    const inserted = repo.insertIncidentReports([
      {
        externalId: '300',
        source: 'A',
        text: 'Πυρκαγιά στο Χ.',
        url: 'https://x.com/pyrosvestiki/status/300',
        publishedAt: '2026-07-23T11:00:00Z',
        latitude: 2,
        longitude: 2,
        precision: 'settlement',
      },
    ]);
    expect(inserted).toHaveLength(1); // gone for real — re-insertable
  });

  it('returns false for an unknown id', () => {
    expect(repo.deleteIncidentReport(999999)).toBe(false);
  });
});
