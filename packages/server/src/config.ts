export interface Config {
  firmsMapKey: string;
  port: number;
  dbPath: string;
  logLevel: string;
  /** Optional EUMETSAT Data Store credentials; when both set, Meteosat MTG fire alerts feed the geo tier. */
  eumetsatConsumerKey: string | null;
  eumetsatConsumerSecret: string | null;
}

/** Reads and validates required env vars. Throws with a clear message if invalid. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const firmsMapKey = env.FIRMS_MAP_KEY ?? '';
  if (!firmsMapKey || firmsMapKey === 'changeme') {
    throw new Error('FIRMS_MAP_KEY must be set to a real value (see .env.example)');
  }

  const portRaw = env.PORT ?? '8080';
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`PORT must be a positive integer, got: ${portRaw}`);
  }

  return {
    firmsMapKey,
    port,
    dbPath: env.DB_PATH ?? '/data/pyrmap.db',
    logLevel: env.LOG_LEVEL ?? 'info',
    eumetsatConsumerKey: env.EUMETSAT_CONSUMER_KEY || null,
    eumetsatConsumerSecret: env.EUMETSAT_CONSUMER_SECRET || null,
  };
}
