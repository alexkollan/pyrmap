import type { FastifyInstance } from 'fastify';
import type { IncidentReport } from '@pyrmap/shared';
import type { IncidentReportRepository } from '../ports/IncidentReportRepository.js';
import type { LocationSearchSource } from '../ports/LocationSearchSource.js';
import type { UpdateBus } from '../jobs/updateBus.js';

interface IdParams {
  id: number;
}

interface LocationBody {
  latitude: number;
  longitude: number;
}

interface SearchQuery {
  q: string;
}

/**
 * Manual correction for mis-geocoded incident reports (docs/superpowers/specs/2026-07-23-incident-pin-correction-design.md):
 * reposition a pin (drag/manual entry/search-pick all funnel into the PATCH below), or remove one
 * — hidden forever (its external_id keeps blocking re-insertion) or deleted forever (re-insertable
 * by a future rescan). Every mutation publishes an update so connected clients refetch via the
 * existing SSE mechanism (see jobs/updateBus.ts) — no bespoke frontend state needed.
 */
export function incidentEditRoutes(
  repository: IncidentReportRepository,
  searchSource: LocationSearchSource | undefined,
  updateBus: UpdateBus,
) {
  return async function registerIncidentEditRoutes(app: FastifyInstance): Promise<void> {
    app.patch<{ Params: IdParams; Body: LocationBody }>(
      '/api/incidents/:id/location',
      {
        schema: {
          params: {
            type: 'object',
            properties: { id: { type: 'integer' } },
            required: ['id'],
          },
          body: {
            type: 'object',
            properties: {
              latitude: { type: 'number', minimum: -90, maximum: 90 },
              longitude: { type: 'number', minimum: -180, maximum: 180 },
            },
            required: ['latitude', 'longitude'],
            additionalProperties: false,
          },
        },
      },
      async (request, reply) => {
        const { id } = request.params;
        const { latitude, longitude } = request.body;
        const updated = repository.updateIncidentReportLocation(id, latitude, longitude);
        if (!updated) {
          reply.code(404);
          return { error: 'Not Found' };
        }
        updateBus.publish();
        const [report] = repository.findIncidentReportsSince('1970-01-01T00:00:00Z').filter((r) => r.id === id);
        return report as IncidentReport;
      },
    );

    app.post<{ Params: IdParams }>(
      '/api/incidents/:id/hide',
      { schema: { params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] } } },
      async (request, reply) => {
        const hidden = repository.hideIncidentReport(request.params.id);
        if (!hidden) {
          reply.code(404);
          return { error: 'Not Found' };
        }
        updateBus.publish();
        return { ok: true };
      },
    );

    app.delete<{ Params: IdParams }>(
      '/api/incidents/:id',
      { schema: { params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] } } },
      async (request, reply) => {
        const deleted = repository.deleteIncidentReport(request.params.id);
        if (!deleted) {
          reply.code(404);
          return { error: 'Not Found' };
        }
        updateBus.publish();
        return { ok: true };
      },
    );

    app.get<{ Querystring: SearchQuery }>(
      '/api/geocode/search',
      {
        schema: {
          querystring: {
            type: 'object',
            properties: { q: { type: 'string', minLength: 1 } },
            required: ['q'],
            additionalProperties: false,
          },
        },
      },
      async (request) => {
        const results = searchSource ? await searchSource.search(request.query.q) : [];
        return { results };
      },
    );
  };
}
