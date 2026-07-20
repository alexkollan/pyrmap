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
      eumetsatConsumerKey: null,
      eumetsatConsumerSecret: null,
      lsaSafUsername: null,
      lsaSafPassword: null,
    });
  });

  it('passes through EUMETSAT credentials when both are set', () => {
    const config = loadConfig({ ...validEnv, EUMETSAT_CONSUMER_KEY: 'ck', EUMETSAT_CONSUMER_SECRET: 'cs' });
    expect(config.eumetsatConsumerKey).toBe('ck');
    expect(config.eumetsatConsumerSecret).toBe('cs');
  });

  it('passes through LSA SAF credentials when both are set', () => {
    const config = loadConfig({ ...validEnv, LSASAF_USERNAME: 'u', LSASAF_PASSWORD: 'p' });
    expect(config.lsaSafUsername).toBe('u');
    expect(config.lsaSafPassword).toBe('p');
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
