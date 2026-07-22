import cron, { type ScheduledTask } from 'node-cron';
import { GREECE_BBOX_STRING, type Tier } from '@pyrmap/shared';
import { ingestSource } from '../services/ingestService.js';
import { ingestFireAlerts, type AlertSourceConfig } from '../services/alertIngestService.js';
import { ingestIncidentReports } from '../services/incidentIngestService.js';
import { runConfirmationPass } from '../services/confirmationService.js';
import { runDecayPass } from '../services/decayService.js';
import { runRetention } from '../services/retentionService.js';
import type { FireAlertSource } from '../ports/FireAlertSource.js';
import type { FireDataSource } from '../ports/FireDataSource.js';
import type { FireRepository, InsertedDetection } from '../ports/FireRepository.js';
import type { IncidentSource } from '../ports/IncidentSource.js';
import type { IncidentReportRepository, NewIncidentReportRow } from '../ports/IncidentReportRepository.js';
import type { GeocodingSource } from '../ports/GeocodingSource.js';

// FIRMS dayRange counts UTC *calendar* days (1 = today only), not trailing 24h — verified live
// 2026-07-18: with 1, a 23:20 UTC pass vanishes right after midnight. 2 keeps a full trailing day
// visible; dedup_key makes the overlap free.
const DAY_RANGE = 2;

export interface SchedulerDeps {
  dataSource: FireDataSource;
  repository: FireRepository;
  effectiveSources: Record<string, Tier>;
  /** Optional geostationary fire-alert feeds (EUMETSAT MTG, LSA SAF MSG, ...); each polled alongside the geo tier when present. */
  alertSources?: Array<{ source: FireAlertSource; config: AlertSourceConfig }>;
  /** Optional text-based incident source (Fire Service X account); polled every minute on its own job — each poll is a paid API call, but since_id makes an empty poll (nothing new) free. */
  incidentIngestion?: { source: IncidentSource; repository: IncidentReportRepository; sourceId: string };
  /** Optional live geocoder (e.g. Nominatim) tried before the offline gazetteer for incident reports. */
  geocodingSource?: GeocodingSource;
  now?: () => Date;
  onLog?: (message: string) => void;
  /** Called whenever a poll/decay/confirmation pass actually changes stored data — drives /api/events (SSE). */
  onUpdate?: () => void;
  /** Called with newly inserted satellite detections (either tier), once per row — drives push notifications. */
  onNewDetections?: (detections: InsertedDetection[]) => void;
  /** Called with newly inserted incident reports, once per row — drives push notifications. */
  onNewIncidents?: (reports: NewIncidentReportRow[]) => void;
}

export interface Scheduler {
  stop: () => void;
  pollGeo: () => Promise<void>;
  pollPolar: () => Promise<void>;
  pollIncidents: () => Promise<void>;
  decay: () => void;
  retention: () => void;
}

/**
 * Registers dev-plan §5's jobs: poll-geo (10min), poll-polar (30min, then a confirmation pass),
 * poll-incidents (every 1min, only when configured), decay (10min), retention (daily 03:00 UTC).
 * Runs poll-geo and poll-polar once immediately.
 */
export function startScheduler(deps: SchedulerDeps): Scheduler {
  const now = deps.now ?? (() => new Date());
  const geoSourceIds = Object.entries(deps.effectiveSources)
    .filter(([, tier]) => tier === 'geo')
    .map(([id]) => id);
  const polarSourceIds = Object.entries(deps.effectiveSources)
    .filter(([, tier]) => tier === 'polar')
    .map(([id]) => id);

  // Each ingest path reports whether it actually inserted anything, so the polls below only
  // fire onUpdate (and wake connected browsers) when there's really something new to show.
  const ingestOne = async (sourceId: string, tier: Tier): Promise<boolean> => {
    const result = await ingestSource({
      dataSource: deps.dataSource,
      repository: deps.repository,
      sourceId,
      tier,
      bboxString: GREECE_BBOX_STRING,
      dayRange: DAY_RANGE,
      now,
      onLog: deps.onLog,
      onInserted: deps.onNewDetections,
    });
    return result.rowsInserted > 0;
  };

  async function pollGeo(): Promise<void> {
    let changed = false;
    for (const sourceId of geoSourceIds) {
      if (await ingestOne(sourceId, 'geo')) changed = true;
    }
    for (const { source, config } of deps.alertSources ?? []) {
      const result = await ingestFireAlerts(source, config, deps.repository, now, deps.onLog, deps.onNewDetections);
      if (result.rowsInserted > 0) changed = true;
    }
    if (changed) deps.onUpdate?.();
  }

  async function pollIncidents(): Promise<void> {
    const incidents = deps.incidentIngestion;
    if (!incidents) return;
    const result = await ingestIncidentReports(
      incidents.source,
      incidents.repository,
      incidents.sourceId,
      now,
      deps.onLog,
      deps.onNewIncidents,
      deps.geocodingSource,
    );
    if (result.rowsInserted > 0) deps.onUpdate?.();
  }

  async function pollPolar(): Promise<void> {
    let changed = false;
    for (const sourceId of polarSourceIds) {
      if (await ingestOne(sourceId, 'polar')) changed = true;
    }
    const { confirmed } = runConfirmationPass(deps.repository, now);
    if (confirmed > 0) {
      deps.onLog?.(`confirmation pass: confirmed=${confirmed}`);
      changed = true;
    }
    if (changed) deps.onUpdate?.();
  }

  function decay(): void {
    const { expired } = runDecayPass(deps.repository, now);
    if (expired > 0) {
      deps.onLog?.(`decay pass: expired=${expired}`);
      deps.onUpdate?.();
    }
  }

  function retention(): void {
    const { deletedDetections, deletedFetchLogs, deletedIncidentReports } = runRetention(
      deps.repository,
      now,
      deps.incidentIngestion?.repository,
    );
    deps.onLog?.(
      `retention: deletedDetections=${deletedDetections} deletedFetchLogs=${deletedFetchLogs} deletedIncidentReports=${deletedIncidentReports}`,
    );
  }

  const tasks: ScheduledTask[] = [
    cron.schedule('*/10 * * * *', () => void pollGeo()),
    cron.schedule('*/30 * * * *', () => void pollPolar()),
    cron.schedule('* * * * *', () => void pollIncidents()),
    cron.schedule('*/10 * * * *', decay),
    cron.schedule('0 3 * * *', retention),
  ];

  void pollGeo();
  void pollPolar();
  void pollIncidents();

  return {
    stop: () => tasks.forEach((task) => task.stop()),
    pollGeo,
    pollPolar,
    pollIncidents,
    decay,
    retention,
  };
}
