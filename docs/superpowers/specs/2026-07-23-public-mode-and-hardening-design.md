# Public mode, security hardening, and tile-provider fix — design

## Motivation

The app is moving from "only I use it" to "presented to the public" at `pyrmap.alexcoll.in`. Today
auth is all-or-nothing: with `AUTH_*` configured, the *entire* app (including just viewing the
map) requires a login. That's wrong for a public map. This spec makes viewing public while keeping
the actions that cost money (X/Twitter re-scan) or can alter data (incident pin editing) behind the
existing single-user login, and hardens the now-public surface against abuse.

## Access split

**Public** (no session required, even when auth is configured):
- `GET /api/fires`, `GET /api/status`, `GET /api/events` (SSE) — confirmed explicitly: SSE stays
  public so that when the admin corrects a pin, every connected visitor sees the live update
  exactly as today (the mutation routes already call `updateBus.publish()` unconditionally).
- `GET /api/health`, `POST /api/login`, `POST /api/logout`, `GET /api/me` — already public today.
- `GET /api/push/vapid-public-key` — already public today (a public key isn't sensitive).
- The static frontend itself.

**Gated** (requires the admin session when auth is configured):
- `POST /api/rescan` — the only thing that costs real X API quota on demand; already gated,
  unchanged.
- Everything under `incidentEditRoutes`: `PATCH .../location`, `POST .../hide`, `DELETE`, and
  `GET /api/geocode/search` — lets someone alter or erase map data.
- `POST /api/push/subscribe` / `POST /api/push/unsubscribe` — defaulting to admin-only. This
  wasn't designed as a multi-user feature (every subscriber gets every alert with no per-user
  filtering), so opening it to the public would be a separate feature, not just an access-control
  change. Revisit if a public "subscribe to alerts" feature is ever wanted.

When auth isn't configured at all (`AUTH_USERNAME`/`AUTH_PASSWORD`/`SESSION_SECRET` unset — the
local-dev default), behavior is unchanged: everything stays open, exactly as today.

### Server: `app.ts`

Currently one `protectedApp` group wraps every non-public route behind a single `requireAuth`
hook. This splits into two groups:

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

`buildApp`'s signature and every other parameter stays the same — this only changes which group
each route lands in.

### Frontend: from "block the whole app" to "hide admin controls"

`App.tsx` currently returns `<LoginForm />` in place of `<MapApp />` when auth is enabled and not
authenticated. That changes to: always render `<MapApp />`; compute
`isAdmin = !status.enabled || status.authenticated` (open-access dev mode = admin, matching
today's convention); pass `isAdmin` down; render `<LoginForm>` as a dismissable overlay on top of
the map (not a replacement), triggered by a "Log in" affordance instead of blocking everything.

`LoginForm` gains an `onCancel` prop (a close button / Escape key) since it's now optional to
dismiss rather than the only thing on screen. Its `.login-container` CSS gets `position: fixed;
inset: 0; z-index: <above the map's panels>;` so it overlays instead of participating in normal
document flow.

`StatusBar` gains an `isAdmin: boolean` prop. Re-scan select, the Edit-pins toggle, and the push
notification button/hint only render when `isAdmin` is true. When auth is enabled and the visitor
isn't the admin, a small "Log in" button appears in their place; when they are the admin, "Log
out" appears as today. `MapApp`/`FireMap`'s existing `editMode` state and prop threading is
untouched — `isAdmin` just also gates whether the toggle button that flips it is rendered at all
(so a logged-out visitor can never enter edit mode regardless).

## Security hardening

- **`@fastify/helmet`** (new dependency — officially maintained by the Fastify team, MIT, same
  ecosystem as `@fastify/static` already in use): registered globally in `app.ts` with a
  Content-Security-Policy allowlisting exactly the external hosts this app actually calls from the
  browser:
  - `script-src`: `'self'`, `https://www.googletagmanager.com` (GA4, see the companion GA4 spec)
  - `connect-src`: `'self'`, `https://www.google-analytics.com`, `https://*.google-analytics.com`,
    `https://*.analytics.google.com`, `https://api.open-meteo.com` (WindLayer's direct fetch)
  - `img-src`: `'self'`, `data:`, `https://basemaps.cartocdn.com` (both themes, see tile-provider
    fix below), `https://maps.effis.emergency.copernicus.eu` (EFFIS WMS tiles)
  - `style-src`: `'self'`, `'unsafe-inline'` (Leaflet sets inline `style` attributes directly via
    JS for marker positioning — this is a well-known, unavoidable requirement for any
    Leaflet+CSP setup)
  - `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'self'`
  - Other helmet defaults (`X-Content-Type-Options`, `Referrer-Policy`, etc.) stay at their
    secure defaults.
- **`@fastify/rate-limit`** (new dependency, same team/ecosystem, MIT): a strict limit
  (`max: 5, timeWindow: '1 minute'`) on `POST /api/login` specifically (brute-force protection for
  the single credential pair), and a looser global default (`max: 100, timeWindow: '1 minute'`)
  applied app-wide for general abuse resistance. Both keyed by IP.
- **`trustProxy: true`** on the `Fastify(...)` constructor in `app.ts`. The app runs behind a
  Cloudflare Tunnel; without this, every request looks like it comes from the tunnel's own address,
  which would make IP-based rate limiting either a no-op (one shared bucket for all visitors) or
  wrongly block everyone at once the moment any one visitor is throttled. Cloudflare Tunnel
  forwards the real client IP via standard proxy headers, which Fastify's `trustProxy` reads.
- Both new dependencies get a one-line justification comment at their import site and a
  `docs/DECISIONS.md` entry, per this repo's closed-dependency-whitelist rule — explicit user
  request, same pattern as `web-push`/`NominatimClient` before them.
- `pnpm audit` run once as part of verification (report findings, fix only what's actually
  exploitable/relevant — not a general dependency-bump sweep, which would be out of scope).

## Tile-provider fix

Light mode currently loads tiles directly from `tile.openstreetmap.org`, whose usage policy
explicitly says that server is not for production/heavy-traffic apps ("no SLA... may block access
without notice... commercial or high-traffic use should self-host or use a paid provider"). Now
that the site is public, this is a real (if currently low-probability) risk. Fix: switch light
mode's tile URL to CARTO's `light_all` basemap (`https://{s}.basemaps.cartocdn.com/light_all/...`),
the same provider dark mode already uses without issue, with the same attribution already in
place. This isn't a lawyer-certified guarantee CARTO's free tier covers any traffic level, but it
is a substantially lower-risk choice than a server whose policy explicitly disclaims exactly this
use case.

`packages/web/src/components/FireMap.tsx`'s `TILE_LAYERS.light` entry changes its `url` (and,
since it's now a subdomain-templated CARTO URL, needs the `{s}`/`{r}` pattern the `dark` entry
already uses); its `attribution` switches from `OSM_ATTRIBUTION` to `CARTO_ATTRIBUTION` (already
defined and used by dark mode).

## Testing

- Route tests (extending `packages/server/test/incidents.test.ts`'s sibling files, or a new
  `test/publicAccess.test.ts`): with auth configured, `/api/fires`, `/api/status`, and a
  `/api/events` connection succeed *without* a session; `/api/rescan`, the incident-edit routes,
  and `/api/push/subscribe` all still 401 without one (already covered for incidents/rescan by
  existing tests — this adds the "now succeeds without a session" side, which is the actual
  behavior change).
- A rate-limit test: hammering `/api/login` past the configured max returns 429.
- Helmet: a route test asserting the CSP header is present with the expected directives (a
  string-contains check, not a full parse).
- Frontend: no automated test for the login-modal/isAdmin gating (this codebase has no
  component-test setup, per the existing convention) — verified manually in a real browser
  (headless Chromium, same technique as the incident-pin-correction work): confirm the map loads
  with no session, confirm Re-scan/Edit-pins/push controls are absent, confirm logging in reveals
  them, confirm logging out hides them again without a full page reload breaking anything, confirm
  a pin edit while logged in is visible in a second, unauthenticated browser context via the SSE
  refresh.
- Build: after the CSP lands, a real browser check that the map tiles (light *and* dark), EFFIS
  WMS overlay, and Open-Meteo wind layer all still load with zero CSP violations in the console —
  a misconfigured CSP silently breaking the map in production would be worse than not having one.

## Out of scope

- Public push-notification subscriptions (noted above as a separate potential feature).
- CORS configuration (not needed — no cross-origin API consumer exists today; browsers already
  block cross-origin reads without an explicit `Access-Control-Allow-Origin`, which this app has
  never sent).
- A general dependency version-bump sweep beyond what `pnpm audit` flags as actually relevant.
