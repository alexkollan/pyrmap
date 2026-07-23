import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
// New dependency, outside the historically closed list — explicit user request for security
// hardening now that the app is public (docs/DECISIONS.md 2026-07-23). Official Fastify-team
// package, MIT licensed.
import fastifyHelmet from '@fastify/helmet';
// Same justification as fastifyHelmet above.
import fastifyRateLimit from '@fastify/rate-limit';
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
import { incidentEditRoutes } from './routes/incidents.js';
import type { LocationSearchSource } from './ports/LocationSearchSource.js';
import type { Scheduler } from './jobs/scheduler.js';
import { UpdateBus } from './jobs/updateBus.js';

// dist/app.js -> ../public is /app/public in the runtime image (Dockerfile copies web's build there).
const DEFAULT_PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public');

/** Builds a Fastify instance without starting the listener — used by both index.ts and tests.
 * `auth` is null for open access (local dev default). When set: /api/fires, /api/status, and
 * /api/events stay public (viewing the map needs no login); /api/rescan, the incident-edit
 * routes, and /api/push/subscribe|unsubscribe require a valid session cookie. /api/health,
 * /api/login, /api/logout, /api/me, /api/push/vapid-public-key, and the static frontend itself
 * stay reachable either way. */
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
  locationSearchSource?: LocationSearchSource,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: config.logLevel }, trustProxy: true });

  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://www.googletagmanager.com'],
        connectSrc: [
          "'self'",
          'https://www.google-analytics.com',
          'https://*.google-analytics.com',
          'https://*.analytics.google.com',
          'https://api.open-meteo.com',
        ],
        // CARTO's Leaflet tile URLs use randomized subdomains ({s} -> a/b/c.basemaps.cartocdn.com,
        // for parallel loading across per-host connection limits) — a bare host with no wildcard
        // silently blocks every actual tile request. Caught live via a real browser CSP-violation
        // check (docs/DECISIONS.md 2026-07-23), not assumed.
        //
        // googletagmanager.com is ALSO needed here, not just in scriptSrc: gtag.js makes its own
        // image-pixel requests to paths like /a and /td (separate from the initial gtag/js script
        // fetch) as part of completing its internal config/init sequence — without this, GA4 never
        // finishes initializing and silently never sends any hit at all, no console error from our
        // own testing ever surfaced it; only Google's own Tag Assistant console log did
        // (docs/DECISIONS.md 2026-07-23).
        imgSrc: [
          "'self'",
          'data:',
          'https://*.basemaps.cartocdn.com',
          'https://maps.effis.emergency.copernicus.eu',
          'https://www.googletagmanager.com',
        ],
        styleSrc: ["'self'", "'unsafe-inline'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'self'"],
      },
    },
  });
  await app.register(fastifyRateLimit, { max: 100, timeWindow: '1 minute' });

  await app.register(healthRoutes(repository));
  await app.register(pushPublicRoutes(vapidPublicKey ?? null));
  if (auth) {
    await app.register(authRoutes(auth));
  }

  await app.register(async (publicApp) => {
    await publicApp.register(firesRoutes(repository, now, incidentRepository));
    await publicApp.register(statusRoutes(repository, now));
    await publicApp.register(eventsRoutes(updateBus));
  });

  await app.register(async (adminApp) => {
    if (auth) {
      adminApp.addHook('onRequest', requireAuth(auth.sessionSecret));
    }
    if (pushSubscriptionRepository) {
      await adminApp.register(pushRoutes(pushSubscriptionRepository));
    }
    if (getScheduler) {
      await adminApp.register(rescanRoutes(getScheduler));
    }
    if (incidentRepository) {
      await adminApp.register(incidentEditRoutes(incidentRepository, locationSearchSource, updateBus));
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
