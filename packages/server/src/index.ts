import { FIRMS_SOURCES } from '@pyrmap/shared';
import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { SqliteFireRepository } from './adapters/sqlite/SqliteFireRepository.js';
import { FirmsClient } from './adapters/firms/FirmsClient.js';
import { MockFireDataSource } from './adapters/firms/MockFireDataSource.js';
import { EumetsatFciClient } from './adapters/eumetsat/EumetsatFciClient.js';
import { resolveSources } from './domain/sourceResolution.js';
import { startScheduler } from './jobs/scheduler.js';
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

  // Meteosat MTG fire alerts direct from EUMETSAT — the geo tier's feed while FIRMS lacks MSG/SEVIRI.
  // Disabled under FIRMS_MOCK so dev never hits the real EUMETSAT API (CLAUDE.md §9).
  let alertSource: FireAlertSource | undefined;
  if (!process.env.FIRMS_MOCK && config.eumetsatConsumerKey && config.eumetsatConsumerSecret) {
    alertSource = new EumetsatFciClient(config.eumetsatConsumerKey, config.eumetsatConsumerSecret);
    app.log.info('Meteosat MTG fire alerts enabled (EUMETSAT Data Store)');
  } else if (!process.env.FIRMS_MOCK) {
    app.log.warn('EUMETSAT credentials not set — geo tier limited to FIRMS sources');
  }

  startScheduler({
    dataSource,
    repository,
    effectiveSources: effective,
    alertSource,
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
