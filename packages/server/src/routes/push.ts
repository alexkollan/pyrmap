import type { FastifyInstance } from 'fastify';
import type { PushSubscriptionPayload } from '@pyrmap/shared';
import type { PushSubscriptionRepository } from '../ports/PushSubscriptionRepository.js';

/** GET /api/push/vapid-public-key — open, same tier as /api/health; public keys aren't sensitive.
 * 404s when VAPID isn't configured, so the frontend can distinguish "not set up" from a real error. */
export function pushPublicRoutes(vapidPublicKey: string | null) {
  return async function registerPushPublicRoutes(app: FastifyInstance): Promise<void> {
    app.get('/api/push/vapid-public-key', async (request, reply) => {
      if (!vapidPublicKey) {
        reply.code(404);
        return { error: 'Push notifications not configured' };
      }
      return { publicKey: vapidPublicKey };
    });
  };
}

/** POST /api/push/subscribe, POST /api/push/unsubscribe — registered in the same protected group
 * as /api/fires, so they require a session when auth is configured (docs/DECISIONS.md 2026-07-22). */
export function pushRoutes(repository: PushSubscriptionRepository) {
  return async function registerPushRoutes(app: FastifyInstance): Promise<void> {
    app.post<{ Body: PushSubscriptionPayload }>('/api/push/subscribe', async (request, reply) => {
      const { endpoint, keys } = request.body ?? ({} as Partial<PushSubscriptionPayload>);
      if (!endpoint || !keys?.p256dh || !keys?.auth) {
        reply.code(400);
        return { ok: false };
      }
      repository.saveSubscription({ endpoint, p256dh: keys.p256dh, auth: keys.auth });
      return { ok: true };
    });

    app.post<{ Body: { endpoint?: string } }>('/api/push/unsubscribe', async (request, reply) => {
      const { endpoint } = request.body ?? {};
      if (!endpoint) {
        reply.code(400);
        return { ok: false };
      }
      repository.deleteSubscription(endpoint);
      return { ok: true };
    });
  };
}
