import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { EumetsatFciClient } from '../src/adapters/eumetsat/EumetsatFciClient.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const capXml = readFileSync(path.join(fixturesDir, 'mtg_fir_cap_sample.xml'), 'utf-8');

const PRODUCT_ID = 'W_XX-EUMETSAT-Darmstadt,IMG+SAT,MTI1+FCI-2-FIR--FD------CAP_TEST_0001';

function fakeFetch(): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/token')) {
      return new Response(JSON.stringify({ access_token: 'tok-1', expires_in: 3600 }), { status: 200 });
    }
    if (url.includes('/search-products/')) {
      return new Response(
        JSON.stringify({ features: [{ id: PRODUCT_ID, properties: { date: '2026-07-18T09:20:00Z/2026-07-18T09:30:00Z' } }] }),
        { status: 200 },
      );
    }
    if (url.includes('/entry?name=')) {
      return new Response(capXml, { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
}

describe('EumetsatFciClient', () => {
  it('searches, downloads the CAP entry, and returns parsed alerts', async () => {
    const fetchImpl = fakeFetch();
    const client = new EumetsatFciClient('key', 'secret', fetchImpl);

    const alerts = await client.fetchRecentAlerts(1);

    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.productId).toBe(PRODUCT_ID);
    expect(alerts[0]!.acquiredAt).toBe('2026-07-18T09:20:00Z');
    expect(alerts[0]!.circles).toHaveLength(7);
  });

  it('authenticates with Basic consumer credentials and reuses the cached token', async () => {
    const fetchImpl = fakeFetch();
    const client = new EumetsatFciClient('my-key', 'my-secret', fetchImpl);

    await client.fetchRecentAlerts(1);
    await client.fetchRecentAlerts(1);

    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit?][];
    const tokenCalls = calls.filter(([url]) => String(url).endsWith('/token'));
    expect(tokenCalls).toHaveLength(1); // cached on the second run

    const headers = tokenCalls[0]![1]?.headers as Record<string, string>;
    const expected = `Basic ${Buffer.from('my-key:my-secret').toString('base64')}`;
    expect(headers.Authorization).toBe(expected);
  });

  it('throws on a failed search response', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/token')) {
        return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 });
      }
      return new Response('server error', { status: 500 });
    }) as unknown as typeof fetch;

    const client = new EumetsatFciClient('key', 'secret', fetchImpl);
    await expect(client.fetchRecentAlerts(1)).rejects.toThrow(/HTTP 500/);
  });
});
