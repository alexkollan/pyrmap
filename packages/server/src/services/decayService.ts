import { shouldExpire } from '../domain/decay.js';
import type { FireRepository } from '../ports/FireRepository.js';

export interface DecayResult {
  expired: number;
}

/** Runs every 10 min, dev-plan §6.4: expires unconfirmed geo detections older than the decay threshold. */
export function runDecayPass(repository: FireRepository, now: () => Date): DecayResult {
  const nowDate = now();
  const unconfirmedGeo = repository.findUnconfirmedGeoDetections();
  const expiredIds = unconfirmedGeo.filter((d) => shouldExpire(d.acquiredAt, nowDate)).map((d) => d.id);

  if (expiredIds.length > 0) {
    repository.expireGeoDetections(expiredIds, nowDate.toISOString());
  }

  return { expired: expiredIds.length };
}
