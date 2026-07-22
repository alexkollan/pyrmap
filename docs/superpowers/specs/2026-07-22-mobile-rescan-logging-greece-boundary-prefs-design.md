# Mobile Layout, Rescan, Failure Logging, Greece Boundary, and Persisted Prefs — Design

Date: 2026-07-22
Status: Approved

## Context

Five independent follow-ups requested after the PWA/push-notification and Nominatim-geocoding
work landed:

1. The app is now installable on mobile (PWA) but the layout wasn't designed for narrow screens —
   controls and panels overlap.
2. There's no way to force a re-check of a time window across all sources (including X) for
   entries that were missed or failed to resolve — only the existing 5-minute auto-refresh, which
   never revisits anything already polled.
3. Failures (no location extracted, geocode failed, etc.) are only visible in server logs
   (ephemeral, not persisted anywhere durable) — need a persistent, inspectable record.
4. FIRMS's Area API only supports a rectangular bounding box (verified against NASA's own API
   docs — no polygon/custom-shape option exists), so the current bbox necessarily includes a
   strip of Turkey's Aegean coast near the Greek islands, producing both spurious map markers and
   spurious push notifications for Turkish hotspots.
5. The default time window (24h) is too broad for daily use, and UI state that should feel
   "sticky" (time window, panel collapsed/expanded) resets on every reload.

Decided order: **3 before 2** (rescan's retry logic reuses the same failure-logging mechanism).
1, 4, and 5 are independent of 2/3 and of each other.

## 1. Mobile-friendly layout

CSS-only. Media-query breakpoint at 640px (matches the existing `Legend` collapse-button
breakpoint already in the codebase, so behavior stays consistent across components):
- `StatusBar`: switch from a single horizontal row to a wrapped/stacked layout; combine the
  hours-select and refresh button into a tighter group.
- `LayersPanel` and `Legend`: default to collapsed on narrow screens on first-ever visit (a
  stored preference still overrides this after that — see §5).
- No JS/behavior changes — verified visually in a real browser at mobile viewport widths before
  considering this done, per the project's UI-verification standard.

## 2 & 3. Persistent failure logging, then rescan

### 3. Failure logging

New directory `${DB_PATH's directory}/logs/incidents/`, created if missing (mirrors how `DB_PATH`
already anchors runtime state under the mounted data volume in `docker-compose.yml`, so this
directory persists across container recreation the same way the SQLite file does). One file per
UTC calendar day: `YYYY-MM-DD.log`, appended to (never overwritten). One line per failure, each a
single JSON object (easy to grep, easy to feed to a coding agent later, per the stated purpose):

```json
{"timestamp":"2026-07-22T18:03:11Z","source":"PYROSVESTIKI_X","externalId":"...","reason":"no-location","text":"<full original post text>"}
{"timestamp":"2026-07-22T18:04:02Z","source":"PYROSVESTIKI_X","externalId":"...","reason":"no-geocode","settlement":"...","region":"...","text":"<full original post text>"}
```

`reason` is one of: `no-location` (isFireIncidentPost matched but extractLocationPhrase found
nothing), `no-geocode` (both Nominatim and the offline gazetteer failed). This replaces nothing —
the existing `onLog` console logging stays as-is; this is an additional, durable sink specifically
for failures, scoped to the incident/X pipeline (where "failed to resolve" is a meaningful, common
occurrence) — not satellite CSV parsing, which fails in a structurally different way already
captured by `fetch_log`.

### 2. Rescan

New UI control, separate from the existing "Refresh" button: a small "Re-scan" dropdown next to
it with 6h/12h/24h options. Triggers a one-off backend pass, not a change to the auto-poll
schedule:

- **New route** `POST /api/rescan` with body `{ hours: 6 | 12 | 24 }`, session-gated the same as
  `/api/fires` when auth is configured.
- **Satellite sources** (FIRMS/EUMETSAT/LSA SAF): these already re-fetch their full configured
  window on every normal poll and dedup via `dedup_key`, so a rescan for these is just "run a poll
  right now" — reuses the existing `ingestSource`/`ingestFireAlerts` functions directly, no new
  logic needed there.
- **Incident reports (X)**: the normal poll path uses `since_id`, which by design never revisits
  anything already fetched. A rescan instead calls the X API with `start_time`/`end_time` for the
  requested window (X API v2 supports this on the user-tweets endpoint — verified against X's own
  docs) and *no* `since_id`, so it gets every post in the window regardless of prior polls. For
  each post: if a report with that `external_id` is already stored (already resolved), skip it
  entirely (no re-processing, no duplicate work); otherwise classify → extract → geocode exactly
  as the normal path does, insert on success, and log via §3's mechanism on failure.
- **Cost**: unlike normal polling, this is a paid X read every time it's used (confirmed
  accepted). A client-side + server-side cooldown (5 minutes after a rescan completes) disables
  the control to prevent accidental repeated triggering.
- **Accuracy of the time window**: `start_time`/`end_time` are computed from the server's current
  UTC time at the moment the rescan is triggered (`now() - Nh` to `now()`), not from any cached or
  approximate value — confirmed as the specific concern to get right.

## 4. Restrict satellite data to Greece's actual boundary

- New data file `packages/server/src/domain/data/greeceBoundary.json` — Greece's real MultiPolygon
  boundary (mainland + every island), sourced from OpenStreetMap's own maintained boundary
  relation, kept at full precision (no simplification) given how close some islands sit to the
  Turkish coast.
- New pure domain function `isWithinGreece(latitude, longitude): boolean` in
  `domain/greeceBoundary.ts` — ray-casting point-in-MultiPolygon test (ray-casting is well-defined
  arithmetic; no new dependency needed for this). A cheap bounding-box pre-check per polygon part
  skips the expensive per-edge test for parts nowhere near the query point.
- Verified live against 15 real coordinate pairs (every Greek island close to Turkey, paired with
  the nearest Turkish town across the strait) using an independent geometry library — all correct,
  including Kastellorizo (~2km from Turkey, the tightest case in the Aegean).
- Wired into `persistNewDetections` (the single function already shared by every satellite ingest
  path — FIRMS CSV polling and fire-alert circles alike), filtering `NewDetectionRow[]` before
  insertion. Since push notifications only ever fire from `onInserted` after a row is actually
  stored, this simultaneously stops Turkish hotspots from ever reaching the map *and* from ever
  triggering a notification.
- Incident reports are not touched by this filter — they're already Greece-only by construction
  (Nominatim's `countrycodes=gr` restriction, and the offline gazetteer only contains Greek
  places), so there's nothing to filter there.

## 5. Default 6h + fully persistent UI state

- `DEFAULT_HOURS` changes from 24 to 6.
- New `lib/uiPrefs.ts` (or an extension of the existing per-concern lib pattern) persists, via the
  same `localStorage` convention already used for theme/view-mode/layer-prefs: the selected hours
  window, and the collapsed/expanded state of `LayersPanel` and `Legend` (currently local
  component state via `useState(false)`, reset on every reload — lifted out and persisted).

## Testing

- `greeceBoundary.test.ts`: the same 15 real coordinate pairs already verified, as permanent
  regression protection, plus a couple of interior/mainland sanity checks.
- `persistNewDetections` gains a test proving an out-of-boundary row is silently dropped (never
  inserted, never triggers `onInserted`) while an in-boundary row is unaffected.
- New `rescan` service function tests: fake `IncidentSource`/`FireDataSource` proving (a) the
  correct `start_time`/`end_time` window is requested, (b) an already-resolved external_id is
  skipped without re-processing, (c) a still-failing post is logged via the §3 mechanism and not
  retried indefinitely within the same rescan call, (d) satellite sources are just re-polled.
- Failure-logging tests: a fake clock/filesystem (or a real tmpdir, matching this codebase's
  existing SQLite-via-tmpdir test convention) proving one file per UTC day, correct JSON shape,
  append (not overwrite) behavior.
- `uiPrefs` tests: same `vi.stubGlobal('localStorage', ...)` pattern already used by
  `layerPrefs.test.ts`.
- Mobile layout: no automated test (CSS-only); verified visually in a real browser at mobile
  viewport widths before considering done.

## Explicitly out of scope for this round

- Rescan for satellite sources does not get its own new retry/failure-logging mechanism — FIRMS
  rows either parse or don't (a structurally different failure mode from geocoding), and dedup
  already makes re-polling safe and free of duplicate-insert risk.
- No UI for browsing/searching the failure logs from within the app — they're meant to be read by
  a coding agent or by hand on the server, not surfaced in the PyrMap UI itself.
