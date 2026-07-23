import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { SqliteFireRepository } from '../src/adapters/sqlite/SqliteFireRepository.js';
import { SqliteCivilProtectionAlertRepository } from '../src/adapters/sqlite/SqliteCivilProtectionAlertRepository.js';
import type { AuthConfig } from '../src/routes/auth.js';

const AUTH: AuthConfig = { username: 'alex', password: 'secret-pw', sessionSecret: 'test-secret' };

async function setup(auth: AuthConfig | null = null) {
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'pyrmap-alerts-route-test-'));
  const fireRepo = new SqliteFireRepository(path.join(tmpDir, 'fires.db'));
  const alertRepo = new SqliteCivilProtectionAlertRepository(path.join(tmpDir, 'alerts.db'));
  alertRepo.insertAlerts([
    {
      externalId: '1',
      source: 'ALERT_112_X',
      text: 'Πυρκαγιά στην περιοχή #Χ.',
      url: 'https://x.com/112Greece/status/1',
      publishedAt: '2026-07-23T10:00:00Z',
      latitude: 38.13,
      longitude: 22.42,
      precision: 'regional_unit',
      areaPolygon: null,
    },
  ]);
  const [{ id }] = alertRepo.findAlertsSince('2026-01-01T00:00:00Z');

  const app = await buildApp({ logLevel: 'silent' }, fireRepo, undefined, '/nonexistent', undefined, alertRepo, undefined, auth);

  return {
    app,
    id,
    cleanup: () => {
      fireRepo.close();
      alertRepo.close();
      rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

describe('PATCH /api/alerts/:id/location', () => {
  it('updates coordinates, clears the polygon, and publishes an update', async () => {
    const { app, id, cleanup } = await setup();
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/alerts/${id}/location`,
      payload: { latitude: 40.73, longitude: 22.92 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id, latitude: 40.73, longitude: 22.92, precision: 'locality', areaPolygon: null });
    cleanup();
  });

  it('404s for an unknown id', async () => {
    const { app, cleanup } = await setup();
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/alerts/999999/location',
      payload: { latitude: 1, longitude: 1 },
    });
    expect(response.statusCode).toBe(404);
    cleanup();
  });

  it('400s on a non-finite coordinate', async () => {
    const { app, id, cleanup } = await setup();
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/alerts/${id}/location`,
      payload: { latitude: 'not-a-number', longitude: 1 },
    });
    expect(response.statusCode).toBe(400);
    cleanup();
  });

  it('requires a session when auth is enabled', async () => {
    const { app, id, cleanup } = await setup(AUTH);
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/alerts/${id}/location`,
      payload: { latitude: 1, longitude: 1 },
    });
    expect(response.statusCode).toBe(401);
    cleanup();
  });
});

describe('POST /api/alerts/:id/hide', () => {
  it('hides the alert so it no longer appears in /api/fires', async () => {
    const { app, id, cleanup } = await setup();
    const hideResponse = await app.inject({ method: 'POST', url: `/api/alerts/${id}/hide` });
    expect(hideResponse.statusCode).toBe(200);

    const firesResponse = await app.inject({ method: 'GET', url: '/api/fires?hours=168' });
    expect(firesResponse.json().alerts).toEqual([]);
    cleanup();
  });

  it('404s for an unknown id', async () => {
    const { app, cleanup } = await setup();
    const response = await app.inject({ method: 'POST', url: '/api/alerts/999999/hide' });
    expect(response.statusCode).toBe(404);
    cleanup();
  });
});

describe('DELETE /api/alerts/:id', () => {
  it('removes the alert entirely', async () => {
    const { app, id, cleanup } = await setup();
    const deleteResponse = await app.inject({ method: 'DELETE', url: `/api/alerts/${id}` });
    expect(deleteResponse.statusCode).toBe(200);

    const firesResponse = await app.inject({ method: 'GET', url: '/api/fires?hours=168' });
    expect(firesResponse.json().alerts).toEqual([]);
    cleanup();
  });

  it('404s for an unknown id', async () => {
    const { app, cleanup } = await setup();
    const response = await app.inject({ method: 'DELETE', url: '/api/alerts/999999' });
    expect(response.statusCode).toBe(404);
    cleanup();
  });
});
