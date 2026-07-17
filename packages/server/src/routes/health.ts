import type { FastifyInstance } from 'fastify';
import type { HealthResponse } from '@pyrmap/shared';

/** GET /api/health — 200 {ok:true} if reachable. DB check wired in once the repository exists (M2). */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async (): Promise<HealthResponse> => {
    return { ok: true };
  });
}
