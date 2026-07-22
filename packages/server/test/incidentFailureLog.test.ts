import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { logIncidentFailure } from '../src/services/incidentFailureLog.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'pyrmap-failurelog-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('logIncidentFailure', () => {
  it('creates the logs directory if missing and writes one JSON line per call', () => {
    const logsDir = path.join(tmpDir, 'logs', 'incidents');
    const now = () => new Date('2026-07-22T18:03:11Z');

    logIncidentFailure(
      logsDir,
      { source: 'PYROSVESTIKI_X', externalId: '1', reason: 'no-location', text: 'πρώτο μήνυμα' },
      now,
    );
    logIncidentFailure(
      logsDir,
      {
        source: 'PYROSVESTIKI_X',
        externalId: '2',
        reason: 'no-geocode',
        text: 'δεύτερο μήνυμα',
        settlement: 'Χ',
        region: 'Ψ',
      },
      now,
    );

    const filePath = path.join(logsDir, '2026-07-22.log');
    const lines = readFileSync(filePath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0]!);
    expect(first).toEqual({
      timestamp: '2026-07-22T18:03:11.000Z',
      source: 'PYROSVESTIKI_X',
      externalId: '1',
      reason: 'no-location',
      text: 'πρώτο μήνυμα',
    });

    const second = JSON.parse(lines[1]!);
    expect(second).toMatchObject({ reason: 'no-geocode', settlement: 'Χ', region: 'Ψ' });
  });

  it('appends to the same day\'s file across multiple calls, and starts a new file for a new UTC day', () => {
    const logsDir = path.join(tmpDir, 'logs', 'incidents');
    logIncidentFailure(
      logsDir,
      { source: 'S', externalId: '1', reason: 'no-location', text: 'a' },
      () => new Date('2026-07-22T23:59:00Z'),
    );
    logIncidentFailure(
      logsDir,
      { source: 'S', externalId: '2', reason: 'no-location', text: 'b' },
      () => new Date('2026-07-23T00:01:00Z'),
    );

    expect(readFileSync(path.join(logsDir, '2026-07-22.log'), 'utf-8').trim().split('\n')).toHaveLength(1);
    expect(readFileSync(path.join(logsDir, '2026-07-23.log'), 'utf-8').trim().split('\n')).toHaveLength(1);
  });
});
