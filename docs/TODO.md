# Cross-session handoff notes

All milestones M1-M6 complete and tagged (m1..m6), plus post-m6 work: LSA SAF + EUMETSAT MTG geo
sources, X/pyrosvestiki reported-fires layer with Greek geocoding, SSE live push, age-gradient
markers, favicon, single-user auth, Portainer/GitHub Actions CI/CD, and PWA + push notifications
(manifest/service-worker/subscribe flow, one push per new detection/incident, both FIRMS tiers).
`pnpm -r build && pnpm test` green, live production verified at pyrmap.alexcoll.in (real
FIRMS/EUMETSAT/LSASAF/X data flowing, `/api/status` showing real rowsInserted).

- Push notifications are code-complete but NOT yet live: needs a real VAPID keypair
  (`cd packages/server && pnpm exec web-push generate-vapid-keys`) added to the deployment's
  VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT env vars, then a manual device check (desktop +
  iPhone Add-to-Home-Screen) — see the design spec's manual-verification checklist.
- No other open work; nothing mid-milestone; tree clean as of 2026-07-22.
- Repo is intentionally public (see `CLAUDE.md` §2) — don't flip it private without reading why.
- Any task adding an env var must update `config.ts` + `.env` + `.env.example` +
  `docker-compose.yml`'s `environment:` block, all four — see `CLAUDE.md` §9 and
  `docs/DECISIONS.md` 2026-07-20 for the miss that cost a full session to diagnose.
