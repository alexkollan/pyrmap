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
  window.gtag = function gtag(...args: unknown[]) {
    window.dataLayer!.push(args);
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
