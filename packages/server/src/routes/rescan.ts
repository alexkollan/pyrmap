import type { FastifyInstance } from 'fastify';
import type { Scheduler } from '../jobs/scheduler.js';

interface RescanBody {
  hours?: number;
}

const VALID_HOURS = new Set([6, 12, 24]);

/** POST /api/rescan — triggers a one-off re-check of the given window across every source,
 * registered in the same protected group as /api/fires. `getScheduler` is a getter, not the
 * instance directly, because the scheduler is constructed after the Fastify app in index.ts. */
export function rescanRoutes(getScheduler: () => Scheduler | null) {
  return async function registerRescanRoutes(app: FastifyInstance): Promise<void> {
    app.post<{ Body: RescanBody }>('/api/rescan', async (request, reply) => {
      const hours = request.body?.hours;
      if (typeof hours !== 'number' || !VALID_HOURS.has(hours)) {
        reply.code(400);
        return { error: 'hours must be 6, 12, or 24' };
      }

      const scheduler = getScheduler();
      if (!scheduler) {
        reply.code(503);
        return { error: 'Scheduler not ready' };
      }

      return scheduler.rescan(hours as 6 | 12 | 24);
    });
  };
}
