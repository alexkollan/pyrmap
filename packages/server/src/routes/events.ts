import type { FastifyInstance } from 'fastify';
import type { UpdateBus } from '../jobs/updateBus.js';

// Keeps the connection alive through proxies/tunnels (e.g. cloudflared) that drop idle streams.
const PING_INTERVAL_MS = 25_000;

/**
 * GET /api/events — Server-Sent Events. Emits a bare "something changed" signal whenever a
 * scheduler job actually inserts new data or changes confirmation/decay state; the browser's job
 * is to refetch /api/fires on receipt, not to parse a payload here. EventSource reconnects on its
 * own if the stream drops, and the existing 5-minute poll stays as a fallback either way.
 */
export function eventsRoutes(updateBus: UpdateBus) {
  return async function registerEventsRoutes(app: FastifyInstance): Promise<void> {
    app.get('/api/events', (request, reply) => {
      reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      reply.raw.write(':ok\n\n');

      const unsubscribe = updateBus.subscribe(() => {
        reply.raw.write('data: refresh\n\n');
      });
      const ping = setInterval(() => reply.raw.write(':ping\n\n'), PING_INTERVAL_MS);

      request.raw.on('close', () => {
        clearInterval(ping);
        unsubscribe();
      });
    });
  };
}
