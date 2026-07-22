import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import type { Config } from './config.js';
import type { FireRepository } from './ports/FireRepository.js';
import type { IncidentReportRepository } from './ports/IncidentReportRepository.js';
import type { PushSubscriptionRepository } from './ports/PushSubscriptionRepository.js';
import { healthRoutes } from './routes/health.js';
import { firesRoutes } from './routes/fires.js';
import { statusRoutes } from './routes/status.js';
import { eventsRoutes } from './routes/events.js';
import { authRoutes, requireAuth, type AuthConfig } from './routes/auth.js';
import { pushPublicRoutes, pushRoutes } from './routes/push.js';
import { rescanRoutes } from './routes/rescan.js';
import type { Scheduler } from './jobs/scheduler.js';
import { UpdateBus } from './jobs/updateBus.js';

// dist/app.js -> ../public is /app/public in the runtime image (Dockerfile copies web's build there).
const DEFAULT_PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public');

/** Builds a Fastify instance without starting the listener — used by both index.ts and tests.
 * `auth` is null for open access (local dev default); when set, /api/fires, /api/status, and
 * /api/events require a valid session cookie. /api/health, /api/login, /api/logout, /api/me, and
 * the static frontend itself (so the SPA can render a login form) stay reachable either way. */
export async function buildApp(
  config: Pick<Config, 'logLevel'>,
  repository: FireRepository,
  now: () => Date = () => new Date(),
  publicDir: string = DEFAULT_PUBLIC_DIR,
  incidentRepository?: IncidentReportRepository,
  updateBus: UpdateBus = new UpdateBus(),
  auth: AuthConfig | null = null,
  pushSubscriptionRepository?: PushSubscriptionRepository,
  vapidPublicKey?: string | null,
  getScheduler?: () => Scheduler | null,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: config.logLevel } });

  await app.register(healthRoutes(repository));
  await app.register(pushPublicRoutes(vapidPublicKey ?? null));
  if (auth) {
    await app.register(authRoutes(auth));
  }

  await app.register(async (protectedApp) => {
    if (auth) {
      protectedApp.addHook('onRequest', requireAuth(auth.sessionSecret));
    }
    await protectedApp.register(firesRoutes(repository, now, incidentRepository));
    await protectedApp.register(statusRoutes(repository, now));
    await protectedApp.register(eventsRoutes(updateBus));
    if (pushSubscriptionRepository) {
      await protectedApp.register(pushRoutes(pushSubscriptionRepository));
    }
    if (getScheduler) {
      await protectedApp.register(rescanRoutes(getScheduler));
    }
  });

  // Serves the built frontend, dev-plan §10.1 pt 3. Skipped if the frontend hasn't been built (e.g. server-only dev).
  if (existsSync(publicDir)) {
    await app.register(fastifyStatic, { root: publicDir });
    app.setNotFoundHandler((request, reply) => {
      if (request.raw.url?.startsWith('/api')) {
        reply.code(404).send({ error: 'Not Found' });
        return;
      }
      reply.sendFile('index.html');
    });
  }

  return app;
}
