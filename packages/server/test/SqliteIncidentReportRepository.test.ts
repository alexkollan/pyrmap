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
