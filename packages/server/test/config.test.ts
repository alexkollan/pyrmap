import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const validEnv = { FIRMS_MAP_KEY: 'real-key', PORT: '8080' };

describe('loadConfig', () => {
  it('parses a valid env', () => {
    const config = loadConfig(validEnv);
    expect(config).toEqual({
      firmsMapKey: 'real-key',
      port: 8080,
      dbPath: '/data/pyrmap.db',
      logLevel: 'info',
    });
  });

  it('rejects a missing FIRMS_MAP_KEY', () => {
    expect(() => loadConfig({ ...validEnv, FIRMS_MAP_KEY: '' })).toThrow(/FIRMS_MAP_KEY/);
  });

  it('rejects the placeholder FIRMS_MAP_KEY value', () => {
    expect(() => loadConfig({ ...validEnv, FIRMS_MAP_KEY: 'changeme' })).toThrow(/FIRMS_MAP_KEY/);
  });

  it('rejects a non-integer PORT', () => {
    expect(() => loadConfig({ ...validEnv, PORT: 'abc' })).toThrow(/PORT/);
  });
});
