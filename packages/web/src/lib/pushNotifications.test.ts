import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkPushSupport, urlBase64ToUint8Array } from './pushNotifications.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('urlBase64ToUint8Array', () => {
  it('decodes a URL-safe base64 VAPID key into bytes', () => {
    // "AQID" (standard base64 for bytes [1,2,3]) with URL-safe alphabet, no padding needed.
    expect(Array.from(urlBase64ToUint8Array('AQID'))).toEqual([1, 2, 3]);
  });

  it('decodes a URL-safe base64 string containing "_" (standing in for "/")', () => {
    // Standard base64 "Pj8/" decodes to bytes [62, 63, 63]; URL-safe form replaces "/" with "_".
    expect(Array.from(urlBase64ToUint8Array('Pj8_'))).toEqual([62, 63, 63]);
  });
});

describe('checkPushSupport', () => {
  it('reports unsupported when the required browser APIs are missing', () => {
    vi.stubGlobal('navigator', { userAgent: 'test-agent' });
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    expect(checkPushSupport()).toEqual({ supported: false, needsInstall: false });
  });

  it('flags needsInstall on iOS Safari when not running as an installed app', () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' });
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    expect(checkPushSupport()).toEqual({ supported: false, needsInstall: true });
  });
});
