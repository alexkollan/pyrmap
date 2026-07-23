# Incident pin correction — design

## Motivation

A live miss (2026-07-23, see `docs/DECISIONS.md`) put a fire pin in the wrong Derveni (Korinthia
instead of Oraiokastro, Thessaloniki) because `extractLocationPhrase` only read the first of two
chained location clauses in the post. That parsing bug is fixed (commit `8ab7e72`), but the
already-ingested wrong pin doesn't self-heal: `insertIncidentReports` is `INSERT OR IGNORE` on
`external_id`, and rescan explicitly skips any `external_id` already stored — so a bad pin, once
in, stays exactly as wrong forever unless something corrects it directly.

This adds a manual correction capability for incident-report pins: reposition a pin (by drag,
by typing coordinates, or by searching a place name) or remove it, gated behind the existing
single-user auth session. This is a genuinely new capability, not a change to anything in
`docs/pyrmap-dev-plan.md`'s `[FIXED]` sections.

## Data model

One migration appended to `migrations.ts` (append-only — never edit a committed migration):

```sql
ALTER TABLE incident_reports ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
```

- **Hide** (the only "delete" the UI exposes as reversible-sounding but isn't): sets `hidden = 1`.
  The row stays in the table, so its `external_id` permanently blocks re-insertion by any future
  poll or rescan — the same post can never come back. No UI path un-hides it.
- **Delete forever**: a real `DELETE FROM incident_reports WHERE id = ?`. The `external_id` is
  gone, so if a future rescan re-fetches that same post, it is treated as new and re-runs the full
  classify → extract → geocode pipeline (using whatever code is live at that time).
- **Location correction** (drag, manual entry, or picking a search result) updates `latitude`,
  `longitude`, and sets `precision = 'settlement'` on the existing row — a human placed it
  exactly, which is at least as precise as the automatic settlement tier, and avoids the
  `regional_unit` faded/coarse rendering looking wrong on a pin that's now exact.
- `findIncidentReportsSince` (backing `/api/fires`) gains a `WHERE hidden = 0` clause so hidden
  rows never reach any client. `deleteIncidentReportsBefore` (retention) is untouched — hidden
  rows age out and get purged on the same schedule as any other row.

`IncidentReportRepository` (port) gains three methods:
- `updateIncidentReportLocation(id: number, latitude: number, longitude: number): boolean` —
  returns whether a row was found and updated.
- `hideIncidentReport(id: number): boolean`
- `deleteIncidentReport(id: number): boolean`

All three return `false` for an unknown `id`, which routes turn into a 404.

## Location search (third correction input)

A new method on the existing `NominatimClient` (server already depends on it for automatic
incident geocoding): `search(query): Promise<LocationSearchResult[]>`. It shares the client's
existing 1-request/1.1s throttle (same instance, same `lastCallAt` state) so manual searches and
background auto-geocoding can never together exceed Nominatim's rate limit.

Unlike the existing `geocode()` method — which exists to serve the *automated* pipeline and must
strictly reject any result whose `addresstype` isn't a real place (roads/shops routinely rank
above the real place for a bare query, see `docs/DECISIONS.md` 2026-07-22) — `search()` returns up
to 5 raw results (`displayName`, `latitude`, `longitude`) with no type filtering at all. A human is
reading the names and choosing, so a road or shop showing up in the list is just noise, not a
mismapping risk.

New shared type (`@pyrmap/shared`):

```ts
export interface LocationSearchResult {
  displayName: string;
  latitude: number;
  longitude: number;
}
```

## API (new routes, all in the existing auth-protected route group — 401 without a session
whenever auth is configured, same as `/api/push/*`)

- `PATCH /api/incidents/:id/location` — body `{ latitude: number; longitude: number }` → updated
  `IncidentReport`, 404 if unknown id. Used by drag, manual lat/lon entry, and picking a search
  result — all three converge here; only how the caller arrives at the numbers differs.
- `POST /api/incidents/:id/hide` → `{ ok: true }`, 404 if unknown id.
- `DELETE /api/incidents/:id` → `{ ok: true }`, 404 if unknown id.
- `GET /api/geocode/search?q=<text>` → `{ results: LocationSearchResult[] }`. Returns
  `{ results: [] }` if no geocoding source is configured (mirrors how the rest of the app treats
  an unconfigured optional integration as "off", not an error).

All four routes call `updateBus.publish()` on success, reusing the existing SSE refresh mechanism
(`/api/events`) that every other mutating action (rescan, ingestion) already uses — the frontend
needs no bespoke optimistic-update plumbing; every connected client (including the one that made
the edit) just gets a "refresh" push and refetches `/api/fires`, which already excludes hidden
rows and reflects the corrected coordinates.

## Frontend

- `MapApp` gets an `editMode` boolean (default off) and a toggle button in `StatusBar`, next to
  the other global toggles (theme, view mode). Off by default so ordinary panning/zooming/tapping
  a pin on mobile never risks an accidental drag.
- `IncidentMarker` gets an `editMode` prop. When on: the Leaflet marker becomes `draggable`, and on
  `dragend` calls `PATCH /api/incidents/:id/location` directly (no local optimistic state needed —
  see SSE point above). The popup gains, only in edit mode:
  - two number inputs (lat/lon) + "Save" — same endpoint as drag.
  - a text box + explicit "Search" button (not live-as-you-type, to respect the shared Nominatim
    throttle) that calls `GET /api/geocode/search` and lists results by name; clicking a result
    commits it immediately through the same `PATCH` endpoint — one click, like dropping a pin.
  - "Hide" and "Delete forever" buttons, each behind a native `confirm()` worded to match the real
    semantics ("hidden — can never reappear, even if re-scanned" vs. "deleted — may reappear if a
    future scan re-fetches this exact post").
- These controls only need `editMode` to gate them, not a separate authentication check — `MapApp`
  itself only ever renders for an authenticated session or in open (no-auth) local dev, per
  `App.tsx`'s existing login gate. There is no per-user role system today; if this app ever gets
  more users, "only me, not them" would need a real role, which doesn't exist yet — flagged as a
  known gap, not built speculatively.
- `IncidentMarker.tsx` currently sits under 60 lines; the new controls are extracted into a
  sibling `IncidentEditControls.tsx` component (props: incident, callbacks for save/hide/delete/
  search) to keep both files well under the 300-line soft limit and keep drag-wiring separate from
  form-wiring.

## Error handling

- Backend: Fastify schema validation on the `PATCH` body (finite numbers, sane lat/lon ranges) →
  400 on bad input; unknown `id` → 404 for all three mutating routes. No Greece-boundary
  restriction on manual corrections or search results — the operator is trusted to place a pin
  correctly; `search()` is already restricted to `countrycodes=gr` in practice.
- Frontend: each action (save/hide/delete/search) is wrapped in try/catch; a failure shows a small
  inline error line in the popup (no new toast/notification dependency) and leaves the pin exactly
  as it was — there's no local optimistic state to roll back, since the map only updates once the
  server confirms via the SSE refresh.

## Testing

- `SqliteIncidentReportRepository` (real DB, existing pattern): each new method, plus
  `findIncidentReportsSince` excluding hidden rows, plus proving a deleted-forever `external_id`
  is genuinely re-insertable while a hidden one is not.
- New route tests (`test/incidents.test.ts`): 401 without session when auth is configured, success
  with a session, 404 for an unknown id, hidden rows absent from `/api/fires`.
- `NominatimClient.test.ts`: new tests for `search()` mirroring the existing `geocode()` tests —
  multiple unfiltered results returned, shared throttle with `geocode()`.
- `GET /api/geocode/search` route test: 200 with results, empty results when no geocoding source
  configured, 400 on missing/empty `q`.
- Frontend: this codebase has no component-level test setup today (only pure `lib/` unit tests) —
  no new testing-library dependency is introduced for this alone. The drag/edit-mode/search/hide/
  delete flow will be manually verified in a real browser before this is called done; if this
  sandboxed environment can't render a real browser (a prior session hit this — see
  `docs/DECISIONS.md` 2026-07-22, missing `libasound.so.2`), that limitation will be reported
  explicitly rather than silently skipped.

## Out of scope

- Per-user roles / multi-admin permissions.
- Undo for a location correction (dragging/re-searching again is the undo).
- Any UI to inspect or restore a hidden row — it stays in the DB for the `external_id` block only,
  never surfaced again.
