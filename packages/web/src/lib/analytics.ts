export interface ConsentChoice {
  analytics: boolean;
  decidedAt: string; // ISO 8601 UTC
}

const CONSENT_KEY = 'pyrmap-consent';
let analyticsScriptInjected = false;
let consentGranted = false;

export function loadStoredConsent(): ConsentChoice | null {
  try {
    const raw = localStorage.getItem(CONSENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ConsentChoice>;
    return typeof parsed.analytics === 'boolean' && typeof parsed.decidedAt === 'string'
      ? { analytics: parsed.analytics, decidedAt: parsed.decidedAt }
      : null;
  } catch {
    return null;
  }
}

export function storeConsent(choice: ConsentChoice): void {
  try {
    localStorage.setItem(CONSENT_KEY, JSON.stringify(choice));
  } catch {
    // localStorage unavailable; consent just won't persist across reloads.
  }
}

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

function injectGtagScript(measurementId: string): void {
  if (analyticsScriptInjected) return;
  analyticsScriptInjected = true;

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  // Must push the `arguments` object (Google's own official pattern), NOT a real Array built from
  // rest params — live-verified 2026-07-23 (see docs/DECISIONS.md) via a clean A/B test: gtag.js's
  // internal dataLayer-queue processing silently ignores entries that are genuine Arrays instead
  // of an arguments-shaped array-like. Using rest params here meant gtag.js downloaded and ran,
  // dataLayer accumulated entries correctly, but NO hit was ever actually sent — no console error,
  // no CSP violation, nothing visibly wrong; only a side-by-side test caught it. `function`
  // (not an arrow function) is required so `arguments` is available.
  // eslint-disable-next-line prefer-rest-params
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };
  window.gtag('js', new Date());
  window.gtag('config', measurementId);
}

/**
 * Call whenever the current consent state is known or changes (on load, and from the consent
 * banner). No-ops with no measurement ID configured. Safe to call repeatedly — the underlying
 * script is only ever injected once, but the live consentGranted flag always reflects the latest
 * call, so trackEvent correctly stops firing if consent is later revoked.
 */
export function setAnalyticsConsent(granted: boolean, measurementId: string | undefined): void {
  consentGranted = granted;
  if (granted && measurementId) injectGtagScript(measurementId);
}

/** No-ops unless consent is CURRENTLY granted (checked live, not "was ever granted"). */
export function trackEvent(name: string, params?: Record<string, unknown>): void {
  if (!consentGranted || !window.gtag) return;
  window.gtag('event', name, params);
}
