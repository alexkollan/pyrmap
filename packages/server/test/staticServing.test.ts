import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { SqliteFireRepository } from '../src/adapters/sqlite/SqliteFireRepository.js';

let dbDir: string;
let publicDir: string;
let repo: SqliteFireRepository;

beforeEach(() => {
  dbDir = mkdtempSync(path.join(tmpdir(), 'pyrmap-static-db-'));
  repo = new SqliteFireRepository(path.join(dbDir, 'test.db'));

  publicDir = mkdtempSync(path.join(tmpdir(), 'pyrmap-static-public-'));
  writeFileSync(path.join(publicDir, 'index.html'), '<html><body>PyrMap</body></html>');
});

afterEach(() => {
  repo.close();
  rmSync(dbDir, { recursive: true, force: true });
  rmSync(publicDir, { recursive: true, force: true });
});

describe('static frontend serving', () => {
  it('serves index.html at the root', async () => {
    const app = await buildApp({ logLevel: 'silent' }, repo, () => new Date(), publicDir);
    const response = await app.inject({ method: 'GET', url: '/' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('PyrMap');
    await app.close();
  });

  it('falls back to index.html for an unmatched non-/api route (SPA)', async () => {
    const app = await buildApp({ logLevel: 'silent' }, repo, () => new Date(), publicDir);
    const response = await app.inject({ method: 'GET', url: '/some/client/route' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('PyrMap');
    await app.close();
  });

  it('returns JSON 404 for an unmatched /api route, not the SPA fallback', async () => {
    const app = await buildApp({ logLevel: 'silent' }, repo, () => new Date(), publicDir);
    const response = await app.inject({ method: 'GET', url: '/api/does-not-exist' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'Not Found' });
    await app.close();
  });

  it('skips static registration entirely when the public dir does not exist', async () => {
    const app = await buildApp({ logLevel: 'silent' }, repo, () => new Date(), '/nonexistent/path');
    const response = await app.inject({ method: 'GET', url: '/' });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});
