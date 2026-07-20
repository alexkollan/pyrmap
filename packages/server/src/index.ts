import { FIRMS_SOURCES, MTG_FIR_SOURCE_ID, MSG_FRP_PIXEL_SOURCE_ID } from '@pyrmap/shared';
import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { SqliteFireRepository } from './adapters/sqlite/SqliteFireRepository.js';
import { FirmsClient } from './adapters/firms/FirmsClient.js';
import { MockFireDataSource } from './adapters/firms/MockFireDataSource.js';
import { EumetsatFciClient } from './adapters/eumetsat/EumetsatFciClient.js';
import { LsaSafFrpPixelClient } from './adapters/lsasaf/LsaSafFrpPixelClient.js';
import { resolveSources } from './domain/sourceResolution.js';
import { startScheduler } from './jobs/scheduler.js';
import type { AlertSourceConfig } from './services/alertIngestService.js';
import type { FireAlertSource } from './ports/FireAlertSource.js';
import type { FireDataSource } from './ports/FireDataSource.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const repository = new SqliteFireRepository(config.dbPath);
  const app = await buildApp(config, repository);

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

  startScheduler({
    dataSource,
    repository,
    effectiveSources: effective,
    alertSources,
    onLog: (message) => app.log.info(message),
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
