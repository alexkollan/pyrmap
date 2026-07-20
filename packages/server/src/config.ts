export interface Config {
  firmsMapKey: string;
  port: number;
  dbPath: string;
  logLevel: string;
  /** Optional EUMETSAT Data Store credentials; when both set, Meteosat MTG fire alerts feed the geo tier. */
  eumetsatConsumerKey: string | null;
  eumetsatConsumerSecret: string | null;
  /** Optional LSA SAF Data Service credentials; when both set, the MSG FRP-PIXEL list feeds the geo tier. */
  lsaSafUsername: string | null;
  lsaSafPassword: string | null;
  /** Optional X API bearer token; when set, the Fire Service's X posts feed the incident-reports layer. */
  xBearerToken: string | null;
  /** Optional single-user auth; when all three are set, every route except /api/login, /api/logout,
   * /api/me, and /api/health requires a signed session cookie. Unset = open access (local dev default). */
  authUsername: string | null;
  authPassword: string | null;
  sessionSecret: string | null;
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
    lsaSafUsername: env.LSASAF_USERNAME || null,
    lsaSafPassword: env.LSASAF_PASSWORD || null,
    xBearerToken: env.X_BEARER_TOKEN || null,
    authUsername: env.AUTH_USERNAME || null,
    authPassword: env.AUTH_PASSWORD || null,
    sessionSecret: env.SESSION_SECRET || null,
  };
}
