import cron, { type ScheduledTask } from 'node-cron';
import { GREECE_BBOX_STRING, type Tier } from '@pyrmap/shared';
import { ingestSource } from '../services/ingestService.js';
import type { FireDataSource } from '../ports/FireDataSource.js';
import type { FireRepository } from '../ports/FireRepository.js';

const DAY_RANGE = 1;

export interface SchedulerDeps {
  dataSource: FireDataSource;
  repository: FireRepository;
  effectiveSources: Record<string, Tier>;
  now?: () => Date;
  onLog?: (message: string) => void;
}

export interface Scheduler {
  stop: () => void;
  pollGeo: () => Promise<void>;
  pollPolar: () => Promise<void>;
}

/** Registers the geo (every 10 min) and polar (every 30 min) poll jobs, dev-plan §5. Runs both once immediately. */
export function startScheduler(deps: SchedulerDeps): Scheduler {
  const now = deps.now ?? (() => new Date());
  const geoSourceIds = Object.entries(deps.effectiveSources)
    .filter(([, tier]) => tier === 'geo')
    .map(([id]) => id);
  const polarSourceIds = Object.entries(deps.effectiveSources)
    .filter(([, tier]) => tier === 'polar')
    .map(([id]) => id);

  const ingestOne = (sourceId: string, tier: Tier): Promise<void> =>
    ingestSource({
      dataSource: deps.dataSource,
      repository: deps.repository,
      sourceId,
      tier,
      bboxString: GREECE_BBOX_STRING,
      dayRange: DAY_RANGE,
      now,
      onLog: deps.onLog,
    }).then(() => undefined);

  async function pollGeo(): Promise<void> {
    for (const sourceId of geoSourceIds) {
      await ingestOne(sourceId, 'geo');
    }
  }

  async function pollPolar(): Promise<void> {
    for (const sourceId of polarSourceIds) {
      await ingestOne(sourceId, 'polar');
    }
  }

  const tasks: ScheduledTask[] = [
    cron.schedule('*/10 * * * *', () => void pollGeo()),
    cron.schedule('*/30 * * * *', () => void pollPolar()),
  ];

  void pollGeo();
  void pollPolar();

  return {
    stop: () => tasks.forEach((task) => task.stop()),
    pollGeo,
    pollPolar,
  };
}
