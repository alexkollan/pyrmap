# Decision Log

Append-only. One entry = one line: `YYYY-MM-DD | scope | decision | why (≤15 words)`

2026-07-17 | shared | package.json exports needs explicit `types` condition | strict NodeNext resolution ignores top-level `types` field when `exports` present
2026-07-17 | repo | added `**/*.tsbuildinfo` to .dockerignore/.gitignore | stale buildinfo copied into build context made `tsc -b` skip emitting dist
2026-07-17 | repo | pnpm-workspace.yaml sets `injectWorkspacePackages: true` | required for `pnpm deploy --prod` to work on pnpm v10+ without --legacy
2026-07-17 | server | dev:mock runs `tsc -b && node dist/index.js`, no tsx | node's type-stripping can't resolve NodeNext .js specifiers against .ts files; tsx not on the closed whitelist
2026-07-17 | web | added `@vitejs/plugin-react` (not in literal dep list) | required to build the React+Vite combo the stack table already fixes
2026-07-18 | web | dark mode added (CARTO Dark Matter tiles), default on, deviates from plan's single-basemap §8.1 | explicit user request post-v1; localStorage-persisted, no new npm dependency
2026-07-18 | server,shared | detections table gains scan_km/track_km (migration 1); markers switched from fixed-px CircleMarker to real-meter Circle sized to satellite pixel footprint, deviating from plan's [FIXED] §8.2 marker styles | explicit user request: convey true fire extent instead of uniform dots; a wide wildfire now reads as overlapping circles
