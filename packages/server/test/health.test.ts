import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

describe('GET /api/health', () => {
  it('returns 200 {ok:true}', async () => {
    const app = await buildApp({ logLevel: 'silent' });
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    await app.close();
  });
});
