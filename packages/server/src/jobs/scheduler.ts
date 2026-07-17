import cron, { type ScheduledTask } from 'node-cron';
import { GREECE_BBOX_STRING, type Tier } from '@pyrmap/shared';
import { ingestSource } from '../services/ingestService.js';
import { runConfirmationPass } from '../services/confirmationService.js';
import { runDecayPass } from '../services/decayService.js';
import { runRetention } from '../services/retentionService.js';
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
  decay: () => void;
  retention: () => void;
}

/**
 * Registers dev-plan §5's jobs: poll-geo (10min), poll-polar (30min, then a confirmation pass),
 * decay (10min), retention (daily 03:00 UTC). Runs poll-geo and poll-polar once immediately.
 */
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
    const { confirmed } = runConfirmationPass(deps.repository, now);
    if (confirmed > 0) {
      deps.onLog?.(`confirmation pass: confirmed=${confirmed}`);
    }
  }

  function decay(): void {
    const { expired } = runDecayPass(deps.repository, now);
    if (expired > 0) {
      deps.onLog?.(`decay pass: expired=${expired}`);
    }
  }

  function retention(): void {
    const { deletedDetections, deletedFetchLogs } = runRetention(deps.repository, now);
    deps.onLog?.(`retention: deletedDetections=${deletedDetections} deletedFetchLogs=${deletedFetchLogs}`);
  }

  const tasks: ScheduledTask[] = [
    cron.schedule('*/10 * * * *', () => void pollGeo()),
    cron.schedule('*/30 * * * *', () => void pollPolar()),
    cron.schedule('*/10 * * * *', decay),
    cron.schedule('0 3 * * *', retention),
  ];

  void pollGeo();
  void pollPolar();

  return {
    stop: () => tasks.forEach((task) => task.stop()),
    pollGeo,
    pollPolar,
    decay,
    retention,
  };
}
