# Decision Log

Append-only. One entry = one line: `YYYY-MM-DD | scope | decision | why (≤15 words)`

2026-07-17 | shared | package.json exports needs explicit `types` condition | strict NodeNext resolution ignores top-level `types` field when `exports` present
2026-07-17 | repo | added `**/*.tsbuildinfo` to .dockerignore/.gitignore | stale buildinfo copied into build context made `tsc -b` skip emitting dist
2026-07-17 | repo | pnpm-workspace.yaml sets `injectWorkspacePackages: true` | required for `pnpm deploy --prod` to work on pnpm v10+ without --legacy
2026-07-17 | server | dev:mock runs `tsc -b && node dist/index.js`, no tsx | node's type-stripping can't resolve NodeNext .js specifiers against .ts files; tsx not on the closed whitelist
2026-07-17 | web | added `@vitejs/plugin-react` (not in literal dep list) | required to build the React+Vite combo the stack table already fixes
2026-07-18 | web | dark mode added (CARTO Dark Matter tiles), default on, deviates from plan's single-basemap §8.1 | explicit user request post-v1; localStorage-persisted, no new npm dependency
2026-07-18 | server,shared | detections table gains scan_km/track_km (migration 1); markers switched from fixed-px CircleMarker to real-meter Circle sized to satellite pixel footprint, deviating from plan's [FIXED] §8.2 marker styles | explicit user request: convey true fire extent instead of uniform dots; a wide wildfire now reads as overlapping circles
2026-07-18 | server | dayRange bumped 1->2, deviating from plan §3.2 [FIXED] "always 1" | FIRMS dayRange = UTC calendar days, not trailing 24h; 1 loses late-evening passes after midnight
2026-07-18 | server | FIRMS currently lists NO MSG/SEVIRI source (verified via data_availability) | fast geo tier dark until FIRMS restores it; resolveSources auto-recovers when it returns
2026-07-18 | web | EFFIS WMS overlays (all.hs, effis.nrt.ba.poly; layer names verified via GetCapabilities) + Open-Meteo wind, both frontend-only fetches, no npm deps | user asked for combined multi-source data; keyless free services
2026-07-18 | web | wind arrows use a rotated divIcon, exempting them from §8.2's CircleMarker rule | wind is a vector needing rotation, not a fire detection
2026-07-18 | server | geo tier fed by EUMETSAT MTG FCI fire alerts (EO:EUM:DAT:0801, CAP/XML, 10-min) via optional EUMETSAT_CONSUMER_KEY/SECRET | FIRMS dropped MSG; CAP is plain XML so zero new deps; single-entry download avoids zip
2026-07-18 | server | Sentinel-3 SLSTR FRP also available in EUMETSAT store (EO:EUM:DAT:0417), same credentials | future option; parked — NetCDF format needs an HDF5 dep
2026-07-20 | server | EUMETSAT MTG CAP alert bulletin verified to apply an undocumented significance threshold: 0 Greece hits in ~40h while VIIRS/MODIS logged 135 | motivated the LSA SAF addition below
2026-07-20 | server | added second geo source: LSA SAF MSG FRP-PIXEL "ListProduct" (HDF5, 15-min, full-disk, no threshold) via LSASAF_USERNAME/PASSWORD | live-verified 34 Greece hits in 3h vs 0 from the CAP feed in the same window; kept alongside EUMETSAT MTG (10-min, additive, not a replacement)
2026-07-20 | server | added `h5wasm` (WASM-compiled HDF5, no native build step) to parse LSA SAF's HDF5-only FRP-PIXEL product | only format offered for this product (no NetCDF/OPeNDAP option); WASM avoids native compilation on Windows dev machines
2026-07-20 | server | X API has no free tier since Feb 2026: pay-per-use, $5/1000 tweet reads; single-account timeline w/ since_id ~$15-25/mo | explicit user request; ruled out full hashtag search (different, costlier endpoint) and scraping (ToS risk)
2026-07-20 | server | added a new "reported incidents" concept, separate table/port from Detection | text reports geocoded from free text are structurally different from satellite pixels; no confirmation/decay logic applies
2026-07-20 | server,shared | new geo tier via `X_BEARER_TOKEN`: polls @pyrosvestiki (Greek Fire Service), classifies+geocodes Greek free text | explicit user request; deliberately NOT the generalized #hashtag search also proposed — parked, costlier/noisier endpoint
2026-07-20 | server | geocoding gazetteer built once from GeoNames GR.txt dump (54 regional units via ADM2 rows + genitive parsed from "Νομός X" altnames; 13341 populated places) | free, CC-BY, matches how the account casually refers to regions (old nomos names, confirmed against real posts)
2026-07-20 | server | geocoding is tiered and never guesses: settlement-precision when disambiguated by nearest-to-region, else regional-unit centroid, else the post is skipped | "SUPER reliable" reframed with the user as "never wrong, sometimes coarse or skipped" — verified against real posts including known failure modes (accusative case, accent variants, multi-clause sentences)
2026-07-20 | server | incident reports render as a distinct divIcon (purple megaphone), exempting them from §8.2's marker-style rule | same reasoning as the wind arrow exemption above — not a satellite detection at all
2026-07-20 | repo | .gitignore's `data/` line anchored to `/data/` | unanchored, it silently ignored packages/server/src/domain/data/ (the gazetteer files) too
2026-07-20 | server | extractLocationPhrase scoped to the post's first sentence only | real miss caught live: a later "του δήμου X" naming which municipality sent backup water tankers was outranking the actual fire location in the first sentence
2026-07-20 | server | each skipped incident post now logs individually (id, extracted settlement/region if any, truncated text), not just an aggregate count | posts are human-written, not templated output — the Paleochori miss was only found because the user happened to notice; future misses need to surface in logs, not require a user report
