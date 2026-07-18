import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFireCap } from '../src/adapters/eumetsat/capParser.js';

// Fixture is the real CAP structure from a live 2026-07-18 MTG FCI bulletin; four circles keep
// their real coordinates, three were moved into the Greece bbox (the sampled cycle had no Greek fires).
const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const capXml = readFileSync(path.join(fixturesDir, 'mtg_fir_cap_sample.xml'), 'utf-8');

describe('parseFireCap', () => {
  it('parses all circles with lat/lon/radius and normalizes the effective time to UTC Z', () => {
    const { acquiredAt, circles } = parseFireCap(capXml);

    expect(acquiredAt).toBe('2026-07-18T09:20:00Z');
    expect(circles).toHaveLength(7);
    expect(circles[0]).toEqual({ latitude: -27.764, longitude: 31.072, radiusKm: 1.319 });
    expect(circles[2]).toEqual({ latitude: 38.212, longitude: 23.911, radiusKm: 1.201 });
    expect(circles[5]).toEqual({ latitude: -16.973, longitude: -60.754, radiusKm: 2.14 });
  });

  it('returns no circles for a bulletin without fires', () => {
    const empty = capXml.replace(/<circle>[^<]*<\/circle>\s*/g, '');
    const { acquiredAt, circles } = parseFireCap(empty);
    expect(acquiredAt).toBe('2026-07-18T09:20:00Z');
    expect(circles).toEqual([]);
  });

  it('skips malformed circle entries', () => {
    const withJunk = capXml.replace('<circle>-27.764,31.072 1.319</circle>', '<circle>garbage</circle>');
    const { circles } = parseFireCap(withJunk);
    expect(circles).toHaveLength(6);
  });

  it('returns null acquiredAt when <effective> is missing', () => {
    const noEffective = capXml.replace(/<effective>[^<]*<\/effective>/, '');
    expect(parseFireCap(noEffective).acquiredAt).toBeNull();
  });
});
