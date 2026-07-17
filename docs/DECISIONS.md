# Decision Log

Append-only. One entry = one line: `YYYY-MM-DD | scope | decision | why (≤15 words)`

2026-07-17 | shared | package.json exports needs explicit `types` condition | strict NodeNext resolution ignores top-level `types` field when `exports` present
2026-07-17 | repo | added `**/*.tsbuildinfo` to .dockerignore/.gitignore | stale buildinfo copied into build context made `tsc -b` skip emitting dist
2026-07-17 | repo | pnpm-workspace.yaml sets `injectWorkspacePackages: true` | required for `pnpm deploy --prod` to work on pnpm v10+ without --legacy
2026-07-17 | server | dev:mock runs `tsc -b && node dist/index.js`, no tsx | node's type-stripping can't resolve NodeNext .js specifiers against .ts files; tsx not on the closed whitelist
2026-07-17 | web | added `@vitejs/plugin-react` (not in literal dep list) | required to build the React+Vite combo the stack table already fixes
