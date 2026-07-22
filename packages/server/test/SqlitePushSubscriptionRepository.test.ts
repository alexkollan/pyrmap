import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqlitePushSubscriptionRepository } from '../src/adapters/sqlite/SqlitePushSubscriptionRepository.js';

let tmpDir: string;
let repo: SqlitePushSubscriptionRepository;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'pyrmap-push-test-'));
  repo = new SqlitePushSubscriptionRepository(path.join(tmpDir, 'test.db'));
});

afterEach(() => {
  repo.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('SqlitePushSubscriptionRepository', () => {
  it('saves a subscription and lists it back', () => {
    repo.saveSubscription({ endpoint: 'https://push.example/abc', p256dh: 'p256dh-key', auth: 'auth-key' });
    expect(repo.listSubscriptions()).toEqual([
      { endpoint: 'https://push.example/abc', p256dh: 'p256dh-key', auth: 'auth-key' },
    ]);
  });

  it('re-saving the same endpoint updates its keys instead of duplicating the row', () => {
    repo.saveSubscription({ endpoint: 'https://push.example/abc', p256dh: 'old', auth: 'old' });
    repo.saveSubscription({ endpoint: 'https://push.example/abc', p256dh: 'new', auth: 'new' });
    const all = repo.listSubscriptions();
    expect(all).toHaveLength(1);
    expect(all[0]).toEqual({ endpoint: 'https://push.example/abc', p256dh: 'new', auth: 'new' });
  });

  it('deletes a subscription by endpoint', () => {
    repo.saveSubscription({ endpoint: 'https://push.example/abc', p256dh: 'k', auth: 'a' });
    repo.deleteSubscription('https://push.example/abc');
    expect(repo.listSubscriptions()).toEqual([]);
  });
});
