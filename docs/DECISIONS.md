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
