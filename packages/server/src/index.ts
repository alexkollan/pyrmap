import path from 'node:path';
import { FIRMS_SOURCES, MTG_FIR_SOURCE_ID, MSG_FRP_PIXEL_SOURCE_ID, PYROSVESTIKI_SOURCE_ID } from '@pyrmap/shared';
import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { SqliteFireRepository } from './adapters/sqlite/SqliteFireRepository.js';
import { SqliteIncidentReportRepository } from './adapters/sqlite/SqliteIncidentReportRepository.js';
import { SqlitePushSubscriptionRepository } from './adapters/sqlite/SqlitePushSubscriptionRepository.js';
import { FirmsClient } from './adapters/firms/FirmsClient.js';
import { MockFireDataSource } from './adapters/firms/MockFireDataSource.js';
import { EumetsatFciClient } from './adapters/eumetsat/EumetsatFciClient.js';
import { LsaSafFrpPixelClient } from './adapters/lsasaf/LsaSafFrpPixelClient.js';
import { PyrosvestikiXClient } from './adapters/pyrosvestiki/PyrosvestikiXClient.js';
import { NominatimClient } from './adapters/nominatim/NominatimClient.js';
import { resolveSources } from './domain/sourceResolution.js';
import { startScheduler } from './jobs/scheduler.js';
import type { Scheduler } from './jobs/scheduler.js';
import { UpdateBus } from './jobs/updateBus.js';
import { initializePushVapid, notifyNewDetections, notifyNewIncidents } from './services/pushNotificationService.js';
import type { AlertSourceConfig } from './services/alertIngestService.js';
import type { FireAlertSource } from './ports/FireAlertSource.js';
import type { FireDataSource } from './ports/FireDataSource.js';
import type { IncidentReportRepository } from './ports/IncidentReportRepository.js';
import type { IncidentSource } from './ports/IncidentSource.js';
import type { AuthConfig } from './routes/auth.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const repository = new SqliteFireRepository(config.dbPath);
  const logsDir = path.join(path.dirname(config.dbPath), 'logs', 'incidents');

  // The Fire Service's X posts, geocoded — a different concept from satellite detections, so a
  // separate repository/table (own connection to the same file; WAL mode makes that safe).
  // Disabled under FIRMS_MOCK so dev never makes a paid API call (CLAUDE.md §9, plus X bills per read).
  let incidentIngestion: { source: IncidentSource; repository: IncidentReportRepository; sourceId: string } | undefined;
  let incidentRepository: IncidentReportRepository | undefined;
  if (!process.env.FIRMS_MOCK && config.xBearerToken) {
    incidentRepository = new SqliteIncidentReportRepository(config.dbPath);
    incidentIngestion = {
      source: new PyrosvestikiXClient(config.xBearerToken),
      repository: incidentRepository,
      sourceId: PYROSVESTIKI_SOURCE_ID,
    };
  }

  // Live geocoding for incident reports, tried before the offline gazetteer — no API key needed
  // (OpenStreetMap Nominatim), so it's on whenever incident ingestion itself is; a failed or
  // empty lookup falls back to the offline gazetteer, never drops a post because of this alone.
  const geocodingSource = incidentIngestion ? new NominatimClient() : undefined;

  // Push notifications, off by default — requires all three VAPID_* vars (mirrors the auth
  // pattern: a half-configured .env should never silently half-work).
  let pushSubscriptionRepository: SqlitePushSubscriptionRepository | undefined;
  const vapid =
    config.vapidPublicKey && config.vapidPrivateKey && config.vapidSubject
      ? { publicKey: config.vapidPublicKey, privateKey: config.vapidPrivateKey, subject: config.vapidSubject }
      : null;
  if (vapid) {
    pushSubscriptionRepository = new SqlitePushSubscriptionRepository(config.dbPath);
    initializePushVapid(vapid);
  }

  // Single-user auth, off by default (local dev). Requires all three so a partially-filled .env
  // never accidentally leaves the map open when the operator thought it was locked down.
  const auth: AuthConfig | null =
    config.authUsername && config.authPassword && config.sessionSecret
      ? { username: config.authUsername, password: config.authPassword, sessionSecret: config.sessionSecret }
      : null;

  const updateBus = new UpdateBus();
  let scheduler: Scheduler | null = null;
  const app = await buildApp(
    config,
    repository,
    undefined,
    undefined,
    incidentRepository,
    updateBus,
    auth,
    pushSubscriptionRepository,
    vapid?.publicKey ?? null,
    () => scheduler,
  );

  if (auth) {
    app.log.info('Auth enabled — /api/fires, /api/status, /api/events require login');
  } else {
    app.log.warn('AUTH_USERNAME/AUTH_PASSWORD/SESSION_SECRET not fully set — running with open access');
  }

  const dataSource: FireDataSource = process.env.FIRMS_MOCK
    ? new MockFireDataSource()
    : new FirmsClient(config.firmsMapKey);

  const availableSourceIds = await dataSource.fetchAvailableSourceIds();
  const { effective, warnings } = resolveSources(FIRMS_SOURCES, availableSourceIds);
  for (const warning of warnings) {
    app.log.warn(warning);
  }

  // Geostationary fire-alert feeds, additive — each is independent and only makes coverage better.
  // Disabled under FIRMS_MOCK so dev never hits a real external API (CLAUDE.md §9).
  const alertSources: Array<{ source: FireAlertSource; config: AlertSourceConfig }> = [];

  if (!process.env.FIRMS_MOCK && config.eumetsatConsumerKey && config.eumetsatConsumerSecret) {
    alertSources.push({
      source: new EumetsatFciClient(config.eumetsatConsumerKey, config.eumetsatConsumerSecret),
      config: { sourceId: MTG_FIR_SOURCE_ID, satellite: 'MTG-I1', instrument: 'FCI' },
    });
    app.log.info('Meteosat MTG fire alerts enabled (EUMETSAT Data Store)');
  } else if (!process.env.FIRMS_MOCK) {
    app.log.warn('EUMETSAT credentials not set — MTG fire alerts disabled');
  }

  // LSA SAF's FRP-PIXEL list has no significance threshold, unlike the CAP bulletin above — it
  // catches small fires the CAP feed misses (verified live 2026-07-20, see docs/DECISIONS.md).
  if (!process.env.FIRMS_MOCK && config.lsaSafUsername && config.lsaSafPassword) {
    alertSources.push({
      source: new LsaSafFrpPixelClient(config.lsaSafUsername, config.lsaSafPassword),
      config: { sourceId: MSG_FRP_PIXEL_SOURCE_ID, satellite: 'MSG', instrument: 'SEVIRI' },
    });
    app.log.info('MSG FRP-PIXEL fire alerts enabled (LSA SAF)');
  } else if (!process.env.FIRMS_MOCK) {
    app.log.warn('LSA SAF credentials not set — MSG FRP-PIXEL fire alerts disabled');
  }

  if (incidentIngestion) {
    app.log.info('Fire Service incident reports enabled (X API)');
  } else if (!process.env.FIRMS_MOCK) {
    app.log.warn('X_BEARER_TOKEN not set — Fire Service incident-reports layer disabled');
  }

  if (pushSubscriptionRepository) {
    app.log.info('Push notifications enabled (VAPID configured)');
  } else {
    app.log.warn('VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT not fully set — push notifications disabled');
  }

  scheduler = startScheduler({
    dataSource,
    repository,
    effectiveSources: effective,
    alertSources,
    incidentIngestion,
    geocodingSource,
    logsDir,
    onLog: (message) => app.log.info(message),
    onUpdate: () => updateBus.publish(),
    onNewDetections: pushSubscriptionRepository
      ? (detections) => void notifyNewDetections(pushSubscriptionRepository, detections, (m) => app.log.info(m))
      : undefined,
    onNewIncidents: pushSubscriptionRepository
      ? (reports) => void notifyNewIncidents(pushSubscriptionRepository, reports, (m) => app.log.info(m))
      : undefined,
  });

  try {
    await app.listen({ host: '0.0.0.0', port: config.port });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
