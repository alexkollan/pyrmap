import type { FastifyInstance } from 'fastify';
import type { HealthResponse } from '@pyrmap/shared';
import type { FireRepository } from '../ports/FireRepository.js';

/** GET /api/health — 200 {ok:true} iff `SELECT 1` succeeds against the repository. */
export function healthRoutes(repository: FireRepository) {
  return async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
    app.get('/api/health', async (): Promise<HealthResponse> => {
      return { ok: repository.healthCheck() };
    });
  };
}
