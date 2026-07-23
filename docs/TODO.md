# Cross-session handoff notes

All milestones M1-M6 complete and tagged (m1..m6), plus post-m6 work: LSA SAF + EUMETSAT MTG geo
sources, X/pyrosvestiki reported-fires layer with Greek geocoding, SSE live push, age-gradient
markers, favicon, single-user auth, Portainer/GitHub Actions CI/CD, PWA + push notifications
(manifest/service-worker/subscribe flow, one push per new detection/incident, both FIRMS tiers),
Nominatim live geocoding (offline gazetteer as fallback), a real Greece boundary polygon filtering
out Turkish hotspots, per-day durable failure logs, a rescan control (6h/12h/24h, all sources
including X), and fully persisted UI state (6h default window, panel collapsed state).
`pnpm -r build && pnpm test` green (257 tests), live production verified at pyrmap.alexcoll.in
(real FIRMS/EUMETSAT/LSASAF/X data flowing, `/api/status` showing real rowsInserted).

- Push notifications are live in production (real VAPID keypair deployed): exactly 2 stored
  subscriptions as of 2026-07-23 (one `fcm.googleapis.com` = Android/Chrome, one
  `web.push.apple.com` = iPhone PWA).
- **OPEN BUG under investigation, reported 2026-07-23: every push notification (confirmed for
  X/incident posts, user says also on detections) is displayed 3 times, identically, on a single
  device — reproduced on both the iPhone and a separate Windows desktop.** Investigation so far
  (do not redo this without reading it first):
  - Ruled out server-side duplication with hard evidence: `docker logs` shows exactly one
    `source=PYROSVESTIKI_X ... inserted=1` line per real new tweet (never repeated), and
    `ingestIncidentReports`/`insertIncidentReports` are airtight — `external_id` is `UNIQUE`,
    insert uses `INSERT OR IGNORE`, and `onInserted`/`notifyNewIncidents`/`notifyNewDetections`
    each have exactly one call site (`index.ts`), each iterating the subscriptions list exactly
    once. `rescanIncidentReports` does not call any notify callback at all.
  - Ruled out duplicate/stale subscription rows: queried the live DB directly
    (`docker exec -w /app pyrmap node -e "...better-sqlite3..."`, see chat for exact command) —
    exactly 2 rows total, one per device, not 3.
  - Confirmed (via the user) the 3 banners are byte-for-byte identical, not 3 distinct posts that
    look similar — this is genuine duplicate delivery/display of one message, not a
    misunderstanding.
  - Conclusion so far: the duplication happens *after* our single `webpush.sendNotification()`
    call leaves the server — either push-service-level redelivery (FCM/APNs both doing this in
    lockstep would be unusual) or something in `sw.js`'s `push` handler on the client. Not yet
    root-caused.
  - Proposed next diagnostic (not yet run): toggle the notification bell off/on on the Windows
    desktop (forces a real `unsubscribe()` + fresh `subscribe()`, replacing that one stored row),
    then check whether the very next notification still triples. If yes, points to something
    structural/transport-level; if no, that specific subscription was somehow corrupted.
  - `packages/web/public/sw.js`'s `push` handler has no `tag` on `showNotification` — not
    necessarily related to this bug (all 3 banners are said to be identical single-message
    duplicates, not 3 different messages stacking), but worth adding regardless for general
    notification-grouping hygiene when this gets picked back up.
- Mobile CSS layout (status bar wrapping, panel repositioning at ≤640px) was verified for
  correctness (real class names, valid syntax) but never actually rendered in a browser — no
  headless-browser system dependency could be installed in this dev environment without sudo.
  Needs a real visual check on an actual phone or devtools device toolbar at ~375-414px before
  trusting it fully.
- **Found while fixing incident-log dedup/noise (2026-07-23, out of scope for that task, not fixed):**
  real active-fire posts still fail `extractLocationPhrase` (logged as `no-location`, correctly —
  this note is about the parser gap, not the logging bug) for two reasons seen in real logs today:
  (1) neuter-plural place names take "στα" ("in the", plural), e.g. "στα Οινόφυτα Βοιωτίας" —
  GENERIC_RE only has στο/στη/στην/στον, no στα; (2) a place name immediately followed by a digit
  before any comma/period (e.g. "στο Δερβένι Ωραιοκάστρου Θεσσαλονίκης και επιχειρούν 78
  πυροσβέστες...") fails PHRASE_END entirely, because PHRASE's character class excludes digits and
  there's no punctuation before the number — very common phrasing (headcounts/vehicle counts appear
  right after the place name in most posts), likely a frequent real miss.
- No other open work besides the two items above; tree clean as of 2026-07-23.
- Repo is intentionally public (see `CLAUDE.md` §2) — don't flip it private without reading why.
- Any task adding an env var must update `config.ts` + `.env` + `.env.example` +
  `docker-compose.yml`'s `environment:` block, all four — see `CLAUDE.md` §9 and
  `docs/DECISIONS.md` 2026-07-20 for the miss that cost a full session to diagnose.

- **112 civil-protection alerts feature complete** (2026-07-23) — see
  `docs/superpowers/specs/2026-07-23-112-civil-protection-alerts-design.md` and the plan at
  `docs/superpowers/plans/2026-07-23-112-civil-protection-alerts.md`. `X_BEARER_TOKEN` gates it,
  same as incident reports — no new env var needed. Live-verified end-to-end against the real X
  API + Nominatim (see `docs/DECISIONS.md`); not yet pushed to production — user wants to test it
  themselves first.
- Known gap: Κυκλάδες and Αττική regional units have no bundled boundary polygon (periphery-level
  groupings, not single OSM regional units) — point pin only if a 112 post names only one of these.
- Known gap: alert retention (`deleteAlertsBefore` exists on the repository) isn't yet wired into
  `runRetention`'s daily sweep — alerts currently accumulate indefinitely. Low priority (112
  activations are rare relative to detections/incidents) but revisit if storage becomes a concern.
- Frontend 112 alert components (marker/area layer/edit controls) were build+unit-test verified
  but not visually rendered in a real browser in this session — same gap as the pre-existing mobile
  CSS note above. Verify visually before/while testing the feature live.
