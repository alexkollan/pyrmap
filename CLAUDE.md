# CLAUDE.md — PyrMap Agent Working Rules

You are one of possibly several agents working on this codebase over time. These rules exist to keep the codebase stable across agent handoffs and to keep your context usage low. **These rules override ad-hoc judgment.** The authoritative product/architecture spec is `docs/pyrmap-dev-plan.md` — read the relevant section before touching the corresponding code; do not re-derive decisions it already makes.

## 1. Source of truth hierarchy

1. `docs/pyrmap-dev-plan.md` — WHAT to build and architecture **[FIXED]** decisions. Never contradict it. If it's genuinely wrong/impossible, stop and report; do not silently improvise.
2. This file — HOW to work.
3. Code + tests — current state of reality.
4. `docs/DECISIONS.md` (Decision log, §8 below) — durable choices made during development.

## 2. Git discipline (mandatory)

- Remote is `origin` on GitHub (**private** repo), branch `main`, linear history. No branches, no force-push, no history rewriting.
- **Pushing to `main` triggers a real production deployment**: a GitHub Actions workflow (`.github/workflows/deploy.yml`) hits a Portainer webhook, which rebuilds and redeploys the live VPS instance if the commit hash changed. Treat every push to `main` as "this goes live," not as a save point — confirm with the user before pushing unless they've explicitly asked you to push as part of the current task.
- **Never commit broken code.** Before EVERY commit: `pnpm -r build && pnpm test` must pass. No exceptions, including "WIP" commits — WIP commits are forbidden.
- One commit = one working unit (a parser + its tests; a route + its tests). Not one commit per milestone, not one commit per file.
- Conventional Commits: `feat|fix|test|chore|refactor|docs(scope): message`. Scopes: `server`, `web`, `shared`, `repo`.
- Tag milestone completions: `m1`…`m6`.
- Commit messages describe WHY when non-obvious, not a list of files changed.
- Before starting work: run `git log --oneline -15` and `git status`. If the tree is dirty from a previous agent, do not build on top of it — inspect, then either commit it properly (if it passes build+tests and is coherent) or `git restore` it. Never leave a dirty tree at the end of your session.

## 3. Architecture invariants (violating these = rejected work)

- Hexagonal boundaries: `domain/` is pure — no I/O, no imports from `adapters/`, `services/`, `routes/`, no direct DB/HTTP. Ports are interfaces; adapters implement them; services orchestrate.
- All cross-package shared types live in `@pyrmap/shared`. Never duplicate a type in two packages. Never define API response shapes inline — import from shared.
- Dependency whitelist is closed (plan §15). Adding any dependency outside it requires a justification comment at the import site AND a Decision log entry.
- TypeScript strict everywhere. No `any` unless annotated `// any-ok: <reason>`. No `@ts-ignore` — use `@ts-expect-error` with a reason if truly unavoidable.
- All timestamps UTC ISO 8601 internally. Timezone conversion happens ONLY in frontend display components.
- Parsing external data (FIRMS CSV) is done ONLY in `adapters/firms/`. Nothing else touches raw CSV.
- SQL lives ONLY in `adapters/sqlite/`. No SQL strings anywhere else.

## 4. Testing rules

- New domain logic ⇒ unit tests in the same commit. New route ⇒ integration test in the same commit.
- Never weaken, delete, or skip an existing test to make your change pass. If a test genuinely must change because behavior legitimately changed, the plan or Decision log must justify it, and say so in the commit message.
- Tests must not hit the real FIRMS API. Use fixtures in `packages/server/test/fixtures/` and injected fake `FireDataSource`. Tests must not depend on wall-clock time — inject `now` into domain functions.
- Fixtures are real-format samples; if FIRMS changes format, update the fixture from a real response and note it in the Decision log.

## 5. Context efficiency (how to work without drowning)

Goal: know exactly what you need, load as little as possible.

- **Start of session ritual (in order, nothing else):**
  1. `git log --oneline -15` — where the project is.
  2. Read `docs/DECISIONS.md` — it is intentionally short.
  3. Read ONLY the plan section(s) for your current task (they are numbered; the task will reference them).
  4. Open only the files you will edit plus their direct ports/types.
- **Do NOT** read the whole repo "to get familiar". Do not cat entire directories. Use targeted search (`rg 'findConfirmation' --type ts`) to locate things instead of reading files end-to-end.
- **Do NOT** re-read files you already have in context. Do not re-run builds/tests "to be sure" if nothing changed.
- Prefer many small edits with verification over speculative large rewrites — rewrites burn context and destroy other agents' mental anchors.
- When output is large (test runs, builds), run the narrowest command: `pnpm --filter @pyrmap/server test -- confirmation` rather than the whole suite while iterating; run the full suite once before committing.
- Keep files small: soft limit **300 lines per file**. If a file needs to grow past it, split by responsibility first. Small files = cheap to load for the next agent.
- Every port interface and domain function gets a 1–3 line doc comment stating contract + units (km, hours, UTC). These comments are the next agent's cheap context — write them for that reader.
- Never paste large data blobs (CSV bodies, JSON dumps) into code or docs. Reference fixture file paths.

## 6. Scope discipline

- Do ONLY the task you were given. No drive-by refactors, no "while I was here" cleanups, no dependency bumps, no formatting sweeps outside files you edited. If you spot a real problem outside scope, add one line to `docs/TODO.md` and move on.
- Never change **[FIXED]** decisions (schema, API shapes, dedup key, confirmation thresholds, marker styles, stack) — these are load-bearing for other agents and future data. If one must change, stop and report.
- Backwards compatibility of the SQLite schema: schema changes ONLY via a new migration appended to `migrations.ts`. Never edit an existing migration that has been committed.

## 7. Handoff protocol (end of every session)

1. Clean tree (`git status` empty), all tests passing, everything committed.
2. If mid-milestone, append to `docs/TODO.md`: what's done, what's next, any trap you found (max 5 lines — bullet facts, not prose).
3. If you made a durable choice, log it (§8).

## 8. Decision log

`docs/DECISIONS.md`, append-only, newest last. One entry = one line:
`YYYY-MM-DD | scope | decision | why (≤15 words)`
Log: dependency additions, FIRMS source/format surprises and fallbacks chosen, threshold tuning, anything a future agent would otherwise rediscover the hard way. Do NOT log routine implementation details.

## 9. Runtime & environment

- Node 22, pnpm via corepack. Never use npm/yarn commands in this repo.
- Secrets only via `.env` (gitignored). Never write the FIRMS key into code, fixtures, logs, or commits.
- `data/` directory (SQLite) is runtime state — never committed, never read as "documentation".
- Do not run the scheduler against the real FIRMS API during development iterations; use `pnpm --filter @pyrmap/server dev:mock` (implement this: starts server with fake FireDataSource serving fixtures) for frontend/dev work. Hit real FIRMS only for explicit end-to-end verification, max a handful of requests.
