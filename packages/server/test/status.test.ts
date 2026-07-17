import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { SqliteFireRepository } from '../src/adapters/sqlite/SqliteFireRepository.js';

const NOW = () => new Date('2026-07-15T12:00:00Z');

let tmpDir: string;
let repo: SqliteFireRepository;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'pyrmap-status-test-'));
  repo = new SqliteFireRepository(path.join(tmpDir, 'test.db'));
});

afterEach(() => {
  repo.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('GET /api/status', () => {
  it('returns lastFetch, counts, and dbSizeBytes', async () => {
    repo.recordFetchLog({
      source: 'MSG_NRT',
      fetchedAt: '2026-07-15T11:50:00Z',
      httpStatus: 200,
      rowsParsed: 3,
      rowsInserted: 3,
      error: null,
    });

    const app = await buildApp({ logLevel: 'silent' }, repo, NOW);
    const response = await app.inject({ method: 'GET', url: '/api/status' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.lastFetch.MSG_NRT).toEqual({ fetchedAt: '2026-07-15T11:50:00Z', ok: true, rowsInserted: 3 });
    expect(body.counts).toEqual({ geoUnconfirmed: 0, geoConfirmed: 0, polarLast24h: 0 });
    expect(typeof body.dbSizeBytes).toBe('number');
    expect(body.dbSizeBytes).toBeGreaterThan(0);

    await app.close();
  });
});
