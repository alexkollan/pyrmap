import { describe, expect, it } from 'vitest';
import { shouldExpire } from './decay.js';

const now = new Date('2026-07-15T12:00:00Z');

describe('shouldExpire', () => {
  it('stays unconfirmed at 11h59m old', () => {
    expect(shouldExpire('2026-07-15T00:01:00Z', now)).toBe(false);
  });

  it('expires at 12h1m old', () => {
    expect(shouldExpire('2026-07-14T23:59:00Z', now)).toBe(true);
  });

  it('stays unconfirmed at exactly 12h old (boundary is exclusive)', () => {
    expect(shouldExpire('2026-07-15T00:00:00Z', now)).toBe(false);
  });
});
