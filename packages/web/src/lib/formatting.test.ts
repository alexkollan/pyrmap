import { describe, expect, it } from 'vitest';
import { formatAthensTime, formatLocalTime, formatRelativeTime } from './formatting.js';

describe('formatRelativeTime', () => {
  const now = new Date('2026-07-15T12:00:00Z');

  it('shows "just now" for under a minute', () => {
    expect(formatRelativeTime('2026-07-15T11:59:35Z', now)).toBe('just now');
  });

  it('shows minutes for under an hour', () => {
    expect(formatRelativeTime('2026-07-15T11:18:00Z', now)).toBe('42 min ago');
  });

  it('shows hours for an hour or more', () => {
    expect(formatRelativeTime('2026-07-15T09:00:00Z', now)).toBe('3 h ago');
  });
});

describe('formatAthensTime', () => {
  it('renders acquiredAt in Europe/Athens local time (UTC+3 in July, EEST)', () => {
    expect(formatAthensTime('2026-07-15T09:35:00Z')).toBe('15/07, 12:35');
  });
});

describe('formatLocalTime', () => {
  it('formats hour:minute in the viewer local time/locale', () => {
    expect(formatLocalTime(new Date('2026-07-15T09:35:00Z'))).toMatch(/^\d{1,2}:\d{2}(\s?[AP]M)?$/);
  });
});
