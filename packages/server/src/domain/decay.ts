import { DECAY_MAX_AGE_HOURS } from '@pyrmap/shared';

const MS_PER_HOUR = 60 * 60 * 1000;

/** True once an unconfirmed geo detection is older than the decay threshold, dev-plan §6.4. */
export function shouldExpire(acquiredAt: string, now: Date): boolean {
  const ageHours = (now.getTime() - new Date(acquiredAt).getTime()) / MS_PER_HOUR;
  return ageHours > DECAY_MAX_AGE_HOURS;
}
