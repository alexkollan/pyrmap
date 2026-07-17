import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import type { Config } from './config.js';
import type { FireRepository } from './ports/FireRepository.js';
import { healthRoutes } from './routes/health.js';
import { firesRoutes } from './routes/fires.js';
import { statusRoutes } from './routes/status.js';

// dist/app.js -> ../public is /app/public in the runtime image (Dockerfile copies web's build there).
const DEFAULT_PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public');

/** Builds a Fastify instance without starting the listener — used by both index.ts and tests. */
export async function buildApp(
  config: Pick<Config, 'logLevel'>,
  repository: FireRepository,
  now: () => Date = () => new Date(),
  publicDir: string = DEFAULT_PUBLIC_DIR,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: config.logLevel } });

  await app.register(healthRoutes(repository));
  await app.register(firesRoutes(repository, now));
  await app.register(statusRoutes(repository, now));

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
