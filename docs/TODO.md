# Cross-session handoff notes

All milestones M1-M6 complete and tagged (m1..m6). `pnpm -r build && pnpm test` and
`docker build .` both verified green as of the m6 tag.

- Not verified: real FIRMS_MAP_KEY end-to-end (no key available in this session). All
  ingestion/confirmation/decay/retention logic is covered by tests with fixture data and
  a real Docker run (invalid key), but nobody has watched live FIRMS data flow in yet.
  If picking this up, get a key, `docker compose up -d` (or add a temp `ports:` mapping),
  and watch `/api/status.lastFetch` for real rowsInserted counts.
- No open work beyond that; nothing mid-milestone.
