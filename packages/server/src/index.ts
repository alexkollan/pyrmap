import { FIRMS_SOURCES } from '@pyrmap/shared';
import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { SqliteFireRepository } from './adapters/sqlite/SqliteFireRepository.js';
import { FirmsClient } from './adapters/firms/FirmsClient.js';
import { MockFireDataSource } from './adapters/firms/MockFireDataSource.js';
import { resolveSources } from './domain/sourceResolution.js';
import { startScheduler } from './jobs/scheduler.js';
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

  startScheduler({
    dataSource,
    repository,
    effectiveSources: effective,
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
