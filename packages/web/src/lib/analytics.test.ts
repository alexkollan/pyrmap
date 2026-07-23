// @vitest-environment jsdom
//
// This file needs a real DOM (localStorage, document.createElement) unlike every other web test,
// which is a pure function with no DOM dependency — scoped to just this file via the pragma above
// rather than switching the whole suite's (faster) default node environment.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadStoredConsent, setAnalyticsConsent, storeConsent, trackEvent } from './analytics.js';

beforeEach(() => {
  localStorage.clear();
  delete (window as { gtag?: unknown }).gtag;
  delete (window as { dataLayer?: unknown }).dataLayer;
  document.head.querySelectorAll('script[src*="googletagmanager"]').forEach((el) => el.remove());
});

describe('loadStoredConsent/storeConsent', () => {
  it('returns null when nothing is stored', () => {
    expect(loadStoredConsent()).toBeNull();
  });

  it('round-trips a stored choice', () => {
    storeConsent({ analytics: true, decidedAt: '2026-07-23T10:00:00Z' });
    expect(loadStoredConsent()).toEqual({ analytics: true, decidedAt: '2026-07-23T10:00:00Z' });
  });

  it('returns null for malformed stored JSON', () => {
    localStorage.setItem('pyrmap-consent', 'not json');
    expect(loadStoredConsent()).toBeNull();
  });
});

// Order matters in this describe block: analyticsScriptInjected/consentGranted are module-level
// state (by design — see analytics.ts), so tests that must observe a "script never injected yet"
// state run first, before any test that actually grants consent with a real measurement ID.
describe('trackEvent', () => {
  it('does nothing when consent has never been granted', () => {
    trackEvent('test_event');
    expect(document.head.querySelector('script[src*="googletagmanager"]')).toBeNull();
  });

  it('does nothing when no measurement ID is configured, even with consent granted', () => {
    setAnalyticsConsent(true, undefined);
    expect(document.head.querySelector('script[src*="googletagmanager"]')).toBeNull();
  });

  it('injects the gtag script exactly once and fires events once consent is granted', () => {
    setAnalyticsConsent(true, 'G-TEST123');
    expect(document.head.querySelectorAll('script[src*="googletagmanager"]')).toHaveLength(1);

    const gtagSpy = vi.fn();
    window.gtag = gtagSpy;
    trackEvent('test_event', { foo: 'bar' });
    expect(gtagSpy).toHaveBeenCalledWith('event', 'test_event', { foo: 'bar' });

    setAnalyticsConsent(true, 'G-TEST123'); // calling again must not inject a second script
    expect(document.head.querySelectorAll('script[src*="googletagmanager"]')).toHaveLength(1);
  });

  it('stops firing once consent is revoked, even though the script already loaded', () => {
    setAnalyticsConsent(true, 'G-TEST123');
    const gtagSpy = vi.fn();
    window.gtag = gtagSpy;

    setAnalyticsConsent(false, 'G-TEST123');
    trackEvent('should_not_fire');
    expect(gtagSpy).not.toHaveBeenCalled();
  });
});
