import {
  boundingBoxAround,
  CONFIRMATION_BBOX_MARGIN_DEG,
  CONFIRMATION_ELIGIBILITY_HOURS,
  CONFIRMATION_MAX_TIME_HOURS,
} from '@pyrmap/shared';
import { findConfirmation } from '../domain/confirmation.js';
import type { FireRepository } from '../ports/FireRepository.js';

const MS_PER_HOUR = 60 * 60 * 1000;

export interface ConfirmationResult {
  confirmed: number;
}

/** Runs after every polar ingest, dev-plan §6.3: tries to corroborate each recent unconfirmed geo detection. */
export function runConfirmationPass(repository: FireRepository, now: () => Date): ConfirmationResult {
  const nowDate = now();
  const eligibleSince = new Date(nowDate.getTime() - CONFIRMATION_ELIGIBILITY_HOURS * MS_PER_HOUR).toISOString();
  const unconfirmedGeo = repository.findUnconfirmedGeoDetections(eligibleSince);

  let confirmed = 0;
  for (const geo of unconfirmedGeo) {
    const bbox = boundingBoxAround(geo.latitude, geo.longitude, CONFIRMATION_BBOX_MARGIN_DEG);
    const geoTimeMs = new Date(geo.acquiredAt).getTime();
    const fromIso = new Date(geoTimeMs - CONFIRMATION_MAX_TIME_HOURS * MS_PER_HOUR).toISOString();
    const toIso = new Date(geoTimeMs + CONFIRMATION_MAX_TIME_HOURS * MS_PER_HOUR).toISOString();

    const candidates = repository.findPolarCandidatesNear(bbox, fromIso, toIso);
    const match = findConfirmation(geo, candidates);
    if (match) {
      repository.confirmGeoDetection(geo.id, match.id, nowDate.toISOString());
      confirmed++;
    }
  }

  return { confirmed };
}
