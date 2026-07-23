import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/app.js';
import { SqliteFireRepository } from '../src/adapters/sqlite/SqliteFireRepository.js';
import { SqliteIncidentReportRepository } from '../src/adapters/sqlite/SqliteIncidentReportRepository.js';
import { SqlitePushSubscriptionRepository } from '../src/adapters/sqlite/SqlitePushSubscriptionRepository.js';
import type { Scheduler } from '../src/jobs/scheduler.js';
import type { AuthConfig } from '../src/routes/auth.js';

const AUTH: AuthConfig = { username: 'alex', password: 'secret-pw', sessionSecret: 'test-secret' };

function fakeScheduler(): Scheduler {
  return {
    stop: () => undefined,
    pollGeo: async () => undefined,
    pollPolar: async () => undefined,
    pollIncidents: async () => undefined,
    pollAlerts: async () => undefined,
    decay: () => undefined,
    retention: () => undefined,
    rescan: async () => ({ satellite: { sourcesChanged: 0 }, incidents: null, alerts: null }),
  };
}

async function setup() {
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'pyrmap-public-access-test-'));
  const fireRepo = new SqliteFireRepository(path.join(tmpDir, 'fires.db'));
  const incidentRepo = new SqliteIncidentReportRepository(path.join(tmpDir, 'incidents.db'));
  const pushRepo = new SqlitePushSubscriptionRepository(path.join(tmpDir, 'push.db'));
  const app = await buildApp(
    { logLevel: 'silent' },
    fireRepo,
    undefined,
    '/nonexistent',
    incidentRepo,
    undefined,
    undefined,
    AUTH,
    pushRepo,
    undefined,
    () => fakeScheduler(),
  );
  return {
    app,
    cleanup: () => {
      fireRepo.close();
      incidentRepo.close();
      pushRepo.close();
      rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

describe('public vs admin access, with auth configured', () => {
  it('allows /api/fires, /api/status without a session', async () => {
    const { app, cleanup } = await setup();
    expect((await app.inject({ method: 'GET', url: '/api/fires?hours=24' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/status' })).statusCode).toBe(200);
    cleanup();
  });

  it('still requires a session for /api/rescan, incident-edit routes, and push subscribe', async () => {
    const { app, cleanup } = await setup();
    expect((await app.inject({ method: 'POST', url: '/api/rescan', payload: { hours: 6 } })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: 'PATCH', url: '/api/incidents/1/location', payload: { latitude: 1, longitude: 1 } }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/push/subscribe',
          payload: { endpoint: 'x', keys: { p256dh: 'a', auth: 'b' } },
        })
      ).statusCode,
    ).toBe(401);
    cleanup();
  });
});
