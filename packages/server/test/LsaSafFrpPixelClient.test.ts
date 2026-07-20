import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { LsaSafFrpPixelClient } from '../src/adapters/lsasaf/LsaSafFrpPixelClient.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const sampleH5 = readFileSync(path.join(fixturesDir, 'msg_frp_pixel_sample.h5'));

// The fixture is the real 2026-07-20T08:45:00Z slot; "now" just after it, so recentSlots()
// requests 08:45 first, then earlier slots which this fake reports as 404 (not yet relevant here).
const NOW = () => new Date('2026-07-20T08:52:00Z');
const PUBLISHED_URL =
  'https://datalsasaf.lsasvcs.ipma.pt/PRODUCTS/MSG/FRP-PIXEL/HDF5/2026/07/20/HDF5_LSASAF_MSG_FRP-PIXEL-ListProduct_MSG-Disk_202607200845';

function fakeFetch(publishedUrls: Record<string, ArrayBuffer>): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url in publishedUrls) {
      return new Response(publishedUrls[url]!, { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
}

describe('LsaSafFrpPixelClient', () => {
  it('fetches only the slots that are published, parsing real Greece detections from the rest', async () => {
    const fetchImpl = fakeFetch({ [PUBLISHED_URL]: toArrayBuffer(sampleH5) });
    const client = new LsaSafFrpPixelClient('user', 'pass', fetchImpl, NOW);

    const alerts = await client.fetchRecentAlerts(3);

    expect(alerts).toHaveLength(1); // the other 2 slots 404'd and were skipped
    expect(alerts[0]!.acquiredAt).toBe('2026-07-20T08:45:00Z');
    expect(alerts[0]!.circles.length).toBeGreaterThan(100);

    const peloponnese = alerts[0]!.circles.find(
      (c) => Math.abs(c.latitude - 37.4) < 0.01 && Math.abs(c.longitude - 22.1) < 0.01,
    );
    expect(peloponnese).toBeDefined();
    expect(peloponnese!.frpMw).toBeCloseTo(69.4, 0);
  });

  it('sends HTTP Basic Auth built from the given username/password', async () => {
    const fetchImpl = fakeFetch({ [PUBLISHED_URL]: toArrayBuffer(sampleH5) });
    const client = new LsaSafFrpPixelClient('duelstein', 'secret-pw', fetchImpl, NOW);

    await client.fetchRecentAlerts(1);

    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit?][];
    const headers = calls[0]![1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from('duelstein:secret-pw').toString('base64')}`);
  });

  it('throws on a non-404 error response instead of silently skipping', async () => {
    const fetchImpl = vi.fn(async () => new Response('server error', { status: 500 })) as unknown as typeof fetch;
    const client = new LsaSafFrpPixelClient('user', 'pass', fetchImpl, NOW);

    await expect(client.fetchRecentAlerts(1)).rejects.toThrow(/HTTP 500/);
  });
});

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}
