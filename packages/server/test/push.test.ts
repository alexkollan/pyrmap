import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { SqliteFireRepository } from '../src/adapters/sqlite/SqliteFireRepository.js';
import { SqlitePushSubscriptionRepository } from '../src/adapters/sqlite/SqlitePushSubscriptionRepository.js';
import type { AuthConfig } from '../src/routes/auth.js';

const AUTH: AuthConfig = { username: 'alex', password: 'secret-pw', sessionSecret: 'test-secret' };

let tmpDir: string;
let fireRepo: SqliteFireRepository;
let pushRepo: SqlitePushSubscriptionRepository;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'pyrmap-push-routes-test-'));
  fireRepo = new SqliteFireRepository(path.join(tmpDir, 'test.db'));
  pushRepo = new SqlitePushSubscriptionRepository(path.join(tmpDir, 'test.db'));
});

afterEach(() => {
  fireRepo.close();
  pushRepo.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('GET /api/push/vapid-public-key', () => {
  it('returns the configured public key', async () => {
    const app = await buildApp(
      { logLevel: 'silent' },
      fireRepo,
      undefined,
      '/nonexistent',
      undefined,
      undefined,
      undefined,
      undefined,
      pushRepo,
      'test-public-key',
    );
    const response = await app.inject({ method: 'GET', url: '/api/push/vapid-public-key' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ publicKey: 'test-public-key' });
  });

  it('404s when push notifications are not configured', async () => {
    const app = await buildApp(
      { logLevel: 'silent' },
      fireRepo,
      undefined,
      '/nonexistent',
      undefined,
      undefined,
      undefined,
      undefined,
      pushRepo,
      null,
    );
    const response = await app.inject({ method: 'GET', url: '/api/push/vapid-public-key' });
    expect(response.statusCode).toBe(404);
  });

  it('stays reachable without a session even when auth is enabled', async () => {
    const app = await buildApp(
      { logLevel: 'silent' },
      fireRepo,
      undefined,
      '/nonexistent',
      undefined,
      undefined,
      undefined,
      AUTH,
      pushRepo,
      'test-public-key',
    );
    const response = await app.inject({ method: 'GET', url: '/api/push/vapid-public-key' });
    expect(response.statusCode).toBe(200);
  });
});

describe('POST /api/push/subscribe and /api/push/unsubscribe', () => {
  it('saves and then removes a subscription', async () => {
    const app = await buildApp(
      { logLevel: 'silent' },
      fireRepo,
      undefined,
      '/nonexistent',
      undefined,
      undefined,
      undefined,
      undefined,
      pushRepo,
      'test-public-key',
    );

    const subscribe = await app.inject({
      method: 'POST',
      url: '/api/push/subscribe',
      payload: { endpoint: 'https://push.example/x', keys: { p256dh: 'p', auth: 'a' } },
    });
    expect(subscribe.statusCode).toBe(200);
    expect(pushRepo.listSubscriptions()).toEqual([{ endpoint: 'https://push.example/x', p256dh: 'p', auth: 'a' }]);

    const unsubscribe = await app.inject({
      method: 'POST',
      url: '/api/push/unsubscribe',
      payload: { endpoint: 'https://push.example/x' },
    });
    expect(unsubscribe.statusCode).toBe(200);
    expect(pushRepo.listSubscriptions()).toEqual([]);
  });

  it('requires a session when auth is enabled', async () => {
    const app = await buildApp(
      { logLevel: 'silent' },
      fireRepo,
      undefined,
      '/nonexistent',
      undefined,
      undefined,
      undefined,
      AUTH,
      pushRepo,
      'test-public-key',
    );
    const response = await app.inject({
      method: 'POST',
      url: '/api/push/subscribe',
      payload: { endpoint: 'https://push.example/x', keys: { p256dh: 'p', auth: 'a' } },
    });
    expect(response.statusCode).toBe(401);
  });
});
