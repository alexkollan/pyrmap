import type { FastifyInstance } from 'fastify';
import type { CivilProtectionAlert } from '@pyrmap/shared';
import type { CivilProtectionAlertRepository } from '../ports/CivilProtectionAlertRepository.js';
import type { UpdateBus } from '../jobs/updateBus.js';

interface IdParams {
  id: number;
}

interface LocationBody {
  latitude: number;
  longitude: number;
}

/**
 * Manual correction for mis-geocoded 112 alerts — same shape and semantics as
 * routes/incidents.ts's incidentEditRoutes (see its doc comment and
 * docs/superpowers/specs/2026-07-23-incident-pin-correction-design.md for hide vs. delete).
 */
export function alertEditRoutes(repository: CivilProtectionAlertRepository, updateBus: UpdateBus) {
  return async function registerAlertEditRoutes(app: FastifyInstance): Promise<void> {
    app.patch<{ Params: IdParams; Body: LocationBody }>(
      '/api/alerts/:id/location',
      {
        schema: {
          params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
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
        const updated = repository.updateAlertLocation(id, latitude, longitude);
        if (!updated) {
          reply.code(404);
          return { error: 'Not Found' };
        }
        updateBus.publish();
        const [alert] = repository.findAlertsSince('1970-01-01T00:00:00Z').filter((a) => a.id === id);
        return alert as CivilProtectionAlert;
      },
    );

    app.post<{ Params: IdParams }>(
      '/api/alerts/:id/hide',
      { schema: { params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] } } },
      async (request, reply) => {
        const hidden = repository.hideAlert(request.params.id);
        if (!hidden) {
          reply.code(404);
          return { error: 'Not Found' };
        }
        updateBus.publish();
        return { ok: true };
      },
    );

    app.delete<{ Params: IdParams }>(
      '/api/alerts/:id',
      { schema: { params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] } } },
      async (request, reply) => {
        const deleted = repository.deleteAlert(request.params.id);
        if (!deleted) {
          reply.code(404);
          return { error: 'Not Found' };
        }
        updateBus.publish();
        return { ok: true };
      },
    );
  };
}
