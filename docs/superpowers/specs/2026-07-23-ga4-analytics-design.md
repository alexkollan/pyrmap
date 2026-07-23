# GA4 analytics with consent gating — design

## Motivation

The app is going public and the owner wants visibility into how it's actually used (clicks,
feature usage), via Google Analytics 4. Since this is a Greece-facing public site with EU
visitors, GDPR/ePrivacy require consent before any non-essential tracking cookie/script loads —
so nothing analytics-related loads until a visitor makes an explicit choice.

Decision (see chat): direct `gtag.js`, not Google Tag Manager. GTM's value is letting a
non-developer add/adjust tags without code changes; since all tracking here is custom
developer-authored events either way, GTM would only add an extra script load and a separate,
more complex consent-mode setup for no benefit in this project.

## Consent banner

A bottom-of-screen bar, shown once per visitor (state persisted in `localStorage` under
`pyrmap-consent` as `{ analytics: boolean; decidedAt: string }`), with three states:

1. **Prompt** (first visit, or consent never given): "This site uses cookies for analytics." +
   **Accept** / **Edit** buttons.
2. **Editing** (after clicking Edit, or reopened later): one toggle, "Analytics cookies" —
   **on by default** per explicit instruction — + **Save**.
3. **Hidden** (a choice already exists): banner itself disappears, replaced by a small persistent
   **"Cookie settings"** link/button (bottom corner) that reopens state 2, pre-filled with the
   current stored choice — GDPR expects withdrawing consent to be as easy as giving it.

Clicking **Accept** stores `{analytics: true, ...}` and enables analytics immediately. Clicking
**Save** (from Editing) stores whatever the toggle currently says and enables/disables analytics
to match. Nothing is sent to Google at all until one of these two actions happens.

**Known nuance, called out to the user already and accepted**: defaulting the Editing toggle to
*on* is a slightly weaker consent signal under a strict GDPR reading (regulators generally prefer
opt-in toggles default *off*); the direct **Accept** button is unambiguous consent either way.
Implementing as specified since it's an informed choice, not an oversight.

## `packages/web/src/lib/analytics.ts` (new file)

```ts
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

/** Call whenever the current consent state is known or changes (on load, and from the banner). No-ops with no measurement ID configured. */
export function setAnalyticsConsent(granted: boolean, measurementId: string | undefined): void {
  consentGranted = granted;
  if (granted && measurementId) injectGtagScript(measurementId);
}

/** No-ops unless consent is currently granted — checked live, not just "was ever granted", so revoking consent later actually stops future events even if the script loaded earlier in this session. */
export function trackEvent(name: string, params?: Record<string, unknown>): void {
  if (!consentGranted || !window.gtag) return;
  window.gtag('event', name, params);
}
```

Revoking consent after the script already loaded can't delete data already sent (no real-world
consent banner does this — Google/regulators expect cessation of *future* tracking, not
retroactive deletion), but `trackEvent` correctly stops firing immediately, which is the part
actually under this app's control.

## `packages/web/src/components/ConsentBanner.tsx` (new file)

Renders the three states described above; calls `storeConsent` + `setAnalyticsConsent` on
Accept/Save. Re-establishing a *prior* visit's consent (so a returning "accepted" visitor gets
analytics re-initialized on this page load) happens inside the component's `useState` **lazy
initializer**, not a `useEffect`:

```ts
const [state, setState] = useState<BannerState>(() => {
  const stored = loadStoredConsent();
  setAnalyticsConsent(stored?.analytics ?? false, measurementId);
  return stored ? 'hidden' : 'prompt';
});
```

This matters: `useEffect` callbacks fire bottom-up (children before parents) on first mount, so a
descendant's own effect — e.g. `FireMap`'s `focus_target_opened` firing from a push-notification
deep link — could run *before* a parent's `useEffect` re-granted consent, silently dropping that
one event even for a returning, already-consented visitor. A lazy `useState` initializer runs
synchronously during this component's own render, which (as long as `<ConsentBanner />` appears
*before* `<MapApp />` in `App.tsx`'s JSX) completes before `MapApp` — and everything inside it —
even begins rendering. Mount `<ConsentBanner />` first for exactly this reason.

`measurementId` comes from `import.meta.env.VITE_GA_MEASUREMENT_ID as string | undefined` — passed
down from `App.tsx`, not read independently in multiple places.

## Event tracking

`trackEvent(name, params)` calls added at each existing interaction handler (call sites below are
exact functions/files from the current code, not speculative):

| Event | Where | Params |
|---|---|---|
| `time_window_change` | `MapApp.tsx`, `onHoursChange` | `{ hours }` |
| `refresh_click` | `StatusBar.tsx`, `onRefresh` handler | — |
| `rescan_trigger` | `MapApp.tsx`, `handleRescan` | `{ hours }` |
| `theme_toggle` | `MapApp.tsx`, `toggleTheme` | `{ to: next }` |
| `view_mode_toggle` | `MapApp.tsx`, `toggleViewMode` | `{ to: next }` |
| `edit_mode_toggle` | `MapApp.tsx`, edit-mode setter | `{ to: 'on'\|'off' }` |
| `push_notifications_toggle` | `MapApp.tsx`, `togglePush` | `{ to: 'enabled'\|'disabled' }` |
| `layer_toggle` | `MapApp.tsx`, `changeLayerPrefs` (diff old vs next per boolean field + `hiddenSources`) | `{ layer, enabled }` |
| `layers_panel_toggle` | `LayersPanel.tsx`, collapse button | `{ collapsed }` |
| `marker_click` | `FireMarker.tsx` (`PolarMarker`/`GeoMarker`, new `eventHandlers.click`), `IncidentMarker.tsx` (new `click` handler alongside existing `dragend`) | `{ tier: 'polar'\|'geo'\|'incident' }` |
| `incident_original_post_click` | `IncidentMarker.tsx`, the "View original post" link's `onClick` | — |
| `incident_pin_dragged` | `IncidentMarker.tsx`, existing `dragend` handler | — |
| `incident_pin_manual_save` | `IncidentEditControls.tsx`, `handleSaveCoordinates` | — |
| `incident_location_search` | `IncidentEditControls.tsx`, `handleSearch` | `{ resultCount }` (never the query text itself — free-text search terms could be identifying, and there's no analytical value in Google seeing them) |
| `incident_pin_search_pick` | `IncidentEditControls.tsx`, `handlePickResult` | — |
| `incident_pin_hidden` | `IncidentEditControls.tsx`, `handleHide` (only if actually confirmed) | — |
| `incident_pin_deleted` | `IncidentEditControls.tsx`, `handleDelete` (only if actually confirmed) | — |
| `login_attempt` | `LoginForm.tsx`, `handleSubmit` | `{ success }` (never credentials) |
| `logout_click` | `App.tsx`/`StatusBar.tsx`, logout handler | — |
| `login_prompt_opened` | `App.tsx`, wherever "Log in" is clicked (see companion public-mode spec) | — |
| `focus_target_opened` | `FireMap.tsx`, `FocusHandler` (once, when a push-notification deep-link target is applied) | `{ tier }` |

Automatic `page_view` comes from `gtag('config', ...)` itself, fired at whatever moment consent is
granted/re-established (not at the real initial page load if consent comes later) — an inherent,
accepted limitation of consent-gated analytics, not a bug.

## Env var / build wiring (the part that isn't "just add a var")

`VITE_GA_MEASUREMENT_ID` is a **build-time** value, unlike every other env var in this project —
Vite bakes `import.meta.env.VITE_*` values into the static JS bundle when it runs, not read at
container runtime. It still isn't a secret (Measurement IDs are always visible in any page's
source), but it needs a different wiring path than the usual "4 places" runtime-env rule:

1. `packages/web/vite.config.ts` gains `envDir: '../..'` so Vite reads the *same* root `.env` the
   server already uses (avoiding a second, separate env file just for the frontend).
2. `.env.example`: add `VITE_GA_MEASUREMENT_ID=` (empty placeholder, documented as build-time-only
   and GA4-property-specific).
3. Root `.env`: **leave empty for local dev** — setting the real production Measurement ID locally
   would mix local testing traffic into the real property's data. Only the deployed environment
   should have a real value.
4. `Dockerfile`: in the `build` stage, before `RUN pnpm -r build`:
   ```dockerfile
   ARG VITE_GA_MEASUREMENT_ID
   ENV VITE_GA_MEASUREMENT_ID=$VITE_GA_MEASUREMENT_ID
   ```
5. `docker-compose.yml`: expand `build: .` into
   ```yaml
   build:
     context: .
     args:
       VITE_GA_MEASUREMENT_ID: ${VITE_GA_MEASUREMENT_ID}
   ```
   (interpolated from the same top-level env context `HOST_DATA_DIR` already relies on — Portainer
   already passes its stack "Environment variables" into that context, so setting
   `VITE_GA_MEASUREMENT_ID` there, alongside the existing vars, is enough on the user's side —
   flagged clearly in the handoff so it isn't missed the way `AUTH_*` was before.)
6. It is **not** added to the runtime `environment:` block — the running Node server has no use
   for it at all.

## Testing

- `lib/analytics.ts` unit tests (this file is pure/mockable — `document.createElement`,
  `localStorage`): `loadStoredConsent`/`storeConsent` round-trip and malformed-JSON handling;
  `trackEvent` no-ops with no consent and with consent revoked after being granted; `gtag` script
  is only injected once even if `setAnalyticsConsent(true, id)` is called twice.
- No component test for `ConsentBanner`'s three-state UI (no component-test setup in this
  codebase, per existing convention) — verified manually in a real browser: banner appears on
  first visit, Accept hides it and a network request to `googletagmanager.com` fires, Edit reveals
  the toggle defaulted on, unchecking + Save stores the decline and does *not* fire a
  `googletagmanager.com` request, "Cookie settings" reopens with the last choice reflected.
- A couple of the `trackEvent` call sites (e.g. `rescan_trigger`, `theme_toggle`) spot-checked live
  in the same manual browser session via the GA4 DebugView (user-side: enable "Debug mode" in GA4
  or use the browser network tab to confirm the `collect`/`g/collect` request fires with the right
  event name) — not something to automate, just a one-time sanity check before calling this done.

## Out of scope

- Google Consent Mode (the more complex, Google-recommended pattern that still sends
  reduced/modeled pings even without consent) — deliberately not used; this implementation sends
  nothing at all pre-consent, which is simpler and more clearly compliant, at the cost of losing
  Google's own aggregate modeling for users who decline.
- A staging/second GA4 property for pre-production testing — not needed at this app's scale.
