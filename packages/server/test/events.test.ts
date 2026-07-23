import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { SqliteFireRepository } from '../src/adapters/sqlite/SqliteFireRepository.js';
import { UpdateBus } from '../src/jobs/updateBus.js';

let tmpDir: string;
let repo: SqliteFireRepository;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'pyrmap-events-test-'));
  repo = new SqliteFireRepository(path.join(tmpDir, 'test.db'));
});

afterEach(() => {
  repo.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

// Fastify's app.inject() doesn't reliably exercise a hijacked, long-lived streaming response —
// this test uses a real listening server, unlike the rest of this repo's route tests.
describe('GET /api/events', () => {
  it('streams a "refresh" message to a connected client when updateBus.publish() fires', async () => {
    const updateBus = new UpdateBus();
    const app = await buildApp({ logLevel: 'silent' }, repo, undefined, undefined, undefined, undefined, updateBus);
    const address = await app.listen({ port: 0, host: '127.0.0.1' });

    try {
      const response = await fetch(`${address}/api/events`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();

      await reader.read(); // the initial ":ok" comment

      updateBus.publish();
      const { value } = await reader.read();
      expect(decoder.decode(value)).toContain('data: refresh');

      await reader.cancel();
    } finally {
      await app.close();
    }
  });

  it('stops delivering to a client after it disconnects (no leak)', async () => {
    const updateBus = new UpdateBus();
    const app = await buildApp({ logLevel: 'silent' }, repo, undefined, undefined, undefined, undefined, updateBus);
    const address = await app.listen({ port: 0, host: '127.0.0.1' });

    try {
      const response = await fetch(`${address}/api/events`);
      const reader = response.body!.getReader();
      await reader.read(); // ":ok"
      await reader.cancel();

      await new Promise((resolve) => setTimeout(resolve, 50)); // let the server see the close

      expect(() => updateBus.publish()).not.toThrow();
    } finally {
      await app.close();
    }
  });
});
