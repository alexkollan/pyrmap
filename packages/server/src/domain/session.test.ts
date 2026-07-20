import { describe, expect, it } from 'vitest';
import { credentialsMatch, signSession, verifySession } from './session.js';

const SECRET = 'test-secret';
const NOW = () => new Date('2026-07-20T12:00:00Z');

describe('signSession / verifySession', () => {
  it('round-trips a valid token', () => {
    const token = signSession({ username: 'alex', expiresAt: NOW().getTime() + 1000 }, SECRET);
    expect(verifySession(token, SECRET, NOW)).toEqual({ username: 'alex', expiresAt: NOW().getTime() + 1000 });
  });

  it('rejects a token signed with a different secret', () => {
    const token = signSession({ username: 'alex', expiresAt: NOW().getTime() + 1000 }, SECRET);
    expect(verifySession(token, 'wrong-secret', NOW)).toBeNull();
  });

  it('rejects a tampered payload even if the signature format looks valid', () => {
    const token = signSession({ username: 'alex', expiresAt: NOW().getTime() + 1000 }, SECRET);
    const [, signature] = token.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ username: 'someone-else', expiresAt: NOW().getTime() + 1000 })).toString(
      'base64url',
    );
    expect(verifySession(`${forgedPayload}.${signature}`, SECRET, NOW)).toBeNull();
  });

  it('rejects an expired token', () => {
    const token = signSession({ username: 'alex', expiresAt: NOW().getTime() - 1 }, SECRET);
    expect(verifySession(token, SECRET, NOW)).toBeNull();
  });

  it('rejects garbage input', () => {
    expect(verifySession('not-a-real-token', SECRET, NOW)).toBeNull();
    expect(verifySession('', SECRET, NOW)).toBeNull();
    expect(verifySession('a.b.c', SECRET, NOW)).toBeNull();
  });
});

describe('credentialsMatch', () => {
  it('matches identical username and password', () => {
    expect(credentialsMatch('alex', 'pw', 'alex', 'pw')).toBe(true);
  });

  it('rejects a wrong username, wrong password, or both', () => {
    expect(credentialsMatch('bob', 'pw', 'alex', 'pw')).toBe(false);
    expect(credentialsMatch('alex', 'wrong', 'alex', 'pw')).toBe(false);
    expect(credentialsMatch('bob', 'wrong', 'alex', 'pw')).toBe(false);
  });

  it('rejects when lengths differ, without throwing', () => {
    expect(credentialsMatch('a', 'pw', 'alex', 'pw')).toBe(false);
    expect(credentialsMatch('alex', '', 'alex', 'pw')).toBe(false);
  });
});
