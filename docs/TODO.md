# Cross-session handoff notes

All milestones M1-M6 complete and tagged (m1..m6), plus post-m6 work: LSA SAF + EUMETSAT MTG geo
sources, X/pyrosvestiki reported-fires layer with Greek geocoding, SSE live push, age-gradient
markers, favicon, single-user auth, and Portainer/GitHub Actions CI/CD. `pnpm -r build && pnpm
test` green, live production verified at pyrmap.alexcoll.in (real FIRMS/EUMETSAT/LSASAF/X data
flowing, `/api/status` showing real rowsInserted).

- No open work; nothing mid-milestone; tree clean as of 2026-07-20.
- Repo is intentionally public (see `CLAUDE.md` §2) — don't flip it private without reading why.
- Any task adding an env var must update `config.ts` + `.env` + `.env.example` +
  `docker-compose.yml`'s `environment:` block, all four — see `CLAUDE.md` §9 and
  `docs/DECISIONS.md` 2026-07-20 for the miss that cost a full session to diagnose.
