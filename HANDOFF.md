# HANDOFF

**Written:** 2026-07-31, a `fix-bugs` iteration on
`feature/docker-e2e-backend-integration`, immediately following the
2026-07-31 #342 fix-bugs session.

## What happened this session

1. Picked up issue **#344** (`test-branch`, docker-required): a fresh
   `npm run compose:up` (`compose.yml`+`compose.dev.yml`) stack has zero
   users in Mongo, so `realLogin`/`realAuthLogin`
   (`tests/e2e/helpers/realAuth.ts`, `TEST_USER=admin`/
   `TEST_PASS=Admin@123`) always 401s — nothing on that compose path runs
   `api/backend/src/scripts/createFirstAdmin.js`.
2. Fixed by adding `npm run compose:seed-admin` (a `docker compose exec
   backend node src/scripts/createFirstAdmin.js` wrapper) plus
   `BOOTSTRAP_ADMIN_*` defaults (`admin`/`Admin@123`, matching
   `compose.test.yml`) in `.env.docker`/`.env.docker.example`, and
   documented the manual step in `README.md`. Deliberately did **not**
   wire an init step into `compose.yml`/`compose.dev.yml`'s `up` path —
   README's existing "Bootstrap and Seeds" section states bootstrap must
   stay manual and idempotent.
3. Verified live: `docker compose down --volumes` for a truly fresh
   stack, `npm run compose:up` (hit the same known one-off WSL
   `bioavanced_backend_node_modules` mkdir race noted in #342's handoff,
   resolved on retry, not a new issue), confirmed login 401s pre-fix,
   ran `compose:seed-admin`, confirmed login now returns 200, confirmed
   re-running `compose:seed-admin` is a no-op (idempotent guard already
   in `createFirstAdmin.js`). Tore the stack down afterward (no
   `--volumes` this time — left named volumes in place).
4. Branched `fix/compose-seed-admin` off the integration branch,
   committed (`91ca456c`, `Fixes #344`), pushed, merged `--no-ff` into
   `feature/docker-e2e-backend-integration` (merge commit `f2fd520d`),
   pushed, deleted the fix branch local+remote.
5. Closed #344 with the merge commit hash in the comment.
6. Wrap-up audit: no scope creep, no lazy fixes, no un-weakened tests
   needed (no test was pinned to this issue). No new follow-up issues
   filed.

## Repo state

- `feature/docker-e2e-backend-integration`: pushed to
  `origin/feature/docker-e2e-backend-integration` at `f2fd520d`, working
  tree clean, no local commits pending.
- `fix/compose-seed-admin`: merged and deleted, local+remote.
- Docker Desktop/WSL is running (used this session to verify #344 live).
  `docker ps -a` should be empty (stack torn down at session end via
  plain `docker compose down`, no `--volumes`) — the `bioavanced_*` named
  volumes (including Mongo, now seeded with the admin user from this
  session's live run) still exist. A future fresh-stack verification
  should `down --volumes` first if it needs a truly clean Mongo again.
- `test/e2e-real-backend-foundation` — still not deleted, still safe to
  delete (fully merged forward), Dennis hasn't confirmed.
- **#344 closed** this session. Standing inventory: #359 sign-off flag
  unchanged from prior handoffs.

## Recommended next steps

None queued explicitly by Dennis this session.

## Which skills to use

`work-issue` to route whichever open issue gets picked up next.
`ship-integration-branch` remains available if/when Dennis asks to
graduate `feature/docker-e2e-backend-integration` to `main`.
