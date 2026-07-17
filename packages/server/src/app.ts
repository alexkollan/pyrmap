import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import type { FireRepository } from './ports/FireRepository.js';
import { healthRoutes } from './routes/health.js';

/** Builds a Fastify instance without starting the listener — used by both index.ts and tests. */
export async function buildApp(
  config: Pick<Config, 'logLevel'>,
  repository: FireRepository,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: config.logLevel } });

  await app.register(healthRoutes(repository));

  return app;
}
