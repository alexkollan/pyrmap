# PWA + Push Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PyrMap installable as a PWA (manifest + service worker, reusing the existing flame favicon as the app icon) and push an OS-level notification for every newly inserted fire detection or incident report to every subscribed device — including after the installed app has been fully closed.

**Architecture:** Backend gains a `push_subscriptions` table, a hexagonal port/adapter for it, two new pure domain modules (reverse-geocoding a detection's coordinates to a place name; building notification payloads), and a service that sends via the `web-push` library. The three existing ingest paths (FIRMS CSV, fire-alert circles, X incident reports) get an optional `onInserted` callback threaded through, wired in the scheduler to call the push service. Frontend gets a manifest, a hand-rolled service worker (no new build dependency), a small subscribe/unsubscribe module, and a bell-icon toggle in the existing status bar.

**Tech Stack:** Fastify, better-sqlite3, `web-push` (new), React, react-leaflet, Vite, Vitest.

## Global Constraints

- Node 22, pnpm via corepack — never npm/yarn.
- TypeScript strict everywhere. No `any` unless annotated `// any-ok: <reason>`. No `@ts-ignore`.
- SQL lives only in `adapters/sqlite/`. Schema changes only via a new migration appended to `migrations.ts` — never edit an existing one.
- `domain/` stays pure — no I/O, no imports from `adapters/`/`services/`/`routes/`.
- Every new port interface and domain function gets a 1–3 line doc comment stating contract + units.
- `web-push` is outside the closed dependency whitelist (dev-plan §15) — add a justification comment at the import site and a `docs/DECISIONS.md` entry (same pattern as `h5wasm`).
- A new env var is not done until it's in all four places: `config.ts`, `.env`, `.env.example`, `docker-compose.yml`'s `environment:` block.
- Before every commit: `pnpm -r build && pnpm test` must pass, run from the repo root.
- Conventional commit messages: `feat|fix|test|chore|refactor|docs(scope): message`. Scopes: `server`, `web`, `shared`, `repo`.
- Never weaken, delete, or skip an existing test. Never edit `MIGRATIONS` entries already committed — only append.
- Soft limit 300 lines per file.

---

### Task 1: Shared `PushSubscriptionPayload` type

**Files:**
- Modify: `packages/shared/src/types.ts`

**Interfaces:**
- Produces: `PushSubscriptionPayload { endpoint: string; keys: { p256dh: string; auth: string } }`, exported from `@pyrmap/shared`.

- [ ] **Step 1: Add the type**

Append to the end of `packages/shared/src/types.ts`:

```ts
/** The browser's native PushSubscription JSON shape, sent to POST /api/push/subscribe. */
export interface PushSubscriptionPayload {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}
```

- [ ] **Step 2: Build shared and verify it compiles**

Run: `pnpm --filter @pyrmap/shared build`
Expected: exits 0, no output changes needed elsewhere yet (nothing imports it).

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types.ts
git commit -m "feat(shared): add PushSubscriptionPayload type"
```

---

### Task 2: `push_subscriptions` migration, port, and SQLite adapter

**Files:**
- Modify: `packages/server/src/adapters/sqlite/migrations.ts`
- Create: `packages/server/src/ports/PushSubscriptionRepository.ts`
- Create: `packages/server/src/adapters/sqlite/SqlitePushSubscriptionRepository.ts`
- Test: `packages/server/test/SqlitePushSubscriptionRepository.test.ts`

**Interfaces:**
- Produces: `PushSubscriptionRepository` port with `saveSubscription(subscription: NewPushSubscription): void`, `listSubscriptions(): StoredPushSubscription[]`, `deleteSubscription(endpoint: string): void`, `close(): void`. `NewPushSubscription` and `StoredPushSubscription` both `{ endpoint: string; p256dh: string; auth: string }`.
- Consumes: `runMigrations` from `./migrations.js` (existing).

- [ ] **Step 1: Write the failing test**

Create `packages/server/test/SqlitePushSubscriptionRepository.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqlitePushSubscriptionRepository } from '../src/adapters/sqlite/SqlitePushSubscriptionRepository.js';

let tmpDir: string;
let repo: SqlitePushSubscriptionRepository;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'pyrmap-push-test-'));
  repo = new SqlitePushSubscriptionRepository(path.join(tmpDir, 'test.db'));
});

afterEach(() => {
  repo.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('SqlitePushSubscriptionRepository', () => {
  it('saves a subscription and lists it back', () => {
    repo.saveSubscription({ endpoint: 'https://push.example/abc', p256dh: 'p256dh-key', auth: 'auth-key' });
    expect(repo.listSubscriptions()).toEqual([
      { endpoint: 'https://push.example/abc', p256dh: 'p256dh-key', auth: 'auth-key' },
    ]);
  });

  it('re-saving the same endpoint updates its keys instead of duplicating the row', () => {
    repo.saveSubscription({ endpoint: 'https://push.example/abc', p256dh: 'old', auth: 'old' });
    repo.saveSubscription({ endpoint: 'https://push.example/abc', p256dh: 'new', auth: 'new' });
    const all = repo.listSubscriptions();
    expect(all).toHaveLength(1);
    expect(all[0]).toEqual({ endpoint: 'https://push.example/abc', p256dh: 'new', auth: 'new' });
  });

  it('deletes a subscription by endpoint', () => {
    repo.saveSubscription({ endpoint: 'https://push.example/abc', p256dh: 'k', auth: 'a' });
    repo.deleteSubscription('https://push.example/abc');
    expect(repo.listSubscriptions()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pyrmap/server exec vitest run test/SqlitePushSubscriptionRepository.test.ts`
Expected: FAIL — cannot find module `../src/adapters/sqlite/SqlitePushSubscriptionRepository.js`.

- [ ] **Step 3: Append the migration**

In `packages/server/src/adapters/sqlite/migrations.ts`, add a new entry at the end of the `MIGRATIONS` array (immediately before the closing `];`), after the existing `incident_reports` migration string:

```ts
  `
  CREATE TABLE push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  `,
```

- [ ] **Step 4: Write the port**

Create `packages/server/src/ports/PushSubscriptionRepository.ts`:

```ts
export interface NewPushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface StoredPushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Persists browser push subscriptions (one row per device/browser installation). SQL lives only in the sqlite adapter implementing this port. */
export interface PushSubscriptionRepository {
  /** Upserts by endpoint — re-subscribing the same device updates its keys instead of duplicating. */
  saveSubscription(subscription: NewPushSubscription): void;
  /** All stored subscriptions, to broadcast a new-detection notification to every device. */
  listSubscriptions(): StoredPushSubscription[];
  deleteSubscription(endpoint: string): void;
  close(): void;
}
```

- [ ] **Step 5: Write the adapter**

Create `packages/server/src/adapters/sqlite/SqlitePushSubscriptionRepository.ts`:

```ts
import Database, { type Database as DatabaseType } from 'better-sqlite3';
import type {
  NewPushSubscription,
  PushSubscriptionRepository,
  StoredPushSubscription,
} from '../../ports/PushSubscriptionRepository.js';
import { runMigrations } from './migrations.js';

/** Own connection to the same DB file as the other repositories (WAL mode makes that safe). */
export class SqlitePushSubscriptionRepository implements PushSubscriptionRepository {
  private readonly db: DatabaseType;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    runMigrations(this.db);
  }

  saveSubscription(subscription: NewPushSubscription): void {
    this.db
      .prepare(
        `INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at)
         VALUES (@endpoint, @p256dh, @auth, @createdAt)
         ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth`,
      )
      .run({ ...subscription, createdAt: new Date().toISOString() });
  }

  listSubscriptions(): StoredPushSubscription[] {
    return this.db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions').all() as StoredPushSubscription[];
  }

  deleteSubscription(endpoint: string): void {
    this.db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
  }

  close(): void {
    this.db.close();
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @pyrmap/server exec vitest run test/SqlitePushSubscriptionRepository.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/adapters/sqlite/migrations.ts packages/server/src/ports/PushSubscriptionRepository.ts packages/server/src/adapters/sqlite/SqlitePushSubscriptionRepository.ts packages/server/test/SqlitePushSubscriptionRepository.test.ts
git commit -m "feat(server): add push_subscriptions table, port, and sqlite adapter"
```

---

### Task 3: `reverseGeocoding` domain function

**Files:**
- Create: `packages/server/src/domain/reverseGeocoding.ts`
- Test: `packages/server/test/reverseGeocoding.test.ts`

**Interfaces:**
- Consumes: `haversineDistanceKm` from `@pyrmap/shared` (existing); the same `greeceSettlements.json`/`greeceRegionalUnits.json` gazetteer files `incidentGeocoding.ts` already loads.
- Produces: `nearestPlace(latitude: number, longitude: number): { name: string; precision: 'settlement' | 'regional_unit' }`.

- [ ] **Step 1: Write the failing test**

Create `packages/server/test/reverseGeocoding.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { nearestPlace } from '../src/domain/reverseGeocoding.js';

describe('nearestPlace', () => {
  it('resolves settlement precision when a detection is close to a real place', () => {
    // Exact coordinates of Λαύριο in the gazetteer (pop. 7078) — distance 0, unambiguous.
    expect(nearestPlace(37.7144, 24.0565)).toEqual({ name: 'Λαύριο', precision: 'settlement' });
  });

  it('falls back to regional-unit precision when nothing is nearby (open sea)', () => {
    // South Aegean, ~51km from the nearest settlement (Κλησίδι) — too far to call "near" it.
    // Nearest regional unit is Λασίθι at these coordinates (verified against the gazetteer).
    expect(nearestPlace(35.9, 25.9)).toEqual({ name: 'Λασίθι', precision: 'regional_unit' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pyrmap/server exec vitest run test/reverseGeocoding.test.ts`
Expected: FAIL — cannot find module `../src/domain/reverseGeocoding.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/server/src/domain/reverseGeocoding.ts`:

```ts
import { haversineDistanceKm } from '@pyrmap/shared';
import regionalUnitsData from './data/greeceRegionalUnits.json' with { type: 'json' };
import settlementsData from './data/greeceSettlements.json' with { type: 'json' };

interface RegionalUnit {
  nominative: string | null;
  genitives: string[];
  lat: number;
  lon: number;
}

interface Settlement {
  names: string[];
  lat: number;
  lon: number;
  population: number;
}

const regionalUnits = regionalUnitsData as RegionalUnit[];
const settlements = settlementsData as Settlement[];

export interface NearestPlace {
  name: string;
  precision: 'settlement' | 'regional_unit';
}

// A satellite pixel this far or closer from a named settlement is reasonably described as "near"
// it; geo-tier pixels are ~3-4km, polar ~375m-1km, so 15km is generous without being meaningless.
const NEARBY_SETTLEMENT_KM = 15;

/**
 * Reverse-geocodes a detection's raw coordinates to a human-readable place name, for
 * notification text — Detection rows carry no place name of their own. Nearest settlement
 * within NEARBY_SETTLEMENT_KM, else nearest regional unit (Greece's 54 regional units fully
 * cover the country, so this always resolves to something in practice).
 */
export function nearestPlace(latitude: number, longitude: number): NearestPlace {
  let bestSettlement: Settlement | null = null;
  let bestSettlementKm = Infinity;
  for (const settlement of settlements) {
    const distance = haversineDistanceKm(latitude, longitude, settlement.lat, settlement.lon);
    if (distance < bestSettlementKm) {
      bestSettlementKm = distance;
      bestSettlement = settlement;
    }
  }
  if (bestSettlement && bestSettlementKm <= NEARBY_SETTLEMENT_KM) {
    return { name: bestSettlement.names[0]!, precision: 'settlement' };
  }

  let bestRegion: RegionalUnit | null = null;
  let bestRegionKm = Infinity;
  for (const region of regionalUnits) {
    const distance = haversineDistanceKm(latitude, longitude, region.lat, region.lon);
    if (distance < bestRegionKm) {
      bestRegionKm = distance;
      bestRegion = region;
    }
  }
  return { name: bestRegion?.nominative ?? bestRegion?.genitives[0] ?? 'Ελλάδα', precision: 'regional_unit' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pyrmap/server exec vitest run test/reverseGeocoding.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/domain/reverseGeocoding.ts packages/server/test/reverseGeocoding.test.ts
git commit -m "feat(server): add reverse-geocoding for satellite detection coordinates"
```

---

### Task 4: `notificationPayload` domain functions

**Files:**
- Create: `packages/server/src/domain/notificationPayload.ts`
- Test: `packages/server/test/notificationPayload.test.ts`

**Interfaces:**
- Consumes: `nearestPlace` from `./reverseGeocoding.js` (Task 3); `NewDetectionRow` from `../ports/FireRepository.js` (existing); `NewIncidentReportRow` from `../ports/IncidentReportRepository.js` (existing).
- Produces: `NotificationPayload { title: string; body: string; url: string }`, `buildDetectionPayload(detection: Pick<NewDetectionRow, 'tier' | 'latitude' | 'longitude'>): NotificationPayload`, `buildIncidentPayload(report: Pick<NewIncidentReportRow, 'text' | 'latitude' | 'longitude'>): NotificationPayload`.

- [ ] **Step 1: Write the failing test**

Create `packages/server/test/notificationPayload.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildDetectionPayload, buildIncidentPayload } from '../src/domain/notificationPayload.js';

describe('buildDetectionPayload', () => {
  it('labels a geo-tier detection as unconfirmed and names the nearest place', () => {
    const payload = buildDetectionPayload({ tier: 'geo', latitude: 37.7144, longitude: 24.0565 });
    expect(payload).toEqual({
      title: '🔥 Unconfirmed detection',
      body: 'near Λαύριο — tap to view',
      url: '/?focus=37.7144,24.0565',
    });
  });

  it('labels a polar-tier detection as confirmed', () => {
    const payload = buildDetectionPayload({ tier: 'polar', latitude: 37.7144, longitude: 24.0565 });
    expect(payload.title).toBe('🔥 Confirmed detection');
  });

  it('says "in X" rather than "near X" when only a regional unit resolved', () => {
    const payload = buildDetectionPayload({ tier: 'geo', latitude: 35.9, longitude: 25.9 });
    expect(payload.body).toBe('in Λασίθι — tap to view');
  });
});

describe('buildIncidentPayload', () => {
  it('uses the post text directly as the body, since it already names the place', () => {
    const payload = buildIncidentPayload({
      text: 'Κατεσβέσθη #πυρκαγιά σε οικία στο δήμο Νάουσας. Επιχείρησαν 9 #πυροσβέστες με 3 οχήματα.',
      latitude: 40.6294,
      longitude: 22.0681,
    });
    expect(payload).toEqual({
      title: '📢 Reported fire (X)',
      body: 'Κατεσβέσθη #πυρκαγιά σε οικία στο δήμο Νάουσας. Επιχείρησαν 9 #πυροσβέστες με 3 οχήματα.',
      url: '/?focus=40.6294,22.0681',
    });
  });

  it('truncates a long post to 140 characters', () => {
    const longText = 'Α'.repeat(200);
    const payload = buildIncidentPayload({ text: longText, latitude: 0, longitude: 0 });
    expect(payload.body).toBe(`${'Α'.repeat(140)}…`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pyrmap/server exec vitest run test/notificationPayload.test.ts`
Expected: FAIL — cannot find module `../src/domain/notificationPayload.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/server/src/domain/notificationPayload.ts`:

```ts
import type { NewDetectionRow } from '../ports/FireRepository.js';
import type { NewIncidentReportRow } from '../ports/IncidentReportRepository.js';
import { nearestPlace } from './reverseGeocoding.js';

export interface NotificationPayload {
  title: string;
  body: string;
  url: string;
}

const TIER_LABEL = {
  geo: 'Unconfirmed detection',
  polar: 'Confirmed detection',
} as const;

const MAX_INCIDENT_BODY_CHARS = 140;

/** Builds a push payload for a newly inserted satellite detection. Detection rows carry no
 * place name, so this reverse-geocodes the coordinates first. */
export function buildDetectionPayload(
  detection: Pick<NewDetectionRow, 'tier' | 'latitude' | 'longitude'>,
): NotificationPayload {
  const place = nearestPlace(detection.latitude, detection.longitude);
  const located = place.precision === 'settlement' ? `near ${place.name}` : `in ${place.name}`;
  return {
    title: `🔥 ${TIER_LABEL[detection.tier]}`,
    body: `${located} — tap to view`,
    url: `/?focus=${detection.latitude},${detection.longitude}`,
  };
}

/** Builds a push payload for a newly inserted incident report — its own post text already names
 * the place (Greek Fire Service posts always include one), so no reverse-geocoding needed. */
export function buildIncidentPayload(
  report: Pick<NewIncidentReportRow, 'text' | 'latitude' | 'longitude'>,
): NotificationPayload {
  const collapsed = report.text.replace(/\s+/g, ' ').trim();
  const body =
    collapsed.length > MAX_INCIDENT_BODY_CHARS ? `${collapsed.slice(0, MAX_INCIDENT_BODY_CHARS)}…` : collapsed;
  return {
    title: '📢 Reported fire (X)',
    body,
    url: `/?focus=${report.latitude},${report.longitude}`,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pyrmap/server exec vitest run test/notificationPayload.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/domain/notificationPayload.ts packages/server/test/notificationPayload.test.ts
git commit -m "feat(server): add push-notification payload builders for detections and incidents"
```

---

### Task 5: `web-push` dependency, VAPID config, and `pushNotificationService`

**Files:**
- Modify: `packages/server/package.json`
- Modify: `packages/server/src/config.ts`
- Modify: `packages/server/test/config.test.ts`
- Modify: `.env.example`
- Modify: `docker-compose.yml`
- Modify: `docs/DECISIONS.md`
- Create: `packages/server/src/services/pushNotificationService.ts`
- Test: `packages/server/test/pushNotificationService.test.ts`

**Interfaces:**
- Consumes: `PushSubscriptionRepository` (Task 2), `buildDetectionPayload`/`buildIncidentPayload` (Task 4).
- Produces: `VapidConfig { publicKey: string; privateKey: string; subject: string }`, `initializePushVapid(vapid: VapidConfig): void`, `SendFn` (alias of `webpush.sendNotification`'s type), `notifyNewDetections(repository, detections: NewDetectionRow[], onLog?, send?): Promise<void>`, `notifyNewIncidents(repository, reports: NewIncidentReportRow[], onLog?, send?): Promise<void>`. `Config` gains `vapidPublicKey: string | null`, `vapidPrivateKey: string | null`, `vapidSubject: string | null`.

- [ ] **Step 1: Add the dependency**

```bash
cd packages/server
pnpm add web-push
pnpm add -D @types/web-push
cd ../..
```

- [ ] **Step 2: Log the dependency deviation**

Append to `docs/DECISIONS.md`:

```
2026-07-22 | server | added `web-push` (+ @types/web-push) | explicit user request for push notifications; outside the closed dependency whitelist (plan §15), justified at the import site
```

- [ ] **Step 3: Write the failing config test**

In `packages/server/test/config.test.ts`, update the first test's expected object and add a new test. Replace the `it('parses a valid env', ...)` block's `expect(config).toEqual({...})` object with:

```ts
    expect(config).toEqual({
      firmsMapKey: 'real-key',
      port: 8080,
      dbPath: '/data/pyrmap.db',
      logLevel: 'info',
      eumetsatConsumerKey: null,
      eumetsatConsumerSecret: null,
      lsaSafUsername: null,
      lsaSafPassword: null,
      xBearerToken: null,
      authUsername: null,
      authPassword: null,
      sessionSecret: null,
      vapidPublicKey: null,
      vapidPrivateKey: null,
      vapidSubject: null,
    });
```

Then add a new test after the "passes through auth credentials" test:

```ts
  it('passes through VAPID push credentials when all three are set', () => {
    const config = loadConfig({
      ...validEnv,
      VAPID_PUBLIC_KEY: 'pub',
      VAPID_PRIVATE_KEY: 'priv',
      VAPID_SUBJECT: 'mailto:ops@example.com',
    });
    expect(config.vapidPublicKey).toBe('pub');
    expect(config.vapidPrivateKey).toBe('priv');
    expect(config.vapidSubject).toBe('mailto:ops@example.com');
  });
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @pyrmap/server exec vitest run test/config.test.ts`
Expected: FAIL — the first test's `toEqual` mismatches (missing `vapidPublicKey`/etc. keys), the new test's assertions are `undefined`.

- [ ] **Step 5: Update config.ts**

In `packages/server/src/config.ts`, add to the `Config` interface after `sessionSecret: string | null;`:

```ts
  /** Optional Web Push credentials; when all three are set, new detections/incidents push a
   * notification to every subscribed device. Generate a keypair with `web-push generate-vapid-keys`. */
  vapidPublicKey: string | null;
  vapidPrivateKey: string | null;
  vapidSubject: string | null;
```

And in the returned object of `loadConfig`, after `sessionSecret: env.SESSION_SECRET || null,`:

```ts
    vapidPublicKey: env.VAPID_PUBLIC_KEY || null,
    vapidPrivateKey: env.VAPID_PRIVATE_KEY || null,
    vapidSubject: env.VAPID_SUBJECT || null,
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @pyrmap/server exec vitest run test/config.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 7: Add the env vars to `.env.example` and `docker-compose.yml`**

Append to `.env.example`, after the `SESSION_SECRET=` line:

```
# Optional: Web Push credentials for browser/OS notifications on new detections. Generate with:
# cd packages/server && pnpm exec web-push generate-vapid-keys
# VAPID_SUBJECT must be a mailto: contact (required by the Web Push protocol for abuse contact).
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=
```

In `docker-compose.yml`, add to the `environment:` list, after `- SESSION_SECRET=${SESSION_SECRET:-}`:

```yaml
      - VAPID_PUBLIC_KEY=${VAPID_PUBLIC_KEY:-}
      - VAPID_PRIVATE_KEY=${VAPID_PRIVATE_KEY:-}
      - VAPID_SUBJECT=${VAPID_SUBJECT:-}
```

(Adding to your real local `.env` — the fourth of the four required places — is covered in Task 9's final step, once VAPID keys actually need to exist for manual verification.)

- [ ] **Step 8: Write the failing service test**

Create `packages/server/test/pushNotificationService.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SqlitePushSubscriptionRepository } from '../src/adapters/sqlite/SqlitePushSubscriptionRepository.js';
import { notifyNewDetections, notifyNewIncidents } from '../src/services/pushNotificationService.js';

let tmpDir: string;
let repo: SqlitePushSubscriptionRepository;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'pyrmap-pushsvc-test-'));
  repo = new SqlitePushSubscriptionRepository(path.join(tmpDir, 'test.db'));
});

afterEach(() => {
  repo.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('notifyNewDetections', () => {
  it('sends one payload per subscription per detection', async () => {
    repo.saveSubscription({ endpoint: 'https://push.example/a', p256dh: 'p', auth: 'a' });
    repo.saveSubscription({ endpoint: 'https://push.example/b', p256dh: 'p', auth: 'a' });
    const send = vi.fn().mockResolvedValue(undefined);

    await notifyNewDetections(
      repo,
      [{ tier: 'polar' as const, latitude: 37.7144, longitude: 24.0565 } as never],
      undefined,
      send,
    );

    expect(send).toHaveBeenCalledTimes(2);
    const [subscription, payload] = send.mock.calls[0]!;
    expect(subscription).toEqual({ endpoint: 'https://push.example/a', keys: { p256dh: 'p', auth: 'a' } });
    expect(JSON.parse(payload as string).title).toBe('🔥 Confirmed detection');
  });

  it('prunes a subscription the push service reports as gone (410)', async () => {
    repo.saveSubscription({ endpoint: 'https://push.example/gone', p256dh: 'p', auth: 'a' });
    const send = vi.fn().mockRejectedValue(Object.assign(new Error('gone'), { statusCode: 410 }));

    await notifyNewDetections(repo, [{ tier: 'geo' as const, latitude: 0, longitude: 0 } as never], undefined, send);

    expect(repo.listSubscriptions()).toEqual([]);
  });

  it('keeps a subscription and just logs on a non-gone failure', async () => {
    repo.saveSubscription({ endpoint: 'https://push.example/flaky', p256dh: 'p', auth: 'a' });
    const send = vi.fn().mockRejectedValue(new Error('network error'));
    const onLog = vi.fn();

    await notifyNewDetections(repo, [{ tier: 'geo' as const, latitude: 0, longitude: 0 } as never], onLog, send);

    expect(repo.listSubscriptions()).toHaveLength(1);
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('network error'));
  });
});

describe('notifyNewIncidents', () => {
  it('sends one payload per subscription per incident report', async () => {
    repo.saveSubscription({ endpoint: 'https://push.example/a', p256dh: 'p', auth: 'a' });
    const send = vi.fn().mockResolvedValue(undefined);

    await notifyNewIncidents(
      repo,
      [{ text: 'Κατεσβέσθη πυρκαγιά.', latitude: 0, longitude: 0 } as never],
      undefined,
      send,
    );

    expect(send).toHaveBeenCalledTimes(1);
    const [, payload] = send.mock.calls[0]!;
    expect(JSON.parse(payload as string).title).toBe('📢 Reported fire (X)');
  });
});
```

- [ ] **Step 9: Run test to verify it fails**

Run: `pnpm --filter @pyrmap/server exec vitest run test/pushNotificationService.test.ts`
Expected: FAIL — cannot find module `../src/services/pushNotificationService.js`.

- [ ] **Step 10: Write the implementation**

Create `packages/server/src/services/pushNotificationService.ts`:

```ts
// any-ok not needed: web-push added 2026-07-22 for push notifications (explicit user request),
// outside the closed dependency whitelist — see docs/DECISIONS.md.
import webpush from 'web-push';
import { buildDetectionPayload, buildIncidentPayload, type NotificationPayload } from '../domain/notificationPayload.js';
import type { PushSubscriptionRepository } from '../ports/PushSubscriptionRepository.js';
import type { NewDetectionRow } from '../ports/FireRepository.js';
import type { NewIncidentReportRow } from '../ports/IncidentReportRepository.js';

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/** Configures web-push's VAPID identity once at startup. Must be called before any notify* function runs. */
export function initializePushVapid(vapid: VapidConfig): void {
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
}

export type SendFn = typeof webpush.sendNotification;

/** Sends one payload to every stored subscription; prunes subscriptions the push service reports
 * as gone (404/410 — the browser unsubscribed or the endpoint expired). Never throws — failures
 * are logged and skipped, same convention as the ingest services. `send` is injectable so tests
 * never hit a real push service. */
async function sendToAllSubscriptions(
  repository: PushSubscriptionRepository,
  payload: NotificationPayload,
  onLog: ((message: string) => void) | undefined,
  send: SendFn,
): Promise<void> {
  for (const subscription of repository.listSubscriptions()) {
    try {
      await send(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        JSON.stringify(payload),
      );
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        repository.deleteSubscription(subscription.endpoint);
        onLog?.(`push: pruned expired subscription`);
      } else {
        const message = err instanceof Error ? err.message : String(err);
        onLog?.(`push: send failed: ${message}`);
      }
    }
  }
}

/** Notifies every subscribed device of each newly inserted satellite detection, one push per row. */
export async function notifyNewDetections(
  repository: PushSubscriptionRepository,
  detections: NewDetectionRow[],
  onLog?: (message: string) => void,
  send: SendFn = webpush.sendNotification,
): Promise<void> {
  for (const detection of detections) {
    await sendToAllSubscriptions(repository, buildDetectionPayload(detection), onLog, send);
  }
}

/** Notifies every subscribed device of each newly inserted incident report, one push per row. */
export async function notifyNewIncidents(
  repository: PushSubscriptionRepository,
  reports: NewIncidentReportRow[],
  onLog?: (message: string) => void,
  send: SendFn = webpush.sendNotification,
): Promise<void> {
  for (const report of reports) {
    await sendToAllSubscriptions(repository, buildIncidentPayload(report), onLog, send);
  }
}
```

- [ ] **Step 11: Run test to verify it passes**

Run: `pnpm --filter @pyrmap/server exec vitest run test/pushNotificationService.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 12: Run the full server test suite**

Run: `pnpm --filter @pyrmap/server test`
Expected: all pass, including the updated `config.test.ts`.

- [ ] **Step 13: Commit**

```bash
git add packages/server/package.json pnpm-lock.yaml packages/server/src/config.ts packages/server/test/config.test.ts .env.example docker-compose.yml docs/DECISIONS.md packages/server/src/services/pushNotificationService.ts packages/server/test/pushNotificationService.test.ts
git commit -m "feat(server): add web-push dependency, VAPID config, and pushNotificationService"
```

---

### Task 6: Thread `onInserted` through the three ingest paths

**Files:**
- Modify: `packages/server/src/ports/IncidentReportRepository.ts`
- Modify: `packages/server/src/adapters/sqlite/SqliteIncidentReportRepository.ts`
- Modify: `packages/server/src/services/ingestService.ts`
- Modify: `packages/server/src/services/alertIngestService.ts`
- Modify: `packages/server/src/services/incidentIngestService.ts`
- Test: `packages/server/test/incidentIngestService.test.ts` (add one test)

**Interfaces:**
- Produces: `persistNewDetections(repository, tier, rows, now, onInserted?: (rows: InsertedDetection[]) => void): number` (return type unchanged); `ingestSource`'s `IngestParams` gains `onInserted?: (rows: InsertedDetection[]) => void`; `ingestFireAlerts` gains a 6th param `onInserted?: (rows: InsertedDetection[]) => void`; `ingestIncidentReports` gains a 6th param `onInserted?: (rows: NewIncidentReportRow[]) => void`. `IncidentReportRepository.insertIncidentReports` now returns `NewIncidentReportRow[]` instead of `number`.

- [ ] **Step 1: Write the failing test**

In `packages/server/test/incidentIngestService.test.ts`, add this test inside the `describe('ingestIncidentReports', ...)` block, after the existing "re-ingesting" test:

```ts
  it('calls onInserted with the newly inserted rows, and does not call it when nothing new was inserted', async () => {
    const onInserted = vi.fn();
    await ingestIncidentReports(new FakeIncidentSource(POSTS), repo, SOURCE_ID, NOW, undefined, onInserted);

    expect(onInserted).toHaveBeenCalledTimes(1);
    const [rows] = onInserted.mock.calls[0]!;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ text: 'Υπό μερικό έλεγχο τέθηκε η #πυρκαγιά στο Κορωπί Αττικής.' });

    onInserted.mockClear();
    await ingestIncidentReports(new FakeIncidentSource(POSTS), repo, SOURCE_ID, NOW, undefined, onInserted);
    expect(onInserted).not.toHaveBeenCalled();
  });
```

Add `vi` to the existing `import { afterEach, beforeEach, describe, expect, it } from 'vitest';` line, making it `import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pyrmap/server exec vitest run test/incidentIngestService.test.ts`
Expected: FAIL — `ingestIncidentReports` doesn't accept a 6th argument / `onInserted` is never called (TS will also flag the extra argument once you check types, but at runtime the extra arg is silently ignored and the assertion fails).

- [ ] **Step 3: Change the `IncidentReportRepository` port**

In `packages/server/src/ports/IncidentReportRepository.ts`, change:

```ts
  /** INSERT OR IGNORE on external_id; returns how many rows were newly inserted. */
  insertIncidentReports(rows: NewIncidentReportRow[]): number;
```

to:

```ts
  /** INSERT OR IGNORE on external_id; returns only the rows that were newly inserted. */
  insertIncidentReports(rows: NewIncidentReportRow[]): NewIncidentReportRow[];
```

- [ ] **Step 4: Update the SQLite adapter**

In `packages/server/src/adapters/sqlite/SqliteIncidentReportRepository.ts`, replace the `insertIncidentReports` method body:

```ts
  insertIncidentReports(rows: NewIncidentReportRow[]): NewIncidentReportRow[] {
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO incident_reports
        (external_id, source, text, url, published_at, latitude, longitude, precision)
      VALUES (@externalId, @source, @text, @url, @publishedAt, @latitude, @longitude, @precision)
    `);

    const insertedRows: NewIncidentReportRow[] = [];
    const runAll = this.db.transaction((batch: NewIncidentReportRow[]) => {
      for (const row of batch) {
        if (insert.run(row).changes === 1) insertedRows.push(row);
      }
    });
    runAll(rows);

    return insertedRows;
  }
```

- [ ] **Step 5: Update `incidentIngestService.ts`**

In `packages/server/src/services/incidentIngestService.ts`, change the function signature from:

```ts
export async function ingestIncidentReports(
  source: IncidentSource,
  repository: IncidentReportRepository,
  sourceId: string,
  now: () => Date,
  onLog?: (message: string) => void,
): Promise<IncidentIngestResult> {
```

to:

```ts
export async function ingestIncidentReports(
  source: IncidentSource,
  repository: IncidentReportRepository,
  sourceId: string,
  now: () => Date,
  onLog?: (message: string) => void,
  onInserted?: (rows: NewIncidentReportRow[]) => void,
): Promise<IncidentIngestResult> {
```

Then replace the tail of the function (from `const inserted = repository.insertIncidentReports(rows);` to the end):

```ts
  const insertedRows = repository.insertIncidentReports(rows);
  onLog?.(`source=${sourceId} posts=${posts.length} geocoded=${rows.length} skipped=${skipped} inserted=${insertedRows.length}`);
  if (insertedRows.length > 0) onInserted?.(insertedRows);

  repository.recordFetchLog({
    source: sourceId,
    fetchedAt,
    httpStatus: 200,
    rowsParsed: rows.length,
    rowsInserted: insertedRows.length,
    error: null,
  });

  return { postsFetched: posts.length, rowsInserted: insertedRows.length, error: null };
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @pyrmap/server exec vitest run test/incidentIngestService.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Thread `onInserted` through `ingestService.ts`**

In `packages/server/src/services/ingestService.ts`, change the import line from:

```ts
import type { FireRepository, NewDetectionRow } from '../ports/FireRepository.js';
```

to:

```ts
import type { FireRepository, InsertedDetection, NewDetectionRow } from '../ports/FireRepository.js';
```

Add `onInserted?: (rows: InsertedDetection[]) => void;` to `IngestParams`, right after `onLog?: (message: string) => void;`.

In `ingestSource`, change the destructuring line from:

```ts
  const { dataSource, repository, sourceId, tier, bboxString, dayRange, now, onLog } = params;
```

to:

```ts
  const { dataSource, repository, sourceId, tier, bboxString, dayRange, now, onLog, onInserted } = params;
```

And change the call `const inserted = persistNewDetections(repository, tier, newRows, now);` to:

```ts
  const inserted = persistNewDetections(repository, tier, newRows, now, onInserted);
```

Finally, change `persistNewDetections`'s signature and body:

```ts
export function persistNewDetections(
  repository: FireRepository,
  tier: Tier,
  rows: NewDetectionRow[],
  now: () => Date,
  onInserted?: (rows: InsertedDetection[]) => void,
): number {
  const inserted = repository.insertDetections(rows);
  if (tier === 'geo' && inserted.length > 0) {
    repository.insertUnconfirmedGeoStatus(
      inserted.map((d) => d.id),
      now().toISOString(),
    );
  }
  if (inserted.length > 0) onInserted?.(inserted);
  return inserted.length;
}
```

- [ ] **Step 8: Thread `onInserted` through `alertIngestService.ts`**

In `packages/server/src/services/alertIngestService.ts`, change the import from:

```ts
import type { FireRepository, NewDetectionRow } from '../ports/FireRepository.js';
```

to:

```ts
import type { FireRepository, InsertedDetection, NewDetectionRow } from '../ports/FireRepository.js';
```

Change `ingestFireAlerts`'s signature from:

```ts
export async function ingestFireAlerts(
  alertSource: FireAlertSource,
  sourceConfig: AlertSourceConfig,
  repository: FireRepository,
  now: () => Date,
  onLog?: (message: string) => void,
): Promise<AlertIngestResult> {
```

to:

```ts
export async function ingestFireAlerts(
  alertSource: FireAlertSource,
  sourceConfig: AlertSourceConfig,
  repository: FireRepository,
  now: () => Date,
  onLog?: (message: string) => void,
  onInserted?: (rows: InsertedDetection[]) => void,
): Promise<AlertIngestResult> {
```

And change `const inserted = persistNewDetections(repository, 'geo', rows, now);` to:

```ts
  const inserted = persistNewDetections(repository, 'geo', rows, now, onInserted);
```

- [ ] **Step 9: Run the full server suite**

Run: `pnpm --filter @pyrmap/server test`
Expected: all pass (nothing else calls these functions with a fixed arg count that would break — all new params are optional trailing ones).

- [ ] **Step 10: Commit**

```bash
git add packages/server/src/ports/IncidentReportRepository.ts packages/server/src/adapters/sqlite/SqliteIncidentReportRepository.ts packages/server/src/services/ingestService.ts packages/server/src/services/alertIngestService.ts packages/server/src/services/incidentIngestService.ts packages/server/test/incidentIngestService.test.ts
git commit -m "feat(server): thread an onInserted callback through all three ingest paths"
```

---

### Task 7: Wire push notifications into the scheduler

**Files:**
- Modify: `packages/server/src/jobs/scheduler.ts`
- Test: `packages/server/test/scheduler.test.ts` (add one test)

**Interfaces:**
- Consumes: `InsertedDetection` from `../ports/FireRepository.js`, `NewIncidentReportRow` from `../ports/IncidentReportRepository.js` (both existing).
- Produces: `SchedulerDeps` gains `onNewDetections?: (detections: InsertedDetection[]) => void` and `onNewIncidents?: (reports: NewIncidentReportRow[]) => void`.

- [ ] **Step 1: Write the failing test**

In `packages/server/test/scheduler.test.ts`, add this test inside `describe('startScheduler', ...)`, after the existing `onUpdate` test:

```ts
  it('calls onNewDetections with the newly inserted rows when a poll finds something new', async () => {
    const dataSource = new FakeFireDataSource({ VIIRS_NOAA20_NRT: readFixture('viirs_sample.csv') });
    const onNewDetections = vi.fn();

    const scheduler = startScheduler({
      dataSource,
      repository: repo,
      effectiveSources: { VIIRS_NOAA20_NRT: 'polar' },
      now: () => new Date('2026-07-15T12:00:00Z'),
      onNewDetections,
    });
    scheduler.stop();

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onNewDetections).toHaveBeenCalled();
    const [rows] = onNewDetections.mock.calls[0]!;
    expect(rows.every((r: { source: string }) => r.source === 'VIIRS_NOAA20_NRT')).toBe(true);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pyrmap/server exec vitest run test/scheduler.test.ts`
Expected: FAIL — `onNewDetections` is never called (the option is silently accepted but unused).

- [ ] **Step 3: Update `scheduler.ts`**

Change the import line:

```ts
import type { FireRepository } from '../ports/FireRepository.js';
```

to:

```ts
import type { FireRepository, InsertedDetection } from '../ports/FireRepository.js';
```

Change:

```ts
import type { IncidentReportRepository } from '../ports/IncidentReportRepository.js';
```

to:

```ts
import type { IncidentReportRepository, NewIncidentReportRow } from '../ports/IncidentReportRepository.js';
```

Add to `SchedulerDeps`, right after the `onUpdate` field:

```ts
  /** Called with newly inserted satellite detections (either tier), once per row — drives push notifications. */
  onNewDetections?: (detections: InsertedDetection[]) => void;
  /** Called with newly inserted incident reports, once per row — drives push notifications. */
  onNewIncidents?: (reports: NewIncidentReportRow[]) => void;
```

In the `ingestOne` function, add `onInserted: deps.onNewDetections` to the `ingestSource({...})` call, right after `onLog: deps.onLog,`.

In `pollGeo`, change the alert-source loop call from:

```ts
      const result = await ingestFireAlerts(source, config, deps.repository, now, deps.onLog);
```

to:

```ts
      const result = await ingestFireAlerts(source, config, deps.repository, now, deps.onLog, deps.onNewDetections);
```

In `pollIncidents`, change:

```ts
    const result = await ingestIncidentReports(incidents.source, incidents.repository, incidents.sourceId, now, deps.onLog);
```

to:

```ts
    const result = await ingestIncidentReports(
      incidents.source,
      incidents.repository,
      incidents.sourceId,
      now,
      deps.onLog,
      deps.onNewIncidents,
    );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pyrmap/server exec vitest run test/scheduler.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full server suite**

Run: `pnpm --filter @pyrmap/server test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/jobs/scheduler.ts packages/server/test/scheduler.test.ts
git commit -m "feat(server): wire onNewDetections/onNewIncidents through the scheduler"
```

---

### Task 8: Push subscribe/unsubscribe/vapid-public-key routes

**Files:**
- Create: `packages/server/src/routes/push.ts`
- Test: `packages/server/test/push.test.ts`
- Modify: `packages/server/src/app.ts`

**Interfaces:**
- Consumes: `PushSubscriptionRepository` (Task 2), `PushSubscriptionPayload` from `@pyrmap/shared` (Task 1).
- Produces: `pushPublicRoutes(vapidPublicKey: string | null)`, `pushRoutes(repository: PushSubscriptionRepository)` — both Fastify plugin factories, same shape as `healthRoutes`/`firesRoutes`. `buildApp` gains two new optional trailing params: `pushSubscriptionRepository?: PushSubscriptionRepository`, `vapidPublicKey?: string | null`.

- [ ] **Step 1: Write the failing test**

Create `packages/server/test/push.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { SqliteFireRepository } from '../src/adapters/sqlite/SqliteFireRepository.js';
import { SqlitePushSubscriptionRepository } from '../src/adapters/sqlite/SqlitePushSubscriptionRepository.js';
import type { AuthConfig } from '../src/routes/auth.js';

const AUTH: AuthConfig = { username: 'alex', password: 'secret-pw', sessionSecret: 'test-secret' };

let tmpDir: string;
let fireRepo: SqliteFireRepository;
let pushRepo: SqlitePushSubscriptionRepository;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'pyrmap-push-routes-test-'));
  fireRepo = new SqliteFireRepository(path.join(tmpDir, 'test.db'));
  pushRepo = new SqlitePushSubscriptionRepository(path.join(tmpDir, 'test.db'));
});

afterEach(() => {
  fireRepo.close();
  pushRepo.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('GET /api/push/vapid-public-key', () => {
  it('returns the configured public key', async () => {
    const app = await buildApp(
      { logLevel: 'silent' },
      fireRepo,
      undefined,
      '/nonexistent',
      undefined,
      undefined,
      undefined,
      pushRepo,
      'test-public-key',
    );
    const response = await app.inject({ method: 'GET', url: '/api/push/vapid-public-key' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ publicKey: 'test-public-key' });
  });

  it('404s when push notifications are not configured', async () => {
    const app = await buildApp({ logLevel: 'silent' }, fireRepo, undefined, '/nonexistent', undefined, undefined, undefined, pushRepo, null);
    const response = await app.inject({ method: 'GET', url: '/api/push/vapid-public-key' });
    expect(response.statusCode).toBe(404);
  });

  it('stays reachable without a session even when auth is enabled', async () => {
    const app = await buildApp(
      { logLevel: 'silent' },
      fireRepo,
      undefined,
      '/nonexistent',
      undefined,
      undefined,
      AUTH,
      pushRepo,
      'test-public-key',
    );
    const response = await app.inject({ method: 'GET', url: '/api/push/vapid-public-key' });
    expect(response.statusCode).toBe(200);
  });
});

describe('POST /api/push/subscribe and /api/push/unsubscribe', () => {
  it('saves and then removes a subscription', async () => {
    const app = await buildApp(
      { logLevel: 'silent' },
      fireRepo,
      undefined,
      '/nonexistent',
      undefined,
      undefined,
      undefined,
      pushRepo,
      'test-public-key',
    );

    const subscribe = await app.inject({
      method: 'POST',
      url: '/api/push/subscribe',
      payload: { endpoint: 'https://push.example/x', keys: { p256dh: 'p', auth: 'a' } },
    });
    expect(subscribe.statusCode).toBe(200);
    expect(pushRepo.listSubscriptions()).toEqual([{ endpoint: 'https://push.example/x', p256dh: 'p', auth: 'a' }]);

    const unsubscribe = await app.inject({
      method: 'POST',
      url: '/api/push/unsubscribe',
      payload: { endpoint: 'https://push.example/x' },
    });
    expect(unsubscribe.statusCode).toBe(200);
    expect(pushRepo.listSubscriptions()).toEqual([]);
  });

  it('requires a session when auth is enabled', async () => {
    const app = await buildApp(
      { logLevel: 'silent' },
      fireRepo,
      undefined,
      '/nonexistent',
      undefined,
      undefined,
      AUTH,
      pushRepo,
      'test-public-key',
    );
    const response = await app.inject({
      method: 'POST',
      url: '/api/push/subscribe',
      payload: { endpoint: 'https://push.example/x', keys: { p256dh: 'p', auth: 'a' } },
    });
    expect(response.statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pyrmap/server exec vitest run test/push.test.ts`
Expected: FAIL — cannot find module `../src/routes/push.js`, and `buildApp` doesn't accept the extra arguments yet (TS error at build time; at the test-runner level via `vitest` with esbuild transforms, this will surface as a runtime error or 404s for the unregistered routes).

- [ ] **Step 3: Write `routes/push.ts`**

Create `packages/server/src/routes/push.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import type { PushSubscriptionPayload } from '@pyrmap/shared';
import type { PushSubscriptionRepository } from '../ports/PushSubscriptionRepository.js';

/** GET /api/push/vapid-public-key — open, same tier as /api/health; public keys aren't sensitive.
 * 404s when VAPID isn't configured, so the frontend can distinguish "not set up" from a real error. */
export function pushPublicRoutes(vapidPublicKey: string | null) {
  return async function registerPushPublicRoutes(app: FastifyInstance): Promise<void> {
    app.get('/api/push/vapid-public-key', async (request, reply) => {
      if (!vapidPublicKey) {
        reply.code(404);
        return { error: 'Push notifications not configured' };
      }
      return { publicKey: vapidPublicKey };
    });
  };
}

/** POST /api/push/subscribe, POST /api/push/unsubscribe — registered in the same protected group
 * as /api/fires, so they require a session when auth is configured (docs/DECISIONS.md 2026-07-22). */
export function pushRoutes(repository: PushSubscriptionRepository) {
  return async function registerPushRoutes(app: FastifyInstance): Promise<void> {
    app.post<{ Body: PushSubscriptionPayload }>('/api/push/subscribe', async (request, reply) => {
      const { endpoint, keys } = request.body ?? ({} as Partial<PushSubscriptionPayload>);
      if (!endpoint || !keys?.p256dh || !keys?.auth) {
        reply.code(400);
        return { ok: false };
      }
      repository.saveSubscription({ endpoint, p256dh: keys.p256dh, auth: keys.auth });
      return { ok: true };
    });

    app.post<{ Body: { endpoint?: string } }>('/api/push/unsubscribe', async (request, reply) => {
      const { endpoint } = request.body ?? {};
      if (!endpoint) {
        reply.code(400);
        return { ok: false };
      }
      repository.deleteSubscription(endpoint);
      return { ok: true };
    });
  };
}
```

- [ ] **Step 4: Wire it into `app.ts`**

In `packages/server/src/app.ts`, add imports:

```ts
import type { PushSubscriptionRepository } from './ports/PushSubscriptionRepository.js';
import { pushPublicRoutes, pushRoutes } from './routes/push.js';
```

Change `buildApp`'s signature from ending `auth: AuthConfig | null = null,` to:

```ts
  auth: AuthConfig | null = null,
  pushSubscriptionRepository?: PushSubscriptionRepository,
  vapidPublicKey?: string | null,
): Promise<FastifyInstance> {
```

Add, right after `await app.register(healthRoutes(repository));`:

```ts
  await app.register(pushPublicRoutes(vapidPublicKey ?? null));
```

Inside the protected-routes block, add after `await protectedApp.register(eventsRoutes(updateBus));`:

```ts
    if (pushSubscriptionRepository) {
      await protectedApp.register(pushRoutes(pushSubscriptionRepository));
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @pyrmap/server exec vitest run test/push.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Run the full server suite**

Run: `pnpm --filter @pyrmap/server test`
Expected: all pass (existing `buildApp` callers are unaffected — all-new params are optional trailing ones).

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/routes/push.ts packages/server/test/push.test.ts packages/server/src/app.ts
git commit -m "feat(server): add push subscribe/unsubscribe/vapid-public-key routes"
```

---

### Task 9: Wire push notifications into `index.ts`

**Files:**
- Modify: `packages/server/src/index.ts`

**Interfaces:**
- Consumes: everything from Tasks 2, 5, 7, 8.

- [ ] **Step 1: Add imports**

In `packages/server/src/index.ts`, add:

```ts
import { SqlitePushSubscriptionRepository } from './adapters/sqlite/SqlitePushSubscriptionRepository.js';
import { initializePushVapid, notifyNewDetections, notifyNewIncidents } from './services/pushNotificationService.js';
```

- [ ] **Step 2: Construct the push repository and VAPID config**

After the existing `incidentIngestion`/`incidentRepository` block (right before the `auth` construction), add:

```ts
  // Push notifications, off by default — requires all three VAPID_* vars (mirrors the auth
  // pattern: a half-configured .env should never silently half-work).
  let pushSubscriptionRepository: SqlitePushSubscriptionRepository | undefined;
  const vapid =
    config.vapidPublicKey && config.vapidPrivateKey && config.vapidSubject
      ? { publicKey: config.vapidPublicKey, privateKey: config.vapidPrivateKey, subject: config.vapidSubject }
      : null;
  if (vapid) {
    pushSubscriptionRepository = new SqlitePushSubscriptionRepository(config.dbPath);
    initializePushVapid(vapid);
  }
```

- [ ] **Step 3: Pass the new params to `buildApp`**

Change:

```ts
  const app = await buildApp(config, repository, undefined, undefined, incidentRepository, updateBus, auth);
```

to:

```ts
  const app = await buildApp(
    config,
    repository,
    undefined,
    undefined,
    incidentRepository,
    updateBus,
    auth,
    pushSubscriptionRepository,
    config.vapidPublicKey,
  );
```

- [ ] **Step 4: Log push-notification status**

Right after the existing `if (incidentIngestion) { ... } else if (...) { ... }` block, add:

```ts
  if (pushSubscriptionRepository) {
    app.log.info('Push notifications enabled (VAPID configured)');
  } else {
    app.log.warn('VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT not fully set — push notifications disabled');
  }
```

- [ ] **Step 5: Wire the scheduler callbacks**

Change the `startScheduler({...})` call to add two new fields, right after `onLog: (message) => app.log.info(message),`:

```ts
    onNewDetections: pushSubscriptionRepository
      ? (detections) => void notifyNewDetections(pushSubscriptionRepository, detections, (m) => app.log.info(m))
      : undefined,
    onNewIncidents: pushSubscriptionRepository
      ? (reports) => void notifyNewIncidents(pushSubscriptionRepository, reports, (m) => app.log.info(m))
      : undefined,
```

- [ ] **Step 6: Build and run the full test suite**

Run: `pnpm -r build && pnpm --filter @pyrmap/server test`
Expected: build succeeds, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/index.ts
git commit -m "feat(server): wire push notifications into index.ts startup"
```

---

### Task 10: PWA icons and manifest

**Files:**
- Create: `packages/web/public/icon-192.png`
- Create: `packages/web/public/icon-512.png`
- Create: `packages/web/public/apple-touch-icon.png`
- Create: `packages/web/public/manifest.webmanifest`
- Modify: `packages/web/index.html`

No tests — these are static assets and markup, verified visually (Task 14 covers the manual device check).

- [ ] **Step 1: Generate the PNG icons from the existing favicon**

These use `sharp-cli` via `npx` for a one-time conversion — no new project dependency, nothing added to any `package.json`.

```bash
cd packages/web/public
npx --yes sharp-cli -i favicon.svg -o icon-192.png resize 192 192
npx --yes sharp-cli -i favicon.svg -o icon-512.png resize 512 512
npx --yes sharp-cli -i favicon.svg -o apple-touch-icon.png resize 180 180
cd ../../..
```

- [ ] **Step 2: Verify the generated files**

```bash
node -e "
const fs = require('fs');
for (const f of ['packages/web/public/icon-192.png','packages/web/public/icon-512.png','packages/web/public/apple-touch-icon.png']) {
  const buf = fs.readFileSync(f);
  console.log(f, buf.length, 'bytes, PNG magic ok:', buf.slice(0,8).toString('hex') === '89504e470d0a1a0a');
}
"
```

Expected: all three print `PNG magic ok: true`.

- [ ] **Step 3: Write the manifest**

Create `packages/web/public/manifest.webmanifest`:

```json
{
  "name": "PyrMap",
  "short_name": "PyrMap",
  "description": "Near-real-time wildfire map for Greece",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#18181b",
  "theme_color": "#dc2626",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

- [ ] **Step 4: Update `index.html`**

In `packages/web/index.html`, add after the existing `<link rel="icon" ...>` line:

```html
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <meta name="theme-color" content="#dc2626" />
```

- [ ] **Step 5: Build and eyeball the output**

Run: `pnpm --filter @pyrmap/web build`
Expected: succeeds; `packages/web/dist/` contains `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`, `manifest.webmanifest` alongside the existing `favicon.svg`.

- [ ] **Step 6: Commit**

```bash
git add packages/web/public/icon-192.png packages/web/public/icon-512.png packages/web/public/apple-touch-icon.png packages/web/public/manifest.webmanifest packages/web/index.html
git commit -m "feat(web): add PWA manifest and app icons generated from the existing favicon"
```

---

### Task 11: Service worker

**Files:**
- Create: `packages/web/public/sw.js`

No test — deliberately low-logic (see design doc), verified manually at the end.

- [ ] **Step 1: Write the service worker**

Create `packages/web/public/sw.js`:

```js
// Hand-rolled, not build-processed (no vite-plugin-pwa) — this app is live-data-dependent, not
// offline-first, so there's no precaching layer here, just install/activate/push/click handling.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  if (!event.data) return;
  const payload = event.data.json();
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: payload.url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsList) => {
      for (const client of clientsList) {
        if ('focus' in client && 'navigate' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});
```

- [ ] **Step 2: Build and verify it's copied to dist**

Run: `pnpm --filter @pyrmap/web build && ls packages/web/dist/sw.js`
Expected: the file exists in `dist/`.

- [ ] **Step 3: Commit**

```bash
git add packages/web/public/sw.js
git commit -m "feat(web): add service worker for push notifications and installability"
```

---

### Task 12: Frontend `pushNotifications` and `focusTarget` lib modules

**Files:**
- Create: `packages/web/src/lib/pushNotifications.ts`
- Test: `packages/web/src/lib/pushNotifications.test.ts`
- Create: `packages/web/src/lib/focusTarget.ts`
- Test: `packages/web/src/lib/focusTarget.test.ts`

**Interfaces:**
- Produces: `urlBase64ToUint8Array(base64String: string): Uint8Array`, `checkPushSupport(): { supported: boolean; needsInstall: boolean }`, `enablePushNotifications(): Promise<void>`, `disablePushNotifications(): Promise<void>`, `isPushEnabled(): Promise<boolean>`; `parseFocusTarget(search: string): { lat: number; lon: number } | null`.

- [ ] **Step 1: Write the failing `focusTarget` test**

Create `packages/web/src/lib/focusTarget.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseFocusTarget } from './focusTarget.js';

describe('parseFocusTarget', () => {
  it('parses a valid ?focus=lat,lon query string', () => {
    expect(parseFocusTarget('?focus=37.8989,23.8718')).toEqual({ lat: 37.8989, lon: 23.8718 });
  });

  it('returns null when there is no focus param', () => {
    expect(parseFocusTarget('')).toBeNull();
  });

  it('returns null for a malformed value', () => {
    expect(parseFocusTarget('?focus=not-a-coordinate')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pyrmap/web exec vitest run src/lib/focusTarget.test.ts`
Expected: FAIL — cannot find module `./focusTarget.js`.

- [ ] **Step 3: Write `focusTarget.ts`**

Create `packages/web/src/lib/focusTarget.ts`:

```ts
export interface FocusTarget {
  lat: number;
  lon: number;
}

/** Parses a "?focus=lat,lon" query string (from a push notification's deep link) into
 * coordinates the map should pan to. Null when absent or malformed. */
export function parseFocusTarget(search: string): FocusTarget | null {
  const params = new URLSearchParams(search);
  const raw = params.get('focus');
  if (!raw) return null;
  const [latStr, lonStr] = raw.split(',');
  const lat = Number(latStr);
  const lon = Number(lonStr);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pyrmap/web exec vitest run src/lib/focusTarget.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing `pushNotifications` test**

Create `packages/web/src/lib/pushNotifications.test.ts`:

```ts
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

  it('decodes a URL-safe base64 string containing "-" and "_"', () => {
    // Standard base64 "Pj8-" would be "Pj8-" in URL-safe form for bytes containing 0x3e/0x3f runs;
    // simplest deterministic check: round-trip via a known mapping. ">/?" is 0x3e 0x2f 0x3f in
    // standard base64 "Pj8/", which becomes "Pj8_" URL-safe.
    expect(Array.from(urlBase64ToUint8Array('Pj8_'))).toEqual([62, 63]);
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
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @pyrmap/web exec vitest run src/lib/pushNotifications.test.ts`
Expected: FAIL — cannot find module `./pushNotifications.js`.

- [ ] **Step 7: Write `pushNotifications.ts`**

Create `packages/web/src/lib/pushNotifications.ts`:

```ts
import type { PushSubscriptionPayload } from '@pyrmap/shared';

/** Converts a URL-safe base64 VAPID public key into the Uint8Array PushManager.subscribe's
 * applicationServerKey option requires. */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export interface PushSupport {
  supported: boolean;
  /** True when push requires installing to the home screen first (iOS Safari) and it isn't yet. */
  needsInstall: boolean;
}

/** Feature-detects push support. iOS Safari only supports the Push API when running as an
 * installed PWA (standalone display mode) — a regular Safari tab silently lacks PushManager. */
export function checkPushSupport(): PushSupport {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
  return { supported, needsInstall: isIos && !isStandalone && !supported };
}

function subscriptionToPayload(subscription: PushSubscription): PushSubscriptionPayload {
  const json = subscription.toJSON();
  return { endpoint: json.endpoint!, keys: { p256dh: json.keys!.p256dh!, auth: json.keys!.auth! } };
}

/** Requests notification permission, subscribes via the service worker, and registers the
 * subscription with the server. Throws if permission is denied or the server has no VAPID key. */
export async function enablePushNotifications(): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission denied');

  const keyResponse = await fetch('/api/push/vapid-public-key');
  if (!keyResponse.ok) throw new Error('Push notifications not configured on the server');
  const { publicKey } = (await keyResponse.json()) as { publicKey: string };

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(subscriptionToPayload(subscription)),
  });
}

/** Unsubscribes this device both from the browser's push manager and the server's record of it. */
export async function disablePushNotifications(): Promise<void> {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  await fetch('/api/push/unsubscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
  await subscription.unsubscribe();
}

/** Whether this device currently has an active push subscription — used to initialize the bell-icon toggle's state. */
export async function isPushEnabled(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  return subscription !== null;
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm --filter @pyrmap/web exec vitest run src/lib/pushNotifications.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 9: Run the full web test suite and build**

Run: `pnpm --filter @pyrmap/web test && pnpm --filter @pyrmap/web build`
Expected: all pass, build succeeds (this exercises TypeScript strict-mode checking of the DOM lib types used above).

- [ ] **Step 10: Commit**

```bash
git add packages/web/src/lib/pushNotifications.ts packages/web/src/lib/pushNotifications.test.ts packages/web/src/lib/focusTarget.ts packages/web/src/lib/focusTarget.test.ts
git commit -m "feat(web): add pushNotifications and focusTarget lib modules"
```

---

### Task 13: Register the service worker; bell-icon toggle; map focus-on-deep-link

**Files:**
- Modify: `packages/web/src/main.tsx`
- Modify: `packages/web/src/components/StatusBar.tsx`
- Modify: `packages/web/src/MapApp.tsx`
- Modify: `packages/web/src/components/FireMap.tsx`

No new automated tests in this task (it's UI wiring of already-tested lib functions); manual verification happens in Task 14.

- [ ] **Step 1: Register the service worker in `main.tsx`**

In `packages/web/src/main.tsx`, add right after the existing imports (before `const rootElement = ...`):

```tsx
if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js');
}
```

- [ ] **Step 2: Add the focus-pan handler to `FireMap.tsx`**

In `packages/web/src/components/FireMap.tsx`, change the import line:

```tsx
import { MapContainer, TileLayer, WMSTileLayer } from 'react-leaflet';
```

to:

```tsx
import { MapContainer, TileLayer, WMSTileLayer, useMap } from 'react-leaflet';
import { useEffect } from 'react';
import type { FocusTarget } from '../lib/focusTarget.js';
```

Add, right after the `EFFIS_ATTRIBUTION` constant:

```tsx
/** Pans the map to a deep-linked detection (from a push notification click) once, when it appears. */
function FocusHandler({ target }: { target: FocusTarget | null }): null {
  const map = useMap();
  useEffect(() => {
    if (target) map.setView([target.lat, target.lon], 13);
  }, [target, map]);
  return null;
}
```

Add `focusTarget?: FocusTarget | null;` to `FireMapProps`.

In the component, change the function signature to destructure `focusTarget`:

```tsx
export function FireMap({ polar, geo, incidents, theme, viewMode, prefs, focusTarget }: FireMapProps): JSX.Element {
```

And add `<FocusHandler target={focusTarget ?? null} />` as the first child inside `<MapContainer ...>`, right after the opening tag (before `<TileLayer ... />`).

- [ ] **Step 3: Wire it up in `MapApp.tsx`**

In `packages/web/src/MapApp.tsx`, change the import line:

```tsx
import { useMemo, useState } from 'react';
```

to:

```tsx
import { useEffect, useMemo, useState } from 'react';
```

Add new imports:

```tsx
import { parseFocusTarget } from './lib/focusTarget.js';
import {
  checkPushSupport,
  disablePushNotifications,
  enablePushNotifications,
  isPushEnabled,
} from './lib/pushNotifications.js';
```

Inside the `MapApp` function, after the existing `useState` calls, add:

```tsx
  const [focusTarget] = useState(() => parseFocusTarget(window.location.search));
  const [pushSupport] = useState(checkPushSupport);
  const [pushEnabled, setPushEnabled] = useState(false);

  useEffect(() => {
    isPushEnabled().then(setPushEnabled);
  }, []);

  async function togglePush(): Promise<void> {
    if (pushEnabled) {
      await disablePushNotifications();
      setPushEnabled(false);
    } else {
      try {
        await enablePushNotifications();
        setPushEnabled(true);
      } catch (err) {
        console.error(err);
      }
    }
  }
```

Pass `focusTarget={focusTarget}` to `<FireMap .../>`, and pass these new props to `<StatusBar .../>`, right after `onLogout={onLogout}`:

```tsx
        pushSupported={pushSupport.supported}
        pushNeedsInstall={pushSupport.needsInstall}
        pushEnabled={pushEnabled}
        onTogglePush={() => void togglePush()}
```

- [ ] **Step 4: Add the bell-icon toggle to `StatusBar.tsx`**

In `packages/web/src/components/StatusBar.tsx`, add to `StatusBarProps`, right after `onLogout?: () => void;`:

```tsx
  pushSupported: boolean;
  pushNeedsInstall: boolean;
  pushEnabled: boolean;
  onTogglePush: () => void;
```

Add the same names to the destructured function parameters. Add this button right before the `{onLogout && (...)}` block:

```tsx
      {pushSupported && (
        <button type="button" onClick={onTogglePush} aria-label="Toggle push notifications">
          {pushEnabled ? '🔔 Notifications on' : '🔕 Enable notifications'}
        </button>
      )}
      {pushNeedsInstall && (
        <span className="push-install-hint" title="Add to Home Screen from Safari's share menu, then reopen from there">
          Add to Home Screen for notifications
        </span>
      )}
```

- [ ] **Step 5: Build and manually smoke-test**

Run: `pnpm --filter @pyrmap/web build`
Expected: succeeds with no TypeScript errors.

Run: `pnpm --filter @pyrmap/server dev:mock` (in one terminal), then open `http://localhost:8080` in a desktop Chrome/Edge browser.
Expected: the bell icon appears in the status bar; clicking it prompts for notification permission (no VAPID configured yet in mock mode is fine — the fetch to `/api/push/vapid-public-key` will 404 and `enablePushNotifications` will throw, logged to the console; this is expected until Task 14's manual VAPID setup). Confirm no crash, no visual regression in the existing controls.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/main.tsx packages/web/src/components/StatusBar.tsx packages/web/src/MapApp.tsx packages/web/src/components/FireMap.tsx
git commit -m "feat(web): register service worker, add notification bell toggle and map deep-link focus"
```

---

### Task 14: Final verification, decision log, and manual device check

**Files:**
- Modify: `docs/DECISIONS.md`
- Modify: `docs/TODO.md` (only if something genuinely remains — see step 3)

- [ ] **Step 1: Full repo build and test**

Run: `pnpm -r build && pnpm test`
Expected: all packages build, all tests pass (this is the mandatory pre-commit gate for the final commit).

- [ ] **Step 2: Log the remaining durable decisions**

Append to `docs/DECISIONS.md`:

```
2026-07-22 | server | push notification auth gating: /api/push/subscribe + /api/push/unsubscribe require a session when auth is configured (same protected group as /api/fires); /api/push/vapid-public-key stays open like /api/health | explicit user decision during brainstorming; public keys aren't sensitive, and the frontend needs it before any login state exists
2026-07-22 | server | one push notification per individual new detection/incident row, both FIRMS tiers always, no re-notify on confirmation upgrade | explicit user decision during brainstorming, overriding the batched-by-default recommendation; single user, wants maximum immediacy over noise reduction
2026-07-22 | web | PWA implemented hand-rolled (manifest + sw.js), not via vite-plugin-pwa | app is live-data-dependent, not offline-first; avoids a new frontend build dependency entirely
2026-07-22 | web | PNG icons generated once via `npx sharp-cli` from the existing favicon.svg, not committed as an ongoing dependency | one-time asset conversion; no rasterization tool was available locally (checked rsvg-convert/imagemagick/inkscape, none present)
```

- [ ] **Step 3: Check whether anything needs a TODO note**

Run: `git log --oneline -20` and review this session's commits. If everything in this plan landed and all tests pass, no `docs/TODO.md` entry is needed. If some step was skipped or deferred, add up to 5 bullet lines there per the handoff protocol.

- [ ] **Step 4: Final commit if anything changed in this task**

```bash
git add docs/DECISIONS.md docs/TODO.md
git commit -m "docs(repo): log PWA/push-notification design decisions"
```

- [ ] **Step 5: Manual device verification (cannot be done from this environment)**

This step is for whoever deploys the feature, not something to automate here:
1. Generate a real VAPID keypair: `cd packages/server && pnpm exec web-push generate-vapid-keys`.
2. Add `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT=mailto:<your email>` to the real local `.env` (the fourth of the four required places — `config.ts`, `.env.example`, and `docker-compose.yml` are already done by this plan).
3. Run the real server (not `dev:mock`, since push needs real delivery) and open it in a browser.
4. Desktop: click the bell icon, accept the permission prompt, confirm a subsequent detection/incident triggers a real OS notification.
5. iPhone: open the site in Safari, use the Share sheet → "Add to Home Screen", open the installed app from the home screen, then enable notifications from there. Fully close the app (swipe up) and confirm a notification still arrives.
6. Confirm clicking a notification opens/focuses the app and the map pans to that detection's coordinates.
