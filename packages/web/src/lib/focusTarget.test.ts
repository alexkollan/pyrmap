import { describe, expect, it } from 'vitest';
import { parseFocusTarget } from './focusTarget.js';

describe('parseFocusTarget', () => {
  it('parses a valid ?focus=lat,lon query string', () => {
    expect(parseFocusTarget('?focus=37.8989,23.8718')).toEqual({ lat: 37.8989, lon: 23.8718 });
  });

  it('returns null when there is no focus param', () => {
    expect(parseFocusTarget('')).toBeNull();
  });

  it('returns null for a malformed value', () => {
    expect(parseFocusTarget('?focus=not-a-coordinate')).toBeNull();
  });
});
