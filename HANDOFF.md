# HANDOFF

**Written:** 2026-07-30, a `build-loop` session that closed issue #322
(Wave 2 RF003) with Docker on.

## What happened this session

1. Read the prior HANDOFF.md, which queued issue #322 (RF003 - Gestão
   de usuários) as the next Wave 2 real-backend spec.
2. Branched `test/322-rf003-user-management` off `test/e2e-real-backend-
   foundation` and added a "User management (RF003)" describe block to
   `tests/e2e/auth-access-security.spec.ts`: AC#1 happy path (admin
   creates a user, audited) + AC#1 rejection (duplicate email/username,
   400) + an RNF008 cross-cutting RBAC session-gate check, following the
   same tempToken pattern RF002's existing test already used.
3. **Found and fixed a real infra bug while bringing Docker up (#332,
   closed):** `compose.dev.yml`'s `env_file:` entries and the
   `compose:*` npm scripts' `--env-file` flag both pointed at the blank
   `.env.docker.example` template instead of the real `.env.docker`
   README.md tells devs to create — so `npm run compose:up` couldn't
   boot from a clean checkout (neo4j/influxdb healthcheck failures,
   backend crash on missing `CONSENT_SECRET`). Fixed in two commits,
   merged alongside #322's work.
4. Discovered the local dev stack (`compose.yml`/`compose.dev.yml`,
   `npm run compose:up`) isn't actually what `test:e2e:docker` needs —
   the backend service there has no healthcheck at all, so `frontend`'s
   `depends_on: condition: service_healthy` can never resolve. The
   correct stack for the real-backend e2e gate is `compose.test.yml`
   (the same one CI's `current-state-validation` job builds), which
   needs its own `admin-bootstrap-test` one-shot job run once
   (`docker compose ... run --rm --no-deps admin-bootstrap-test`)
   before any login-based test can pass — this isn't documented
   anywhere in the skills pack yet; worth a `docker-workflow`
   local-env update if it trips up a future session again.
5. Ran the new + existing `auth-access-security.spec.ts` tests against
   the real `compose.test.yml` stack — all 5 passed.
6. Merged `test/322-rf003-user-management` into both
   `test/e2e-real-backend-foundation` and
   `feature/docker-e2e-backend-integration`, pushed both.
7. Closed #322 (partial — AC#2/AC#3/AC#4/AC#5 not covered) and #332.
   Filed #333 tracking the remaining RF003 criteria (blocks partly on
   #293's already-open "no test-side TOTP generator" gap).
8. Updated `E2E_TRACEABILITY_PLAN.md`'s RF003 row to PARTIAL, linking
   #333 for what's left.

## Repo state

- `test/e2e-real-backend-foundation` and
  `feature/docker-e2e-backend-integration` both at `ab8f3115`/
  `3a39ed43` respectively (same content, different merge-commit hash),
  pushed.
- `main` still not touched, still frozen — do not merge into it without
  Dennis's explicit go.
- Docker test stack (`compose.test.yml`) was torn down
  (`down --volumes --remove-orphans`) after the run — nothing left
  running.

## Recommended next steps

None queued — Dennis hasn't named a specific next issue. Open Wave 2
issues still on the board: #323 (RF007), #324 (RF011), #325 (RF020),
#326 (RF021), plus the new #333 (RF003 remainder) and #293 (TOTP
generator, a shared blocker for any RBAC test needing a real non-admin
session). Tracking issue #331 covers integrating all Wave 2 specs onto
`feature/docker-e2e-backend-integration` once they land — most of that
integration already happened incrementally this session and the RF002
session before it, but #331 itself is still open pending the rest of
the wave.

## Which skills to use

`build-loop` for any of #323/#324/#325/#326/#333. Whichever one is
picked, budget time for the `compose.test.yml` + `admin-bootstrap-test`
bootstrap sequence above — don't reach for `npm run compose:up` (the
dev stack) expecting it to serve `test:e2e:docker`, it can't as
currently configured. `ship-integration-branch` only once Wave 2 is
fully landed and Dennis explicitly asks to graduate to `main`.
