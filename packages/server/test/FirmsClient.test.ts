import { describe, expect, it, vi } from 'vitest';
import { FirmsClient } from '../src/adapters/firms/FirmsClient.js';

function fakeResponse(status: number, body: string): Response {
  return new Response(body, { status });
}

describe('FirmsClient', () => {
  it('returns the body and status on a successful fetch', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(200, 'latitude,longitude\n1,2\n'));
    const client = new FirmsClient('key', fetchImpl, async () => {});

    const result = await client.fetchAreaCsv('MSG_NRT', '19,34.5,29.7,42', 1);

    expect(result).toEqual({ httpStatus: 200, body: 'latitude,longitude\n1,2\n' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries on a 5xx response and succeeds on the second attempt', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse(503, 'unavailable'))
      .mockResolvedValueOnce(fakeResponse(200, 'ok-body'));
    const client = new FirmsClient('key', fetchImpl, async () => {});

    const result = await client.fetchAreaCsv('MSG_NRT', 'bbox', 1);

    expect(result).toEqual({ httpStatus: 200, body: 'ok-body' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting retries on repeated 5xx', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(500, 'fail'));
    const client = new FirmsClient('key', fetchImpl, async () => {});

    await expect(client.fetchAreaCsv('MSG_NRT', 'bbox', 1)).rejects.toThrow(/500/);
    expect(fetchImpl).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it('does not retry on a 4xx response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(404, 'not found'));
    const client = new FirmsClient('key', fetchImpl, async () => {});

    const result = await client.fetchAreaCsv('MSG_NRT', 'bbox', 1);

    expect(result).toEqual({ httpStatus: 404, body: 'not found' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('parses data_id column for available source ids', async () => {
    const csv = 'data_id,min_date,max_date\nMODIS_NRT,2020-01-01,2026-07-17\nVIIRS_SNPP_NRT,2020-01-01,2026-07-17\n';
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(200, csv));
    const client = new FirmsClient('key', fetchImpl, async () => {});

    const ids = await client.fetchAvailableSourceIds();

    expect(ids).toEqual(['MODIS_NRT', 'VIIRS_SNPP_NRT']);
  });
});
