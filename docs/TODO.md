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

- Push notifications are code-complete but NOT yet live: needs a real VAPID keypair
  (`cd packages/server && pnpm exec web-push generate-vapid-keys`) added to the deployment's
  VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT env vars, then a manual device check (desktop +
  iPhone Add-to-Home-Screen) — see the design spec's manual-verification checklist.
- Mobile CSS layout (status bar wrapping, panel repositioning at ≤640px) was verified for
  correctness (real class names, valid syntax) but never actually rendered in a browser — no
  headless-browser system dependency could be installed in this dev environment without sudo.
  Needs a real visual check on an actual phone or devtools device toolbar at ~375-414px before
  trusting it fully.
- No other open work; nothing mid-milestone; tree clean as of 2026-07-22.
- Repo is intentionally public (see `CLAUDE.md` §2) — don't flip it private without reading why.
- Any task adding an env var must update `config.ts` + `.env` + `.env.example` +
  `docker-compose.yml`'s `environment:` block, all four — see `CLAUDE.md` §9 and
  `docs/DECISIONS.md` 2026-07-20 for the miss that cost a full session to diagnose.
