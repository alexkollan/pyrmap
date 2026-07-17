import type { FastifyInstance } from 'fastify';
import type { StatusResponse } from '@pyrmap/shared';
import type { FireRepository } from '../ports/FireRepository.js';
import { getStatus } from '../services/queryService.js';

/** GET /api/status — dev-plan §7. */
export function statusRoutes(repository: FireRepository, now: () => Date) {
  return async function registerStatusRoutes(app: FastifyInstance): Promise<void> {
    app.get('/api/status', async (): Promise<StatusResponse> => {
      return getStatus(repository, now);
    });
  };
}
