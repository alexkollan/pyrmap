# PWA + Push Notifications — Design

Date: 2026-07-22
Status: Approved

## Context

`docs/pyrmap-dev-plan.md` §1 lists push notifications as out of scope for v1. This is an
explicit post-v1 feature request, following the same pattern as prior deviations (auth, SSE
live updates, extra data sources) — implemented and logged as a deviation in
`docs/DECISIONS.md`, not blocked.

Goal: make PyrMap installable as a PWA (manifest + service worker, reusing the existing flame
favicon as the app icon), and push a browser/OS notification for every new fire detection —
from both FIRMS satellites (either tier) and X/incident reports — to every subscribed device,
including after the installed app has been fully closed.

## Decisions made during brainstorming

- **Granularity**: one notification per individual new row (not batched, not clustered).
- **Which tier notifies**: both FIRMS tiers (unconfirmed geo + confirmed polar), always, plus
  every incident report. A geo detection's later upgrade to "confirmed" via `confirmationPass`
  does NOT re-notify — it already fired at insert time.
- **Auth gating**: `/api/push/subscribe` and `/api/push/unsubscribe` require a session when
  AUTH_USERNAME/PASSWORD/SESSION_SECRET are configured, matching `/api/fires`.
  `/api/push/vapid-public-key` stays open, same tier as `/api/health`.
- **Message content**: specific, not generic. Incident reports use their own post text
  (already human-readable Greek). Satellite detections get new reverse-geocoding (nearest
  settlement, else nearest regional unit) to produce a "near X" location string.
- **Click behavior**: opens/focuses the app and pans the map to the detection's coordinates.
- **UI placement**: a bell-icon toggle near the existing map controls (dark mode, layers).

## Architecture

### 1. New dependency & secrets

- `web-push` (npm, server-side only) — VAPID signing + sending push messages. Outside the
  closed dependency whitelist (plan §15) — added with a justification comment at the import
  site and a `docs/DECISIONS.md` entry, same pattern as `h5wasm`.
- New env vars: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (a `mailto:` contact
  required by the Web Push protocol). Added to `config.ts`, `.env`, `.env.example`, and
  `docker-compose.yml`'s `environment:` block — all four, per the standing env-var rule.
- Frontend gets the public key via `GET /api/push/vapid-public-key` (open route) rather than a
  build-time Vite env var, so key rotation doesn't need a rebuild.

### 2. Data model

New migration (append-only, per §6):

```sql
CREATE TABLE push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

Mirrors the standard browser `PushSubscription` JSON shape.

### 3. Backend (hexagonal)

- `ports/PushSubscriptionRepository.ts` + `adapters/sqlite/SqlitePushSubscriptionRepository.ts`
  — save / list / delete by endpoint. SQL confined to the adapter, per §3.
- `domain/reverseGeocoding.ts` (new file) — `nearestPlace(lat, lon): { name: string; precision:
  'settlement' | 'regional_unit' } | null`. Reuses the same gazetteer JSON
  `incidentGeocoding.ts` already loads (nearest populated settlement within a plausible radius,
  else nearest regional unit — Greece is fully covered by regional units, so this should
  essentially always resolve).
- `domain/notificationPayload.ts` (new file) — pure functions building `{ title, body, url }`
  for a `Detection` (via `nearestPlace`) or an `IncidentReport` (using its own `text`).
- `services/pushNotificationService.ts` — given new rows and the subscription list, calls
  `web-push.sendNotification(...)` per subscription; deletes the subscription row on a
  404/410 response (expired). Never throws — logs and continues, same convention as the other
  ingest services.
- **Hook points**: called at the end of `alertIngestService` (each newly inserted geo/polar
  row) and `incidentIngestService` (each newly inserted incident row). NOT called from
  `confirmationPass`.
- **New routes**: `POST /api/push/subscribe`, `POST /api/push/unsubscribe` (session-gated when
  auth is configured), `GET /api/push/vapid-public-key` (open).

### 4. PWA installability

- Rasterize the existing `packages/web/public/favicon.svg` into PNG icons (192×192, 512×512,
  180×180 apple-touch-icon) as a one-time asset-generation step — no new ongoing dependency.
- New `packages/web/public/manifest.webmanifest`: name/short_name "PyrMap", the icons above,
  `start_url: "/"`, `display: "standalone"`, theme/background colors matching the app's
  existing dark red/orange palette.
- `index.html` gets `<link rel="manifest">`, `<link rel="apple-touch-icon">`,
  `<meta name="theme-color">`.

### 5. Service worker & subscribe flow

- Hand-rolled `packages/web/public/sw.js` — no `vite-plugin-pwa` (this app is inherently
  live-data-dependent, not offline-first; hand-rolling keeps the frontend dependency count at
  zero). Handles: minimal install/activate, a `push` event that shows the notification via
  `self.registration.showNotification`, and `notificationclick` that focuses/opens the app with
  the detection's coordinates in the URL (`/?focus=lat,lon`) so the map pans there whether or
  not a tab was already open.
- `src/lib/pushNotifications.ts` — feature-detects `Notification`/`PushManager`, requests
  permission, subscribes via `registration.pushManager.subscribe`, POSTs to
  `/api/push/subscribe`.
- A bell-icon toggle near the existing map controls. On iOS Safari specifically (Web Push
  there requires home-screen install), shows a short "add to home screen first" hint instead
  of silently failing when not installed.

## Error handling

- Push send failures (expired subscription, network) never crash ingestion — logged; expired
  subscriptions (410/404) are pruned from the DB.
- Permission denied / unsupported browser: the UI simply doesn't activate the toggle, no crash.
- iOS: contextual hint when push is unavailable because the site isn't installed yet.

## Testing

- `reverseGeocoding.test.ts`, `notificationPayload.test.ts` — same style as the existing
  geocoding tests (known coordinates/rows → expected output).
- `pushNotificationService.test.ts` — fake injected send function; verifies per-subscription
  calls and 410-pruning, no real network.
- Route tests for subscribe/unsubscribe mirroring the existing `auth.test.ts` gating style.
- `sw.js` stays deliberately low-logic so it doesn't need heavy testing; real push delivery
  gets a manual end-to-end check on an actual device — can't be verified from this sandboxed
  environment.

## Explicitly out of scope for this round

- Per-user notification preferences (radius filters, quiet hours, tier opt-out) — single user,
  "any detection" was the explicit ask.
- Offline caching / full workbox precaching — not an offline-first app.
- Notification grouping/clustering by fire event — deferred; noted as a possible future
  refinement if per-row volume turns out to be too noisy in practice.
