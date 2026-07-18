import type { FireAlert, FireAlertSource } from '../../ports/FireAlertSource.js';
import { parseFireCap } from './capParser.js';

const API_BASE = 'https://api.eumetsat.int';
/** MTG FCI Active Fire Monitoring (CAP) — full disc, 10-min repeat cycle. */
const COLLECTION_ID = 'EO:EUM:DAT:0801';
const TIMEOUT_MS = 30_000;
const TOKEN_EXPIRY_MARGIN_MS = 60_000;

type FetchFn = typeof fetch;

interface SearchFeature {
  id: string;
  properties?: { date?: string };
}

/**
 * Pulls Meteosat MTG fire-alert bulletins from the EUMETSAT Data Store: client-credentials
 * token (cached until near expiry) -> OpenSearch for latest products -> single-entry CAP
 * XML download (no zip handling needed; verified live 2026-07-18).
 */
export class EumetsatFciClient implements FireAlertSource {
  private token: { value: string; expiresAtMs: number } | null = null;

  constructor(
    private readonly consumerKey: string,
    private readonly consumerSecret: string,
    private readonly fetchImpl: FetchFn = fetch,
  ) {}

  async fetchRecentAlerts(count: number): Promise<FireAlert[]> {
    const searchUrl = `${API_BASE}/data/search-products/1.0.0/os?format=json&pi=${encodeURIComponent(COLLECTION_ID)}&c=${count}`;
    const searchBody = (await this.getJson(searchUrl)) as { features?: SearchFeature[] };
    const features = searchBody.features ?? [];

    const alerts: FireAlert[] = [];
    for (const feature of features) {
      const productId = feature.id;
      const encoded = encodeURIComponent(productId);
      const entryUrl = `${API_BASE}/data/download/1.0.0/collections/${encodeURIComponent(COLLECTION_ID)}/products/${encoded}/entry?name=${encoded}.xml`;
      const xml = await this.getText(entryUrl);
      const parsed = parseFireCap(xml);
      if (parsed.acquiredAt) {
        alerts.push({ productId, acquiredAt: parsed.acquiredAt, circles: parsed.circles });
      }
    }
    return alerts;
  }

  private async getToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAtMs) {
      return this.token.value;
    }
    const basic = Buffer.from(`${this.consumerKey}:${this.consumerSecret}`).toString('base64');
    const response = await this.request(`${API_BASE}/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    const body = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) {
      throw new Error('EUMETSAT token request returned no access_token');
    }
    this.token = {
      value: body.access_token,
      expiresAtMs: Date.now() + (body.expires_in ?? 600) * 1000 - TOKEN_EXPIRY_MARGIN_MS,
    };
    return this.token.value;
  }

  private async getJson(url: string): Promise<unknown> {
    const response = await this.request(url);
    return response.json();
  }

  private async getText(url: string): Promise<string> {
    const token = await this.getToken();
    const response = await this.request(url, { headers: { Authorization: `Bearer ${token}` } });
    return response.text();
  }

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(url, { ...init, signal: controller.signal });
      if (!response.ok) {
        throw new Error(`EUMETSAT request failed: HTTP ${response.status} for ${url.split('?')[0]}`);
      }
      return response;
    } finally {
      clearTimeout(timeout);
    }
  }
}
