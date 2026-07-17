import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import type { FireRepository } from './ports/FireRepository.js';
import { healthRoutes } from './routes/health.js';
import { firesRoutes } from './routes/fires.js';
import { statusRoutes } from './routes/status.js';

/** Builds a Fastify instance without starting the listener — used by both index.ts and tests. */
export async function buildApp(
  config: Pick<Config, 'logLevel'>,
  repository: FireRepository,
  now: () => Date = () => new Date(),
): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: config.logLevel } });

  await app.register(healthRoutes(repository));
  await app.register(firesRoutes(repository, now));
  await app.register(statusRoutes(repository, now));

  return app;
}
