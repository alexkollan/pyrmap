# Public Mode, Security Hardening, and GA4 Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app safe to present publicly at `pyrmap.alexcoll.in` — split access into a public viewing tier and an admin (login-gated) tier for Re-scan/Edit-pins/push-subscription, harden the now-public HTTP surface, fix a real tile-provider policy risk, and add consent-gated GA4 analytics with a broad event-tracking taxonomy.

**Architecture:** Backend: `app.ts` splits its single protected route group into a public group (fires/status/SSE) and an admin group (rescan/incident-edit/push-subscribe) behind the existing `requireAuth` hook, plus `@fastify/helmet` (CSP) and `@fastify/rate-limit` registered globally. Frontend: `App.tsx` always renders the map (never blocks it behind login), computes an `isAdmin` flag, and shows a dismissable login modal instead of a full-page gate; GA4 loads via a small hand-rolled consent module (no GTM), gated behind a 3-state consent banner, with `trackEvent()` calls sprinkled at existing interaction handlers.

**Tech Stack:** Fastify + `@fastify/helmet` + `@fastify/rate-limit` (new deps), React, Vite (`envDir` change for a shared root `.env`), Docker build-arg plumbing for the one build-time frontend env var, Playwright (manual verification, same technique as the incident-pin-correction work).

## Global Constraints

- `pnpm -r build && pnpm test` must pass before every commit — no exceptions.
- Every new dependency needs a justification comment at the import site AND a `docs/DECISIONS.md` entry (closed dependency whitelist).
- Tests must not hit real external APIs (Nominatim, GA4, Cloudflare) — fake/mock as needed.
- SQL lives only in `adapters/sqlite/`; no changes to that layer in this plan.
- Conventional Commits, one commit per working unit.
- Do not push to `main` — that triggers a real production deploy. Stop after the final task and report; the user pushes when ready.
- Full designs: `docs/superpowers/specs/2026-07-23-public-mode-and-hardening-design.md` and `docs/superpowers/specs/2026-07-23-ga4-analytics-design.md` — read the relevant section if anything here is ambiguous.

---

## Task 1: `@fastify/helmet`, `@fastify/rate-limit`, `trustProxy`

**Files:**
- Modify: `packages/server/package.json` (new deps)
- Modify: `packages/server/src/app.ts`
- Test: `packages/server/test/security.test.ts` (create)
- Modify: `docs/DECISIONS.md`

**Interfaces:**
- Produces: `app.ts`'s `Fastify(...)` call gains `trustProxy: true`; every response gains helmet's CSP header; `POST /api/login` gains a strict rate limit; all other routes gain a looser global rate limit.

- [ ] **Step 1: Add the dependencies**

Run: `cd packages/server && pnpm add @fastify/helmet @fastify/rate-limit`

Expected: both added to `packages/server/package.json`'s `dependencies`, versions compatible with the existing `fastify ^5.2.0` (both are official Fastify-team packages; `pnpm add` resolves a Fastify-v5-compatible version automatically).

- [ ] **Step 2: Write the failing security tests**

Create `packages/server/test/security.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { SqliteFireRepository } from '../src/adapters/sqlite/SqliteFireRepository.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AuthConfig } from '../src/routes/auth.js';

const AUTH: AuthConfig = { username: 'alex', password: 'secret-pw', sessionSecret: 'test-secret' };

async function setup() {
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'pyrmap-security-test-'));
  const repo = new SqliteFireRepository(path.join(tmpDir, 'test.db'));
  const app = await buildApp({ logLevel: 'silent' }, repo, undefined, '/nonexistent', undefined, undefined, AUTH);
  return { app, cleanup: () => { repo.close(); rmSync(tmpDir, { recursive: true, force: true }); } };
}

describe('security headers', () => {
  it('sends a Content-Security-Policy header', async () => {
    const { app, cleanup } = await setup();
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
    cleanup();
  });
});

describe('login rate limiting', () => {
  it('returns 429 after too many login attempts from the same client', async () => {
    const { app, cleanup } = await setup();
    let lastStatus = 200;
    for (let i = 0; i < 10; i++) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/login',
        payload: { username: 'wrong', password: 'wrong' },
      });
      lastStatus = response.statusCode;
    }
    expect(lastStatus).toBe(429);
    cleanup();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @pyrmap/server test -- security`
Expected: FAIL — no CSP header yet, no 429 yet (all 10 attempts return 401).

- [ ] **Step 4: Wire helmet, rate-limit, and trustProxy into `app.ts`**

Add imports near the top of `packages/server/src/app.ts` (after the `fastifyStatic` import):

```ts
// New dependency, outside the historically closed list — explicit user request for security
// hardening now that the app is public (docs/DECISIONS.md 2026-07-23). Official Fastify-team
// package, MIT licensed.
import fastifyHelmet from '@fastify/helmet';
// Same justification as fastifyHelmet above.
import fastifyRateLimit from '@fastify/rate-limit';
```

Change the `Fastify({...})` call:

```ts
  const app = Fastify({ logger: { level: config.logLevel }, trustProxy: true });
```

Immediately after that line, before `await app.register(healthRoutes(repository));`, add:

```ts
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://www.googletagmanager.com'],
        connectSrc: [
          "'self'",
          'https://www.google-analytics.com',
          'https://*.google-analytics.com',
          'https://*.analytics.google.com',
          'https://api.open-meteo.com',
        ],
        imgSrc: ["'self'", 'data:', 'https://basemaps.cartocdn.com', 'https://maps.effis.emergency.copernicus.eu'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'self'"],
      },
    },
  });
  await app.register(fastifyRateLimit, { max: 100, timeWindow: '1 minute' });
```

- [ ] **Step 5: Add the login-specific stricter rate limit**

In `packages/server/src/routes/auth.ts`, change the `/api/login` route registration to add a
route-level rate-limit override (Fastify's `@fastify/rate-limit` supports per-route `config.rateLimit`):

```ts
    app.post<{ Body: LoginBody }>(
      '/api/login',
      { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
      async (request, reply) => {
```

(Only the route registration's second argument changes — the handler body is untouched. Close the
extra argument's brace/paren correctly to match the existing handler function that follows.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @pyrmap/server test -- security`
Expected: PASS.

- [ ] **Step 7: Full server build+test**

Run: `pnpm --filter @pyrmap/server build && pnpm --filter @pyrmap/server test`
Expected: both succeed, no regressions (check existing auth/rescan/incidents tests still pass —
the global 100/minute limit is generous enough not to trip normal test traffic within one test
file's run, but if any test file makes >100 requests in the same run, note it and either raise that
specific limit's test-only threshold or confirm it's still fine before moving on).

- [ ] **Step 8: Log the decisions**

Append to `docs/DECISIONS.md`:

```
2026-07-23 | server | added @fastify/helmet (CSP + standard security headers) and @fastify/rate-limit (login: 5/min, global: 100/min), plus Fastify's trustProxy: true | explicit user request ("make sure I will not be hacked") now that the app is public; trustProxy needed because the app sits behind a Cloudflare Tunnel — without it, rate-limiting would key off the tunnel's own address instead of real visitor IPs
```

- [ ] **Step 9: Commit**

```bash
git add packages/server/package.json packages/server/pnpm-lock.yaml packages/server/src/app.ts packages/server/src/routes/auth.ts packages/server/test/security.test.ts docs/DECISIONS.md
git commit -m "feat(server): add helmet CSP, rate limiting, and trustProxy for public-facing hardening"
```

(If `pnpm add` updated a root `pnpm-lock.yaml` instead of a per-package one, adjust the `git add` path accordingly — check `git status` first.)

---

## Task 2: Public vs. admin route split

**Files:**
- Modify: `packages/server/src/app.ts`
- Test: `packages/server/test/publicAccess.test.ts` (create)

**Interfaces:**
- Consumes: existing `firesRoutes`, `statusRoutes`, `eventsRoutes`, `pushRoutes`, `rescanRoutes`, `incidentEditRoutes` factories (all unchanged).
- Produces: no signature changes to `buildApp` — only which of two route groups each factory is registered under changes.

- [ ] **Step 1: Write the failing test**

Create `packages/server/test/publicAccess.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/app.js';
import { SqliteFireRepository } from '../src/adapters/sqlite/SqliteFireRepository.js';
import { SqliteIncidentReportRepository } from '../src/adapters/sqlite/SqliteIncidentReportRepository.js';
import type { AuthConfig } from '../src/routes/auth.js';

const AUTH: AuthConfig = { username: 'alex', password: 'secret-pw', sessionSecret: 'test-secret' };

async function setup() {
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'pyrmap-public-access-test-'));
  const fireRepo = new SqliteFireRepository(path.join(tmpDir, 'fires.db'));
  const incidentRepo = new SqliteIncidentReportRepository(path.join(tmpDir, 'incidents.db'));
  const app = await buildApp({ logLevel: 'silent' }, fireRepo, undefined, '/nonexistent', incidentRepo, undefined, AUTH);
  return {
    app,
    cleanup: () => {
      fireRepo.close();
      incidentRepo.close();
      rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

describe('public vs admin access, with auth configured', () => {
  it('allows /api/fires, /api/status without a session', async () => {
    const { app, cleanup } = await setup();
    expect((await app.inject({ method: 'GET', url: '/api/fires?hours=24' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/status' })).statusCode).toBe(200);
    cleanup();
  });

  it('still requires a session for /api/rescan, incident-edit routes, and push subscribe', async () => {
    const { app, cleanup } = await setup();
    expect((await app.inject({ method: 'POST', url: '/api/rescan', payload: { hours: 6 } })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: 'PATCH', url: '/api/incidents/1/location', payload: { latitude: 1, longitude: 1 } }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/push/subscribe',
          payload: { endpoint: 'x', keys: { p256dh: 'a', auth: 'b' } },
        })
      ).statusCode,
    ).toBe(401);
    cleanup();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pyrmap/server test -- publicAccess`
Expected: FAIL on the first assertion — `/api/fires` currently 401s without a session since it's
still in the single protected group.

- [ ] **Step 3: Split the route group in `app.ts`**

Replace the single `await app.register(async (protectedApp) => {...})` block with two groups:

```ts
  await app.register(async (publicApp) => {
    await publicApp.register(firesRoutes(repository, now, incidentRepository));
    await publicApp.register(statusRoutes(repository, now));
    await publicApp.register(eventsRoutes(updateBus));
  });

  await app.register(async (adminApp) => {
    if (auth) {
      adminApp.addHook('onRequest', requireAuth(auth.sessionSecret));
    }
    if (pushSubscriptionRepository) {
      await adminApp.register(pushRoutes(pushSubscriptionRepository));
    }
    if (getScheduler) {
      await adminApp.register(rescanRoutes(getScheduler));
    }
    if (incidentRepository) {
      await adminApp.register(incidentEditRoutes(incidentRepository, locationSearchSource, updateBus));
    }
  });
```

Update the doc comment above `buildApp` (currently describing the old single-group behavior) to:

```ts
/** Builds a Fastify instance without starting the listener — used by both index.ts and tests.
 * `auth` is null for open access (local dev default). When set: /api/fires, /api/status, and
 * /api/events stay public (viewing the map needs no login); /api/rescan, the incident-edit
 * routes, and /api/push/subscribe|unsubscribe require a valid session cookie. /api/health,
 * /api/login, /api/logout, /api/me, /api/push/vapid-public-key, and the static frontend itself
 * stay reachable either way. */
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pyrmap/server test -- publicAccess`
Expected: PASS.

- [ ] **Step 5: Full server build+test**

Run: `pnpm --filter @pyrmap/server build && pnpm --filter @pyrmap/server test`
Expected: both succeed — in particular re-check `test/fires.test.ts`, `test/status.test.ts`,
`test/events.test.ts`, `test/rescan.test.ts`, `test/incidents.test.ts`, and `test/push.test.ts`
still all pass (their existing "requires a session" assertions for rescan/incidents/push-subscribe
must still hold; anything asserting fires/status/events required a session before must now be
updated to expect success, matching the new intended behavior — check `test/auth.test.ts`
specifically for any such now-outdated assertion and fix it there, since that file already
predates this change).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/app.ts packages/server/test/publicAccess.test.ts packages/server/test/auth.test.ts
git commit -m "feat(server): split routes into a public viewing tier and an admin (login-gated) tier"
```

(Include `test/auth.test.ts` only if Step 5 required editing it.)

---

## Task 3: Tile-provider fix (light mode → CARTO)

**Files:**
- Modify: `packages/web/src/components/FireMap.tsx`

**Interfaces:** None (internal constant change only).

- [ ] **Step 1: Change the light tile layer**

In `packages/web/src/components/FireMap.tsx`, change:

```ts
const TILE_LAYERS: Record<Theme, { url: string; attribution: string }> = {
  light: { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: OSM_ATTRIBUTION },
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: CARTO_ATTRIBUTION,
  },
};
```

to:

```ts
// Light mode was tile.openstreetmap.org directly; that server's usage policy explicitly excludes
// production/heavy-traffic apps (docs/DECISIONS.md 2026-07-23) — switched to CARTO's light_all,
// the same provider dark mode already uses, same attribution requirement already met.
const TILE_LAYERS: Record<Theme, { url: string; attribution: string }> = {
  light: {
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: CARTO_ATTRIBUTION,
  },
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: CARTO_ATTRIBUTION,
  },
};
```

`OSM_ATTRIBUTION` becomes unused — delete its `const` declaration too.

- [ ] **Step 2: Build web package**

Run: `pnpm --filter @pyrmap/web build`
Expected: succeeds (deleting the now-unused `OSM_ATTRIBUTION` avoids a TS/lint unused-var error).

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/FireMap.tsx
git commit -m "fix(web): switch light-mode basemap from raw OSM tiles to CARTO light_all"
```

---

## Task 4: Frontend admin gating (public map, login modal, StatusBar)

**Files:**
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/src/components/LoginForm.tsx`
- Modify: `packages/web/src/MapApp.tsx`
- Modify: `packages/web/src/components/StatusBar.tsx`
- Modify: `packages/web/src/index.css`

**Interfaces:**
- Produces: `MapApp` gains `isAdmin: boolean` and `onRequestLogin?: () => void` props. `StatusBar` gains `isAdmin: boolean` and `onRequestLogin?: () => void`. `LoginForm` gains `onCancel: () => void`.

- [ ] **Step 1: Rework `App.tsx`**

Replace the whole file:

```tsx
import { useEffect, useState } from 'react';
import { MapApp } from './MapApp.js';
import { LoginForm } from './components/LoginForm.js';
import { checkAuth, logout, type AuthStatus } from './api/client.js';

/**
 * The map is always public: viewing never requires a login. `isAdmin` gates Re-scan/Edit-pins/
 * push-subscription controls (see MapApp/StatusBar) — true when auth isn't configured at all
 * (local-dev open-access convention, unchanged) or when this session is actually authenticated.
 * /api/me is only routed at all when the server has AUTH_* env vars set (see routes/auth.ts) — a
 * 404 there means auth is off entirely, not "not logged in".
 */
export function App(): JSX.Element {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [showLogin, setShowLogin] = useState(false);

  useEffect(() => {
    checkAuth().then(setStatus);
  }, []);

  if (!status) {
    return <div className="auth-loading">Loading…</div>;
  }

  const isAdmin = !status.enabled || status.authenticated;

  return (
    <>
      <MapApp
        isAdmin={isAdmin}
        onRequestLogin={status.enabled && !isAdmin ? () => setShowLogin(true) : undefined}
        onLogout={
          status.enabled && isAdmin
            ? () => {
                void logout();
                setStatus({ enabled: true, authenticated: false });
              }
            : undefined
        }
      />
      {showLogin && (
        <LoginForm
          onSuccess={() => {
            setStatus({ enabled: true, authenticated: true });
            setShowLogin(false);
          }}
          onCancel={() => setShowLogin(false)}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2: `LoginForm` gains a cancel/close affordance**

In `packages/web/src/components/LoginForm.tsx`, change the function signature:

```tsx
export function LoginForm({ onSuccess, onCancel }: { onSuccess: () => void; onCancel: () => void }): JSX.Element {
```

Add a close button right after the opening `<form ...>` tag's `<div className="login-title">🔥 PyrMap</div>` line:

```tsx
        <div className="login-title">🔥 PyrMap</div>
        <button type="button" className="login-cancel" onClick={onCancel} aria-label="Cancel login">
          ✕
        </button>
```

- [ ] **Step 3: Make `.login-container` an overlay, not full document flow**

In `packages/web/src/index.css`, change:

```css
.login-container {
  height: 100vh;
  width: 100vw;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #1a1a1a;
  font-family: system-ui, sans-serif;
}
```

to:

```css
.login-container {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #1a1a1a;
  font-family: system-ui, sans-serif;
}

.login-cancel {
  position: absolute;
  top: 1rem;
  right: 1rem;
  background: transparent;
  border: none;
  color: #e5e5e5;
  font-size: 1.1rem;
  cursor: pointer;
}
```

(`.login-form` needs `position: relative;` added to its existing rule so the absolutely-positioned
cancel button anchors to the form card, not the full-screen overlay — add that one property to the
existing `.login-form { ... }` block.)

- [ ] **Step 4: Thread `isAdmin`/`onRequestLogin` through `MapApp`**

In `packages/web/src/MapApp.tsx`, change `MapAppProps`:

```ts
export interface MapAppProps {
  isAdmin: boolean;
  /** Present only when auth is configured and this session isn't the admin — clicking it opens the login modal. */
  onRequestLogin?: () => void;
  /** Only shown when the server actually has auth enabled and this session IS the admin — hidden entirely otherwise. */
  onLogout?: () => void;
}
```

Change the function signature:

```ts
export function MapApp({ isAdmin, onRequestLogin, onLogout }: MapAppProps): JSX.Element {
```

Pass both new values into `StatusBar` (alongside the existing props):

```tsx
        isAdmin={isAdmin}
        onRequestLogin={onRequestLogin}
        onLogout={onLogout}
```

- [ ] **Step 5: Gate the admin-only controls in `StatusBar`**

In `packages/web/src/components/StatusBar.tsx`, add to `StatusBarProps`:

```ts
  isAdmin: boolean;
  onRequestLogin?: () => void;
```

Add to the destructured parameters:

```ts
  isAdmin,
  onRequestLogin,
```

Wrap the Re-scan `<select>`, the Edit-pins `<button>`, the push notification `<button>`, and the
push-install hint `<span>` each in `{isAdmin && (...)}`. Concretely, change:

```tsx
      <select
        className="rescan-select"
        ...
      >
        ...
      </select>
```

to:

```tsx
      {isAdmin && (
        <select
          className="rescan-select"
          ...
        >
          ...
        </select>
      )}
```

Do the same for the Edit-pins button:

```tsx
      {isAdmin && (
        <button type="button" onClick={onToggleEditMode} aria-label="Toggle pin edit mode">
          {editMode ? 'Done editing' : 'Edit pins'}
        </button>
      )}
```

And for both the push button and push-install hint:

```tsx
      {isAdmin && pushSupported && (
        <button type="button" onClick={onTogglePush} aria-label="Toggle push notifications">
          {pushEnabled ? '🔔 Notifications on' : '🔕 Enable notifications'}
        </button>
      )}
      {isAdmin && pushNeedsInstall && (
        <span className="push-install-hint" title="Add to Home Screen from Safari's share menu, then reopen from there">
          Add to Home Screen for notifications
        </span>
      )}
```

Add a "Log in" button next to the existing "Log out" one:

```tsx
      {onLogout && (
        <button type="button" className="logout-button" onClick={onLogout}>
          Log out
        </button>
      )}
      {onRequestLogin && (
        <button type="button" className="logout-button" onClick={onRequestLogin}>
          Log in
        </button>
      )}
```

- [ ] **Step 6: Build web package**

Run: `pnpm --filter @pyrmap/web build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/App.tsx packages/web/src/components/LoginForm.tsx packages/web/src/MapApp.tsx packages/web/src/components/StatusBar.tsx packages/web/src/index.css
git commit -m "feat(web): make the map public by default, gating Re-scan/Edit-pins/push behind a dismissable login modal"
```

---

## Task 5: GA4 core — `analytics.ts`, `ConsentBanner.tsx`

**Files:**
- Create: `packages/web/src/lib/analytics.ts`
- Test: `packages/web/src/lib/analytics.test.ts`
- Create: `packages/web/src/components/ConsentBanner.tsx`
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/src/index.css`

**Interfaces:**
- Produces: `loadStoredConsent(): ConsentChoice | null`, `storeConsent(choice): void`,
  `setAnalyticsConsent(granted: boolean, measurementId: string | undefined): void`,
  `trackEvent(name: string, params?: Record<string, unknown>): void` from `lib/analytics.ts`.
  `ConsentBanner` component takes `{ measurementId?: string }`.

- [ ] **Step 1: Write the failing unit tests**

Create `packages/web/src/lib/analytics.test.ts`:

```ts
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

describe('trackEvent', () => {
  it('does nothing when consent has never been granted', () => {
    trackEvent('test_event');
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

  it('does nothing when no measurement ID is configured, even with consent granted', () => {
    setAnalyticsConsent(true, undefined);
    expect(document.head.querySelector('script[src*="googletagmanager"]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @pyrmap/web test -- analytics`
Expected: FAIL — `./analytics.js` doesn't exist yet.

- [ ] **Step 3: Implement `analytics.ts`**

Create `packages/web/src/lib/analytics.ts`:

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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @pyrmap/web test -- analytics`
Expected: PASS.

- [ ] **Step 5: Create `ConsentBanner.tsx`**

Create `packages/web/src/components/ConsentBanner.tsx`:

```tsx
import { useState } from 'react';
import { loadStoredConsent, setAnalyticsConsent, storeConsent } from '../lib/analytics.js';

type BannerState = 'hidden' | 'prompt' | 'editing';

/**
 * Mount this BEFORE <MapApp/> in App.tsx's JSX. Re-establishing a prior visit's consent happens in
 * this component's lazy useState initializer (not a useEffect) so it runs synchronously during
 * this component's own render, before any descendant of MapApp even begins rendering — useEffect
 * callbacks fire bottom-up (children before parents) on first mount, which could otherwise let a
 * child's own effect (e.g. FireMap's focus_target_opened) fire before consent was re-granted.
 */
export function ConsentBanner({ measurementId }: { measurementId?: string }): JSX.Element {
  const [state, setState] = useState<BannerState>(() => {
    const stored = loadStoredConsent();
    setAnalyticsConsent(stored?.analytics ?? false, measurementId);
    return stored ? 'hidden' : 'prompt';
  });
  const [toggleOn, setToggleOn] = useState(true);

  function accept(): void {
    storeConsent({ analytics: true, decidedAt: new Date().toISOString() });
    setAnalyticsConsent(true, measurementId);
    setState('hidden');
  }

  function save(): void {
    storeConsent({ analytics: toggleOn, decidedAt: new Date().toISOString() });
    setAnalyticsConsent(toggleOn, measurementId);
    setState('hidden');
  }

  function reopen(): void {
    setToggleOn(loadStoredConsent()?.analytics ?? true);
    setState('editing');
  }

  if (state === 'hidden') {
    return (
      <button type="button" className="cookie-settings-link" onClick={reopen}>
        Cookie settings
      </button>
    );
  }

  return (
    <div className="consent-banner">
      {state === 'prompt' && (
        <>
          <span>This site uses cookies for analytics.</span>
          <div className="consent-banner-actions">
            <button type="button" onClick={accept}>
              Accept
            </button>
            <button type="button" onClick={() => setState('editing')}>
              Edit
            </button>
          </div>
        </>
      )}
      {state === 'editing' && (
        <>
          <label className="consent-toggle-row">
            <input type="checkbox" checked={toggleOn} onChange={(event) => setToggleOn(event.target.checked)} />
            Analytics cookies
          </label>
          <div className="consent-banner-actions">
            <button type="button" onClick={save}>
              Save
            </button>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Mount it in `App.tsx`, before `MapApp`**

In `packages/web/src/App.tsx`, add the import:

```ts
import { ConsentBanner } from './components/ConsentBanner.js';
```

Add a `measurementId` constant near the top of the `App` function body:

```ts
  const measurementId = import.meta.env.VITE_GA_MEASUREMENT_ID as string | undefined;
```

Change the returned JSX so `<ConsentBanner />` appears first:

```tsx
  return (
    <>
      <ConsentBanner measurementId={measurementId} />
      <MapApp
        ...
```

(The closing `</>` and the rest of the JSX from Task 4's version stays as-is — this only adds the
one new sibling element and the constant above it.)

- [ ] **Step 7: Add CSS**

Append to `packages/web/src/index.css`:

```css
.consent-banner {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 2500;
  background: #1a1a1a;
  color: #e5e5e5;
  padding: 0.75rem 1rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.75rem;
  font-size: 0.9rem;
  box-shadow: 0 -2px 12px rgba(0, 0, 0, 0.4);
}

.consent-banner-actions {
  display: flex;
  gap: 0.5rem;
}

.consent-toggle-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.cookie-settings-link {
  position: fixed;
  bottom: 0.5rem;
  left: 0.5rem;
  z-index: 2500;
  background: transparent;
  border: none;
  color: #9ca3af;
  font-size: 0.75rem;
  text-decoration: underline;
  cursor: pointer;
}
```

- [ ] **Step 8: Build web package and run full web test suite**

Run: `pnpm --filter @pyrmap/web build && pnpm --filter @pyrmap/web test`
Expected: both succeed.

- [ ] **Step 9: Commit**

```bash
git add packages/web/src/lib/analytics.ts packages/web/src/lib/analytics.test.ts packages/web/src/components/ConsentBanner.tsx packages/web/src/App.tsx packages/web/src/index.css
git commit -m "feat(web): add consent-gated GA4 loading via a hand-rolled gtag wrapper (no GTM)"
```

---

## Task 6: Build-time env wiring for `VITE_GA_MEASUREMENT_ID`

**Files:**
- Modify: `packages/web/vite.config.ts`
- Modify: `.env.example`
- Modify: `Dockerfile`
- Modify: `docker-compose.yml`

**Interfaces:** None (build configuration only).

- [ ] **Step 1: Share the root `.env` with Vite**

In `packages/web/vite.config.ts`, add `envDir` to the `defineConfig({...})` call:

```ts
export default defineConfig({
  envDir: '../..',
  plugins: [react()],
```

- [ ] **Step 2: Document the var in `.env.example`**

Append to `.env.example`:

```
# Optional: GA4 Measurement ID (e.g. G-XXXXXXXXXX) from analytics.google.com — create a GA4
# property + Web data stream for the deployed domain and copy its Measurement ID here. NOT a
# secret (it's always visible in any page's source) but this is a BUILD-TIME value: Vite bakes it
# into the static JS bundle when the frontend is built, unlike every other var in this file, which
# is read at container runtime. See Dockerfile/docker-compose.yml for how it's plumbed through as
# a build-arg. Leave empty for local dev — a real ID here would mix local testing into the real
# GA4 property's data.
VITE_GA_MEASUREMENT_ID=
```

- [ ] **Step 3: Add the Dockerfile ARG**

In `Dockerfile`, add before `RUN pnpm -r build`:

```dockerfile
ARG VITE_GA_MEASUREMENT_ID
ENV VITE_GA_MEASUREMENT_ID=$VITE_GA_MEASUREMENT_ID
RUN pnpm -r build
```

- [ ] **Step 4: Pass it through as a compose build-arg**

In `docker-compose.yml`, change:

```yaml
services:
  pyrmap:
    build: .
```

to:

```yaml
services:
  pyrmap:
    build:
      context: .
      args:
        VITE_GA_MEASUREMENT_ID: ${VITE_GA_MEASUREMENT_ID:-}
```

- [ ] **Step 5: Full monorepo build**

Run: `pnpm -r build`
Expected: succeeds (with `VITE_GA_MEASUREMENT_ID` unset locally, the web build just embeds
`undefined`, and `ConsentBanner`'s `setAnalyticsConsent` no-ops — confirmed already by Task 5's
unit test for "no measurement ID configured").

- [ ] **Step 6: Commit**

```bash
git add packages/web/vite.config.ts .env.example Dockerfile docker-compose.yml
git commit -m "chore(repo): wire VITE_GA_MEASUREMENT_ID through as a Docker build-arg, not a runtime var"
```

---

## Task 7: Event tracking call sites

**Files:**
- Modify: `packages/web/src/MapApp.tsx`
- Modify: `packages/web/src/components/StatusBar.tsx`
- Modify: `packages/web/src/components/LayersPanel.tsx`
- Modify: `packages/web/src/components/FireMarker.tsx`
- Modify: `packages/web/src/components/IncidentMarker.tsx`
- Modify: `packages/web/src/components/IncidentEditControls.tsx`
- Modify: `packages/web/src/components/LoginForm.tsx`
- Modify: `packages/web/src/components/FireMap.tsx`

**Interfaces:**
- Consumes: `trackEvent(name, params?)` from `lib/analytics.ts` (Task 5).

- [ ] **Step 1: `MapApp.tsx`**

Add the import: `import { trackEvent } from './lib/analytics.js';`

Add calls at the start of each relevant handler's body (keep all existing logic unchanged, just
add one `trackEvent(...)` line):

```ts
  async function handleRescan(hours: 6 | 12 | 24): Promise<void> {
    trackEvent('rescan_trigger', { hours });
    setRescanning(true);
    ...
```

```ts
  async function togglePush(): Promise<void> {
    trackEvent('push_notifications_toggle', { to: pushEnabled ? 'disabled' : 'enabled' });
    if (pushEnabled) {
    ...
```

```ts
  function toggleTheme(): void {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    trackEvent('theme_toggle', { to: next });
    setTheme(next);
    ...
```

```ts
  function toggleViewMode(): void {
    const next: ViewMode = viewMode === 'points' ? 'areas' : 'points';
    trackEvent('view_mode_toggle', { to: next });
    setViewMode(next);
    ...
```

```ts
  function changeLayerPrefs(next: LayerPrefs): void {
    const clamped = { ...next, clusterKm: clampClusterKm(next.clusterKm) };
    for (const key of ['effisHotspots', 'effisBurntAreas', 'wind', 'showUnconfirmed', 'reportedIncidents'] as const) {
      if (layerPrefs[key] !== clamped[key]) trackEvent('layer_toggle', { layer: key, enabled: clamped[key] });
    }
    setLayerPrefs(clamped);
    storeLayerPrefs(clamped);
  }
```

For the Edit-pins toggle and Refresh/hours-change, change the inline handlers passed to
`<StatusBar>`:

```tsx
        onHoursChange={(next) => {
          trackEvent('time_window_change', { hours: next });
          setHours(next);
          storeHours(next);
        }}
        lastSuccessAt={lastSuccessAt}
        loading={loading}
        error={error}
        onRefresh={() => {
          trackEvent('refresh_click');
          refresh();
        }}
```

```tsx
        onToggleEditMode={() => {
          setEditMode((prev) => {
            trackEvent('edit_mode_toggle', { to: prev ? 'off' : 'on' });
            return !prev;
          });
        }}
```

- [ ] **Step 2: `StatusBar.tsx`**

No further tracking needed here — Refresh/theme/view-mode/edit-mode/push/hours are all tracked at
their source in `MapApp.tsx` (Step 1) since that's where the actual state change happens; adding a
second `trackEvent` in `StatusBar` for the same click would double-count. Login/logout tracking:
add `import { trackEvent } from '../lib/analytics.js';` and wrap the two existing button
`onClick`s:

```tsx
      {onLogout && (
        <button
          type="button"
          className="logout-button"
          onClick={() => {
            trackEvent('logout_click');
            onLogout();
          }}
        >
          Log out
        </button>
      )}
      {onRequestLogin && (
        <button
          type="button"
          className="logout-button"
          onClick={() => {
            trackEvent('login_prompt_opened');
            onRequestLogin();
          }}
        >
          Log in
        </button>
      )}
```

- [ ] **Step 3: `LayersPanel.tsx`**

Add the import and track the panel's own collapse/expand toggle:

```ts
import { trackEvent } from '../lib/analytics.js';
```

```tsx
        onClick={() => {
          setCollapsed((c) => {
            const next = !c;
            storePanelCollapsed('layers', next);
            trackEvent('layers_panel_toggle', { collapsed: next });
            return next;
          });
        }}
```

Per-source checkboxes already flow through `MapApp`'s `onChange={changeLayerPrefs}` (which only
diffs the boolean fields tracked in Step 1) — add per-source tracking directly in `toggleSource`
here instead, since `hiddenSources` is an array `MapApp`'s diff doesn't cover:

```ts
  function toggleSource(sourceId: string): void {
    const hidden = prefs.hiddenSources.includes(sourceId)
      ? prefs.hiddenSources.filter((s) => s !== sourceId)
      : [...prefs.hiddenSources, sourceId];
    trackEvent('layer_toggle', { layer: sourceId, enabled: !prefs.hiddenSources.includes(sourceId) });
    onChange({ ...prefs, hiddenSources: hidden });
  }
```

- [ ] **Step 4: `FireMarker.tsx`**

Add the import and a click handler to both `PolarMarker` and `GeoMarker`'s `CircleMarker`
components — e.g. for `PolarMarker`:

```ts
import { trackEvent } from '../lib/analytics.js';
```

```tsx
    <CircleMarker
      center={[detection.latitude, detection.longitude]}
      radius={8}
      pathOptions={{ color, weight: 1, fillColor: color, fillOpacity: 0.9 }}
      eventHandlers={{ click: () => trackEvent('marker_click', { tier: 'polar' }) }}
    >
```

Apply the same `eventHandlers={{ click: () => trackEvent('marker_click', { tier: 'geo' }) }}` to
each `CircleMarker` returned by `GeoMarker` (there are multiple return branches for
confirmed/unconfirmed — add it to each one).

- [ ] **Step 5: `IncidentMarker.tsx`**

Add the import, and merge a `click` handler into the existing `eventHandlers` object (which today
only sets `dragend` when `editMode` is true) so `click` fires regardless of edit mode:

```ts
import { trackEvent } from '../lib/analytics.js';
```

```tsx
      eventHandlers={{
        click: () => trackEvent('marker_click', { tier: 'incident' }),
        ...(editMode
          ? {
              dragend: (event: { target: LeafletMarkerInstance }) => {
                const marker = event.target;
                const { lat, lng } = marker.getLatLng();
                updateIncidentLocation(incident.id, lat, lng).catch(() => {
                  setDragError('Move failed — try again.');
                  marker.setLatLng([incident.latitude, incident.longitude]);
                });
              },
            }
          : {}),
      }}
```

Track the "View original post" link and the drag itself. Change:

```tsx
          <div>
            <a href={incident.url} target="_blank" rel="noreferrer">
              View original post ↗
            </a>
          </div>
```

to:

```tsx
          <div>
            <a
              href={incident.url}
              target="_blank"
              rel="noreferrer"
              onClick={() => trackEvent('incident_original_post_click')}
            >
              View original post ↗
            </a>
          </div>
```

And add `trackEvent('incident_pin_dragged')` as the first line inside the `dragend` handler shown
above (right after `const marker = event.target;`).

- [ ] **Step 6: `IncidentEditControls.tsx`**

Add the import and one `trackEvent` call in each handler (after successful action, inside the
`run(...)` callback where relevant, or right before calling `run` for the ones with no useful
result payload):

```ts
import { trackEvent } from '../lib/analytics.js';
```

```ts
  function handleSaveCoordinates(): void {
    const parsedLat = Number(lat);
    const parsedLon = Number(lon);
    if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLon)) {
      setError('Latitude/longitude must be numbers.');
      return;
    }
    trackEvent('incident_pin_manual_save');
    void run(() => updateIncidentLocation(incident.id, parsedLat, parsedLon).then(() => undefined));
  }

  function handleSearch(): void {
    if (!query.trim()) return;
    void run(() =>
      searchLocations(query).then((found) => {
        trackEvent('incident_location_search', { resultCount: found.length });
        setResults(found);
      }),
    );
  }

  function handlePickResult(result: LocationSearchResult): void {
    trackEvent('incident_pin_search_pick');
    void run(() => updateIncidentLocation(incident.id, result.latitude, result.longitude).then(() => undefined));
  }

  function handleHide(): void {
    if (!confirm('Hide this pin? It will be hidden forever, even if the same post is scanned again — this cannot be undone.')) return;
    trackEvent('incident_pin_hidden');
    void run(() => hideIncident(incident.id));
  }

  function handleDelete(): void {
    if (!confirm('Delete this pin forever? Unlike Hide, a future re-scan may re-add it if it fetches this same post again.')) return;
    trackEvent('incident_pin_deleted');
    void run(() => deleteIncident(incident.id));
  }
```

- [ ] **Step 7: `LoginForm.tsx`**

Add the import and track the attempt's outcome:

```ts
import { trackEvent } from '../lib/analytics.js';
```

```ts
  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(false);
    const ok = await login(username, password);
    trackEvent('login_attempt', { success: ok });
    setSubmitting(false);
    if (ok) {
      onSuccess();
    } else {
      setError(true);
    }
  }
```

- [ ] **Step 8: `FireMap.tsx`**

Add the import and track a push-notification deep-link arrival inside `FocusHandler`:

```ts
import { trackEvent } from '../lib/analytics.js';
```

```tsx
function FocusHandler({ target }: { target: FocusTarget | null }): null {
  const map = useMap();
  useEffect(() => {
    if (target) {
      map.setView([target.lat, target.lon], 13);
      trackEvent('focus_target_opened', { tier: target.tier });
    }
  }, [target, map]);
  return null;
}
```

(Check `FocusTarget`'s actual shape in `lib/focusTarget.ts` first — if it doesn't have a `tier`
field, drop that param and just call `trackEvent('focus_target_opened')` with no params instead of
inventing a field that doesn't exist.)

- [ ] **Step 9: Build and test**

Run: `pnpm --filter @pyrmap/web build && pnpm --filter @pyrmap/web test`
Expected: both succeed.

- [ ] **Step 10: Commit**

```bash
git add packages/web/src/MapApp.tsx packages/web/src/components/StatusBar.tsx packages/web/src/components/LayersPanel.tsx packages/web/src/components/FireMarker.tsx packages/web/src/components/IncidentMarker.tsx packages/web/src/components/IncidentEditControls.tsx packages/web/src/components/LoginForm.tsx packages/web/src/components/FireMap.tsx
git commit -m "feat(web): add GA4 event tracking across every existing interaction handler"
```

---

## Task 8: Verification, decisions log, final checks

**Files:**
- Modify: `docs/DECISIONS.md`

**Interfaces:** None (verification only).

- [ ] **Step 1: `pnpm audit`**

Run: `pnpm audit`
Expected: review output; fix only what's actually exploitable/relevant to this app (e.g. a
transitive dev-only dependency with a low-severity advisory is not worth chasing) — note anything
real found and fixed, or explicitly note "nothing actionable found" if that's the case.

- [ ] **Step 2: Full monorepo build and test**

Run: `pnpm -r build && pnpm test`
Expected: succeeds with zero failures across every package.

- [ ] **Step 3: Manual browser verification**

Using the same technique as the incident-pin-correction work (a scratch script calling `buildApp`
directly with a real `AuthConfig`, served via headless Chromium with the `libasound.so.2` workaround
if the sandbox still lacks it), confirm in a real browser:
1. With no session: the map loads and shows data; Re-scan, Edit-pins, and the push button are all
   absent from the status bar; a "Log in" button is present instead.
2. Logging in via the modal reveals Re-scan/Edit-pins/push controls without a page reload; the
   modal's cancel (✕) button dismisses it without logging in.
3. Both light and dark map tiles load with zero CSP violations in the console; the EFFIS overlay
   and Open-Meteo wind layer (toggle both on) also load cleanly under the new CSP.
4. The consent banner appears on first load; clicking Accept fires a real request to
   `googletagmanager.com` (visible in the network tab); reloading no longer shows the banner
   (replaced by the small "Cookie settings" link); clicking that reopens the Editing view with the
   toggle reflecting the stored choice; unchecking + Save stops further `google-analytics.com`
   requests from firing on subsequent interactions.
5. In a second, separate unauthenticated browser context, confirm that a pin correction made while
   logged in in the first context appears live via the SSE refresh (this must be unaffected by any
   of this plan's changes — a regression here would mean `/api/events` was accidentally gated).

If the sandbox still can't render a real browser at all, state that explicitly and report exactly
what was verified by code/tests alone vs. what needs the user's own visual confirmation.

- [ ] **Step 4: Log the decisions**

Append to `docs/DECISIONS.md`:

```
2026-07-23 | server,web | app split into a public viewing tier (fires/status/SSE, always open) and an admin tier (rescan/incident-edit/push-subscribe, behind the existing single-user login) | explicit user request ahead of presenting the app publicly at pyrmap.alexcoll.in
2026-07-23 | web | GA4 added via direct gtag.js (not GTM), gated behind a 3-state consent banner (Accept / Edit-with-toggle-defaulted-on / Save), nothing loads pre-consent | explicit user request; GTM would add an extra script load and its own separate consent-mode setup for no benefit here since all tracking is custom developer-authored events either way
2026-07-23 | repo | VITE_GA_MEASUREMENT_ID is wired as a Docker build-arg (Dockerfile ARG + compose build.args), not a runtime environment var like every other config value | Vite bakes VITE_* vars into the static bundle at build time, not read at container runtime — flagged explicitly so it isn't missed the way AUTH_* was before (see 2026-07-20 entry)
```

- [ ] **Step 5: Commit**

```bash
git add docs/DECISIONS.md
git commit -m "docs(repo): log public-mode, GA4, and build-arg decisions"
```

## Self-Review Notes (for whoever executes this plan)

- Do not push to `main` after finishing — pushing triggers a real production deploy. Stop after
  Task 8 and report status; the user pushes explicitly when ready.
- The user still needs to: (1) add `VITE_GA_MEASUREMENT_ID=G-RTCRTG3P2F` to Portainer's stack
  "Environment variables" config (same place as their other vars) so it flows into the Docker
  build-arg — flag this clearly in the final report, it's the single easiest thing to forget.
- If any existing test asserted `/api/fires`/`/api/status`/`/api/events` required a session
  (pre-dating this change), update it to expect success instead — that's an intentional behavior
  change, not a regression to work around.
