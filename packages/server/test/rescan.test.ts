import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/app.js';
import { SqliteFireRepository } from '../src/adapters/sqlite/SqliteFireRepository.js';
import type { Scheduler } from '../src/jobs/scheduler.js';
import type { AuthConfig } from '../src/routes/auth.js';

const AUTH: AuthConfig = { username: 'alex', password: 'secret-pw', sessionSecret: 'test-secret' };

function fakeScheduler(rescan: Scheduler['rescan']): Scheduler {
  return {
    stop: () => undefined,
    pollGeo: async () => undefined,
    pollPolar: async () => undefined,
    pollIncidents: async () => undefined,
    decay: () => undefined,
    retention: () => undefined,
    rescan,
  };
}

describe('POST /api/rescan', () => {
  it('calls scheduler.rescan with the requested hours and returns its result', async () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), 'pyrmap-rescan-route-test-'));
    const repo = new SqliteFireRepository(path.join(tmpDir, 'test.db'));
    const rescan = vi.fn(async () => ({ satellite: { sourcesChanged: 2 }, incidents: null }));
    let scheduler: Scheduler | null = null;

    const app = await buildApp(
      { logLevel: 'silent' },
      repo,
      undefined,
      '/nonexistent',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      () => scheduler,
    );
    scheduler = fakeScheduler(rescan);

    const response = await app.inject({ method: 'POST', url: '/api/rescan', payload: { hours: 12 } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ satellite: { sourcesChanged: 2 }, incidents: null });
    expect(rescan).toHaveBeenCalledWith(12);

    repo.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rejects an hours value that is not 6, 12, or 24', async () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), 'pyrmap-rescan-route-test2-'));
    const repo = new SqliteFireRepository(path.join(tmpDir, 'test.db'));
    const app = await buildApp(
      { logLevel: 'silent' },
      repo,
      undefined,
      '/nonexistent',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      () => fakeScheduler(async () => ({ satellite: { sourcesChanged: 0 }, incidents: null })),
    );

    const response = await app.inject({ method: 'POST', url: '/api/rescan', payload: { hours: 999 } });
    expect(response.statusCode).toBe(400);

    repo.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('requires a session when auth is enabled', async () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), 'pyrmap-rescan-route-test3-'));
    const repo = new SqliteFireRepository(path.join(tmpDir, 'test.db'));
    const app = await buildApp(
      { logLevel: 'silent' },
      repo,
      undefined,
      '/nonexistent',
      undefined,
      undefined,
      AUTH,
      undefined,
      undefined,
      () => fakeScheduler(async () => ({ satellite: { sourcesChanged: 0 }, incidents: null })),
    );

    const response = await app.inject({ method: 'POST', url: '/api/rescan', payload: { hours: 6 } });
    expect(response.statusCode).toBe(401);

    repo.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });
});
