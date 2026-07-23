import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/app.js';
import { SqliteFireRepository } from '../src/adapters/sqlite/SqliteFireRepository.js';
import type { AuthConfig } from '../src/routes/auth.js';

const AUTH: AuthConfig = { username: 'alex', password: 'secret-pw', sessionSecret: 'test-secret' };

async function setup() {
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'pyrmap-security-test-'));
  const repo = new SqliteFireRepository(path.join(tmpDir, 'test.db'));
  const app = await buildApp({ logLevel: 'silent' }, repo, undefined, '/nonexistent', undefined, undefined, AUTH);
  return {
    app,
    cleanup: () => {
      repo.close();
      rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

describe('security headers', () => {
  it('sends a Content-Security-Policy header', async () => {
    const { app, cleanup } = await setup();
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
    cleanup();
  });
});

describe('login rate limiting', () => {
  it('returns 429 after too many login attempts from the same client', async () => {
    const { app, cleanup } = await setup();
    let lastStatus = 200;
    for (let i = 0; i < 10; i++) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/login',
        payload: { username: 'wrong', password: 'wrong' },
      });
      lastStatus = response.statusCode;
    }
    expect(lastStatus).toBe(429);
    cleanup();
  });
});
