import { loadConfig } from './config.js';
import { buildApp } from './app.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildApp(config);

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
