import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SqlitePushSubscriptionRepository } from '../src/adapters/sqlite/SqlitePushSubscriptionRepository.js';
import { notifyNewAlerts, notifyNewDetections, notifyNewIncidents } from '../src/services/pushNotificationService.js';

let tmpDir: string;
let repo: SqlitePushSubscriptionRepository;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'pyrmap-pushsvc-test-'));
  repo = new SqlitePushSubscriptionRepository(path.join(tmpDir, 'test.db'));
});

afterEach(() => {
  repo.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('notifyNewDetections', () => {
  it('sends one payload per subscription per detection', async () => {
    repo.saveSubscription({ endpoint: 'https://push.example/a', p256dh: 'p', auth: 'a' });
    repo.saveSubscription({ endpoint: 'https://push.example/b', p256dh: 'p', auth: 'a' });
    const send = vi.fn().mockResolvedValue(undefined);

    await notifyNewDetections(
      repo,
      [{ tier: 'polar' as const, latitude: 37.7144, longitude: 24.0565 } as never],
      undefined,
      send,
    );

    expect(send).toHaveBeenCalledTimes(2);
    const [subscription, payload] = send.mock.calls[0]!;
    expect(subscription).toEqual({ endpoint: 'https://push.example/a', keys: { p256dh: 'p', auth: 'a' } });
    expect(JSON.parse(payload as string).title).toBe('🔥 Confirmed detection');
  });

  it('prunes a subscription the push service reports as gone (410)', async () => {
    repo.saveSubscription({ endpoint: 'https://push.example/gone', p256dh: 'p', auth: 'a' });
    const send = vi.fn().mockRejectedValue(Object.assign(new Error('gone'), { statusCode: 410 }));

    await notifyNewDetections(repo, [{ tier: 'geo' as const, latitude: 0, longitude: 0 } as never], undefined, send);

    expect(repo.listSubscriptions()).toEqual([]);
  });

  it('keeps a subscription and just logs on a non-gone failure', async () => {
    repo.saveSubscription({ endpoint: 'https://push.example/flaky', p256dh: 'p', auth: 'a' });
    const send = vi.fn().mockRejectedValue(new Error('network error'));
    const onLog = vi.fn();

    await notifyNewDetections(repo, [{ tier: 'geo' as const, latitude: 0, longitude: 0 } as never], onLog, send);

    expect(repo.listSubscriptions()).toHaveLength(1);
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('network error'));
  });
});

describe('notifyNewIncidents', () => {
  it('sends one payload per subscription per incident report', async () => {
    repo.saveSubscription({ endpoint: 'https://push.example/a', p256dh: 'p', auth: 'a' });
    const send = vi.fn().mockResolvedValue(undefined);

    await notifyNewIncidents(
      repo,
      [{ text: 'Κατεσβέσθη πυρκαγιά.', latitude: 0, longitude: 0 } as never],
      undefined,
      send,
    );

    expect(send).toHaveBeenCalledTimes(1);
    const [, payload] = send.mock.calls[0]!;
    expect(JSON.parse(payload as string).title).toBe('📢 Reported fire (X)');
  });
});

describe('notifyNewAlerts', () => {
  it('sends one payload per subscription per alert', async () => {
    repo.saveSubscription({ endpoint: 'https://push.example/a', p256dh: 'p', auth: 'a' });
    const send = vi.fn().mockResolvedValue(undefined);

    await notifyNewAlerts(repo, [{ text: 'Πυρκαγιά στην περιοχή #Δερβένι.', latitude: 0, longitude: 0 } as never], undefined, send);

    expect(send).toHaveBeenCalledTimes(1);
    const [, payload] = send.mock.calls[0]!;
    expect(JSON.parse(payload as string).title).toBe('🚨 112 Alert');
  });
});
