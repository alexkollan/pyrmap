import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { SqliteFireRepository } from '../src/adapters/sqlite/SqliteFireRepository.js';
import { SqliteIncidentReportRepository } from '../src/adapters/sqlite/SqliteIncidentReportRepository.js';
import type { AuthConfig } from '../src/routes/auth.js';
import type { LocationSearchSource } from '../src/ports/LocationSearchSource.js';

const AUTH: AuthConfig = { username: 'alex', password: 'secret-pw', sessionSecret: 'test-secret' };

async function setup(auth: AuthConfig | null = null, searchSource?: LocationSearchSource) {
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'pyrmap-incidents-route-test-'));
  const fireRepo = new SqliteFireRepository(path.join(tmpDir, 'fires.db'));
  const incidentRepo = new SqliteIncidentReportRepository(path.join(tmpDir, 'incidents.db'));
  incidentRepo.insertIncidentReports([
    {
      externalId: '1',
      source: 'A',
      text: 'Πυρκαγιά στο Χ.',
      url: 'https://x.com/pyrosvestiki/status/1',
      publishedAt: '2026-07-23T10:00:00Z',
      latitude: 38.13,
      longitude: 22.42,
      precision: 'regional_unit',
    },
  ]);
  const [{ id }] = incidentRepo.findIncidentReportsSince('2026-01-01T00:00:00Z');

  const app = await buildApp(
    { logLevel: 'silent' },
    fireRepo,
    undefined,
    '/nonexistent',
    incidentRepo,
    undefined,
    undefined,
    auth,
    undefined,
    undefined,
    undefined,
    searchSource,
  );

  return {
    app,
    id,
    cleanup: () => {
      fireRepo.close();
      incidentRepo.close();
      rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

describe('PATCH /api/incidents/:id/location', () => {
  it('updates coordinates and publishes an update', async () => {
    const { app, id, cleanup } = await setup();
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/incidents/${id}/location`,
      payload: { latitude: 40.73, longitude: 22.92 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id, latitude: 40.73, longitude: 22.92, precision: 'settlement' });
    cleanup();
  });

  it('404s for an unknown id', async () => {
    const { app, cleanup } = await setup();
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/incidents/999999/location',
      payload: { latitude: 1, longitude: 1 },
    });
    expect(response.statusCode).toBe(404);
    cleanup();
  });

  it('400s on a non-finite coordinate', async () => {
    const { app, id, cleanup } = await setup();
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/incidents/${id}/location`,
      payload: { latitude: 'not-a-number', longitude: 1 },
    });
    expect(response.statusCode).toBe(400);
    cleanup();
  });

  it('requires a session when auth is enabled', async () => {
    const { app, id, cleanup } = await setup(AUTH);
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/incidents/${id}/location`,
      payload: { latitude: 1, longitude: 1 },
    });
    expect(response.statusCode).toBe(401);
    cleanup();
  });
});

describe('POST /api/incidents/:id/hide', () => {
  it('hides the report so it no longer appears in /api/fires', async () => {
    const { app, id, cleanup } = await setup();
    const hideResponse = await app.inject({ method: 'POST', url: `/api/incidents/${id}/hide` });
    expect(hideResponse.statusCode).toBe(200);

    const firesResponse = await app.inject({ method: 'GET', url: '/api/fires?hours=168' });
    expect(firesResponse.json().incidents).toEqual([]);
    cleanup();
  });

  it('404s for an unknown id', async () => {
    const { app, cleanup } = await setup();
    const response = await app.inject({ method: 'POST', url: '/api/incidents/999999/hide' });
    expect(response.statusCode).toBe(404);
    cleanup();
  });
});

describe('DELETE /api/incidents/:id', () => {
  it('removes the report entirely', async () => {
    const { app, id, cleanup } = await setup();
    const deleteResponse = await app.inject({ method: 'DELETE', url: `/api/incidents/${id}` });
    expect(deleteResponse.statusCode).toBe(200);

    const firesResponse = await app.inject({ method: 'GET', url: '/api/fires?hours=168' });
    expect(firesResponse.json().incidents).toEqual([]);
    cleanup();
  });

  it('404s for an unknown id', async () => {
    const { app, cleanup } = await setup();
    const response = await app.inject({ method: 'DELETE', url: '/api/incidents/999999' });
    expect(response.statusCode).toBe(404);
    cleanup();
  });
});

describe('GET /api/geocode/search', () => {
  it('returns results from the configured search source', async () => {
    const searchSource: LocationSearchSource = {
      search: vi.fn(async () => [{ displayName: 'Ωραιόκαστρο, Θεσσαλονίκη', latitude: 40.73, longitude: 22.92 }]),
    };
    const { app, cleanup } = await setup(null, searchSource);
    const response = await app.inject({ method: 'GET', url: '/api/geocode/search?q=Ωραιόκαστρο' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      results: [{ displayName: 'Ωραιόκαστρο, Θεσσαλονίκη', latitude: 40.73, longitude: 22.92 }],
    });
    expect(searchSource.search).toHaveBeenCalledWith('Ωραιόκαστρο');
    cleanup();
  });

  it('returns an empty result set when no search source is configured', async () => {
    const { app, cleanup } = await setup();
    const response = await app.inject({ method: 'GET', url: '/api/geocode/search?q=anything' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ results: [] });
    cleanup();
  });

  it('400s on a missing or empty q', async () => {
    const { app, cleanup } = await setup();
    const response = await app.inject({ method: 'GET', url: '/api/geocode/search' });
    expect(response.statusCode).toBe(400);
    cleanup();
  });
});
