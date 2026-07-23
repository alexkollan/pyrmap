import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { SqliteFireRepository } from '../src/adapters/sqlite/SqliteFireRepository.js';
import type { AuthConfig } from '../src/routes/auth.js';

const AUTH: AuthConfig = { username: 'alex', password: 'secret-pw', sessionSecret: 'test-secret' };

let tmpDir: string;
let repo: SqliteFireRepository;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'pyrmap-auth-test-'));
  repo = new SqliteFireRepository(path.join(tmpDir, 'test.db'));
});

afterEach(() => {
  repo.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

function sessionCookie(setCookieHeader: string | string[] | undefined): string {
  const raw = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
  return raw!.split(';')[0]!;
}

describe('auth (disabled — the default)', () => {
  it('leaves /api/fires open when no auth config is passed', async () => {
    const app = await buildApp({ logLevel: 'silent' }, repo, undefined, '/nonexistent');
    const response = await app.inject({ method: 'GET', url: '/api/fires?hours=24' });
    expect(response.statusCode).toBe(200);
  });
});

describe('auth (enabled)', () => {
  it('leaves /api/fires and /api/status open even with auth configured — only Re-scan/Edit-pins/push are gated (see test/publicAccess.test.ts)', async () => {
    const app = await buildApp({ logLevel: 'silent' }, repo, undefined, '/nonexistent', undefined, undefined, undefined, AUTH);
    const fires = await app.inject({ method: 'GET', url: '/api/fires?hours=24' });
    expect(fires.statusCode).toBe(200);
    const status = await app.inject({ method: 'GET', url: '/api/status' });
    expect(status.statusCode).toBe(200);
  });

  it('/api/health stays reachable regardless of auth (Docker healthcheck needs this)', async () => {
    const app = await buildApp({ logLevel: 'silent' }, repo, undefined, '/nonexistent', undefined, undefined, undefined, AUTH);
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
  });

  it('rejects login with the wrong password', async () => {
    const app = await buildApp({ logLevel: 'silent' }, repo, undefined, '/nonexistent', undefined, undefined, undefined, AUTH);
    const response = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: 'alex', password: 'wrong' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('logs in with correct credentials, then /api/me reflects the resulting cookie as authenticated', async () => {
    const app = await buildApp({ logLevel: 'silent' }, repo, undefined, '/nonexistent', undefined, undefined, undefined, AUTH);

    const login = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: 'alex', password: 'secret-pw' },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json()).toEqual({ ok: true });
    const cookie = sessionCookie(login.headers['set-cookie']);

    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    expect(me.json()).toEqual({ authenticated: true });
  });

  it('/api/me reports unauthenticated with no cookie, without erroring', async () => {
    const app = await buildApp({ logLevel: 'silent' }, repo, undefined, '/nonexistent', undefined, undefined, undefined, AUTH);
    const response = await app.inject({ method: 'GET', url: '/api/me' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ authenticated: false });
  });

  it('logout clears the session so the previously-valid cookie no longer authenticates', async () => {
    // Probes via /api/me (not /api/fires, which is public regardless of session — see
    // publicAccess.test.ts) since that's the endpoint actually designed to report auth state.
    const app = await buildApp({ logLevel: 'silent' }, repo, undefined, '/nonexistent', undefined, undefined, undefined, AUTH);

    const login = await app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { username: 'alex', password: 'secret-pw' },
    });
    const cookie = sessionCookie(login.headers['set-cookie']);

    const beforeLogout = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    expect(beforeLogout.json()).toEqual({ authenticated: true });

    const logout = await app.inject({ method: 'POST', url: '/api/logout', headers: { cookie } });
    expect(logout.statusCode).toBe(200);
    const clearedCookie = sessionCookie(logout.headers['set-cookie']);
    expect(clearedCookie).toBe('pyrmap_session=');

    const afterLogout = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie: clearedCookie } });
    expect(afterLogout.json()).toEqual({ authenticated: false });
  });
});
