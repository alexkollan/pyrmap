import type { FastifyInstance } from 'fastify';
import type { FiresResponse } from '@pyrmap/shared';
import type { FireRepository } from '../ports/FireRepository.js';
import type { IncidentReportRepository } from '../ports/IncidentReportRepository.js';
import { getFires } from '../services/queryService.js';

interface FiresQuery {
  hours: number;
  includeExpired: boolean;
}

/** GET /api/fires?hours=&includeExpired= — dev-plan §7. Fastify's schema coercion handles bad params -> 400. */
export function firesRoutes(repository: FireRepository, now: () => Date, incidentRepository?: IncidentReportRepository) {
  return async function registerFiresRoutes(app: FastifyInstance): Promise<void> {
    app.get<{ Querystring: FiresQuery }>(
      '/api/fires',
      {
        schema: {
          querystring: {
            type: 'object',
            properties: {
              hours: { type: 'integer', minimum: 1, maximum: 168, default: 24 },
              includeExpired: { type: 'boolean', default: false },
            },
            additionalProperties: false,
          },
        },
      },
      async (request): Promise<FiresResponse> => {
        return getFires(
          repository,
          {
            hours: request.query.hours,
            includeExpired: request.query.includeExpired,
            now,
          },
          incidentRepository,
        );
      },
    );
  };
}
