# HANDOFF

**Written:** 2026-07-31, a `fix-bugs` iteration on
`feature/docker-e2e-backend-integration`, immediately following the
2026-07-30 read-only #354 follow-up session.

## What happened this session

1. Picked up issue **#350** (`bug`, `test-branch`, `playwright`):
   `auth-access-security.spec.ts` 429s partway through a full-file run
   because `authLimiter` (`api/backend/app.js`) capped `/api/auth` at a
   flat 10 req/min regardless of environment, and the real Docker dev
   stack runs with `NODE_ENV=development` (confirmed via `.env.docker`),
   which is not exempted the way `NODE_ENV=test` is.
2. Reproduced with a new regression test
   (`api/backend/tests/integration/auth-rate-limiter.test.js`) that loads
   `app.js` fresh per `NODE_ENV` and confirms 429s appear well before 15
   requests in development, but not in production.
3. Fixed by scaling `authLimiter.max` via the existing `isDev` flag
   (`isDev ? 100 : 10`) — production keeps the original strict budget.
4. Branched `fix/auth-rate-limiter-dev-budget` off the integration
   branch, committed (`997d19df`, `Fixes #350`), pushed, merged
   `--no-ff` into `feature/docker-e2e-backend-integration`
   (merge commit `dfd8a16f`), pushed, deleted the fix branch
   local+remote.
5. Closed #350 with the merge commit hash in the comment.
6. Wrap-up audit surfaced two follow-ups, both filed (not just
   mentioned here):
   - **skills-pack#152**: the repo has two look-alike `config/env.js`
     files (`api/backend/config/env.js` and the one `app.js` actually
     uses, `api/backend/src/config/env.js`) — a trap for any test that
     needs to reload `app.js` with a different `NODE_ENV`.
   - **BioAvanceD-v2#359**: flagging the `authLimiter` relaxation for
     Denise's explicit sign-off — the 100/min ceiling applies to *any*
     non-production `NODE_ENV`, not just the Docker dev stack, since it
     piggybacks on the existing `isDev` flag rather than a dedicated
     e2e-only flag.

## Repo state

- `feature/docker-e2e-backend-integration`: pushed to
  `origin/feature/docker-e2e-backend-integration` at `dfd8a16f`, working
  tree clean, no local commits pending.
- `fix/auth-rate-limiter-dev-budget`: merged and deleted, local+remote.
- Docker dev stack / WSL: still down, unchanged from last session — not
  touched this session (fix verified with native vitest only, no Docker
  needed per `fix-bugs`' default execution contract).
- `test/e2e-real-backend-foundation` — still not deleted, still safe to
  delete (fully merged forward), Dennis hasn't confirmed.
- Open issues of note beyond the standing inventory (unchanged
  otherwise — see prior handoff for the full list): **#359** (new, this
  session's sign-off flag), **#152** on the skills-pack repo (new, this
  session's testing-conventions gotcha).
- **#350 closed** this session.

## Recommended next steps

None queued explicitly by Dennis this session.

## Which skills to use

`work-issue` to route whichever open issue gets picked up next.
`ship-integration-branch` remains available if/when Dennis asks to
graduate `feature/docker-e2e-backend-integration` to `main`.
