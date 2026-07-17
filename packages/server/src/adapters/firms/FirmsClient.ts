import type { FireDataSource, FirmsFetchResult } from '../../ports/FireDataSource.js';

const FIRMS_BASE = 'https://firms.modaps.eosdis.nasa.gov/api';
const TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = 5_000;

type FetchFn = typeof fetch;

/** Talks to the NASA FIRMS API: area CSV fetches (timeout + retry on network error/5xx) and source availability. */
export class FirmsClient implements FireDataSource {
  constructor(
    private readonly mapKey: string,
    private readonly fetchImpl: FetchFn = fetch,
    private readonly sleepImpl: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  async fetchAreaCsv(sourceId: string, bboxString: string, dayRange: number): Promise<FirmsFetchResult> {
    const url = `${FIRMS_BASE}/area/csv/${this.mapKey}/${sourceId}/${bboxString}/${dayRange}`;
    return this.getWithRetry(url);
  }

  async fetchAvailableSourceIds(): Promise<string[]> {
    const url = `${FIRMS_BASE}/data_availability/csv/${this.mapKey}/ALL`;
    const { body } = await this.getWithRetry(url);
    return parseAvailableSourceIds(body);
  }

  private async getWithRetry(url: string): Promise<FirmsFetchResult> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await this.getOnce(url);
      } catch (err) {
        lastError = err;
        if (attempt < MAX_RETRIES) {
          await this.sleepImpl(RETRY_BACKOFF_MS);
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async getOnce(url: string): Promise<FirmsFetchResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(url, { signal: controller.signal });
      if (response.status >= 500) {
        throw new Error(`FIRMS request failed with HTTP ${response.status}`);
      }
      const body = await response.text();
      return { httpStatus: response.status, body };
    } finally {
      clearTimeout(timeout);
    }
  }
}

function parseAvailableSourceIds(body: string): string[] {
  const trimmed = body.trim();
  if (!trimmed) return [];
  const lines = trimmed.split(/\r?\n/);
  const header = lines[0]!.split(',').map((h) => h.trim().toLowerCase());
  const idIdx = header.indexOf('data_id');
  if (idIdx === -1) return [];
  return lines
    .slice(1)
    .map((line) => line.split(',')[idIdx]?.trim())
    .filter((id): id is string => Boolean(id));
}
