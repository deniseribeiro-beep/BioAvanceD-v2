# HANDOFF

**Written:** 2026-08-05, after closing #425 (backfill script verification)
on `feature/docker-e2e-backend-integration`.

## What happened this session

Dennis picked #425 explicitly ("Pick #425") — an operational issue, not
coding: verify `api/backend/src/scripts/backfillUserRoleAssignments.js`
against a stack with pre-existing users (only ever verified against a
fresh `compose.test.yml` stack before).

Docker Desktop wasn't running at session start; asked Dennis to start it
rather than launching it myself (per `docker-workflow`'s standing rule).
Once up, brought up the dev stack (`compose.yml`+`compose.dev.yml`,
`.env.docker`) — it started fresh with 0 users, so running the backfill
against it as-is would have proven nothing. Asked Dennis how to handle
that; he chose "simulate": seeded 3 users directly into Mongo (bypassing
the app's registration/bootstrap paths) with legacy `accessType` values
(1, 2, 4) and no `UserRoleAssignment`, seeded the RBAC catalog (a fresh
stack has none — see below), then ran the backfill script.

**Result:** `UserRoleAssignment backfill: 3 assignment(s) ensured`,
correctly mapped (accessType 1→external_user, 2→technician,
4→administrator). Ran a second time to confirm idempotency — count
stayed at 3, not 6. Deleted the 3 simulated users + their assignments
afterward, leaving the dev stack's data otherwise as it was (still 0 real
users — nobody has run `compose:seed-admin` successfully on this stack
instance yet).

**Closed #425** with a comment describing the verification steps and
result (https://github.com/deniseribeiro-beep/BioAvanceD-v2/issues/425#issuecomment-5193181275).

**Filed #437** (new, found during this verification): the backfill script
has an undocumented prerequisite — it throws `Role não encontrado ...
catálogo RBAC não semeado?` unless the RBAC catalog (`roles`/
`permissions` collections) is already seeded, but the only paths that
seed it are `createFirstAdmin.js` (which **aborts early** if any user
already exists — exactly the #425 scenario) and the standalone
`src/scripts/seedRbacCatalog.js`, which nothing in the repo's docs
references. An operator following #425's own runbook on a real shared
stack with pre-existing users and no admin ever bootstrapped there yet
will hit this. Suggested fix in the issue: either have the backfill
script self-seed the catalog (mirroring `createFirstAdmin.js`), or
document the required run order.

No code was changed this session — purely operational verification plus
one issue filed from what was learned running it.

## Repo state

- **`feature/docker-e2e-backend-integration`**: unchanged, no commits this
  session (nothing to commit — pure verification work, no code touched).
- Issues: **#425 closed** (verified, see above). **#437 opened** (new,
  backfill's undocumented catalog-seed prerequisite).
- Backlog otherwise unchanged from prior handoff: **#387**,
  `#371`/`#373`/`#374`/`#378`/`#379`, **#389**.
- **dyeallpies-skills-pack#210** (RBAC blast-radius overlay note) —
  still open, not yet applied.
- The prior handoff's `user.accessType` grep sweep (confirming the
  #427/#428/#431/#433/#434 stale-`accessType` family is fully closed
  out) still hasn't been done — carried forward three handoffs now.

## Dev stack state (as of session end)

The dev stack (`compose.yml`+`compose.dev.yml`) is **up** as of this
session's work (backend/frontend/mongodb/neo4j/redis/influxdb/tsa/
witness/worker/neo4j-projection-worker all running) with **0 users** and
the **RBAC catalog now seeded** (roles + permissions collections
populated by this session's verification work — previously unseeded on
this stack instance). Whether to tear it down or leave it running for a
next session is an open call — not decided this session.

## Blocking next step

None from #425 (closed). #437 is a real but non-blocking gap — nothing
currently depends on running the backfill against a stack that both has
pre-existing users *and* an unseeded RBAC catalog before #437 is fixed;
just don't repeat that combination without seeding the catalog first
(`seedRbacCatalog.js`) until #437 lands a permanent fix.

## Recommended next steps

Dennis picked #425 explicitly this session but didn't name a next pick
after it, so per this skill's own rule: **none queued** as an explicit
instruction. Backlog candidates:
- **#437** (this session's find — cheap, well-scoped fix)
- **#387**, older backlog (`#371`/`#373`/`#374`/`#378`/`#379`), or
  **#389** (route through `divide-and-conquer` first, 28 files)
- The carried-forward `user.accessType` grep sweep (three handoffs now)

## Which skills to use

- Unchanged from prior handoffs for #387/older backlog/#389.
- `docker-workflow`'s local-env overlay (`local-env/bioavanced-v2.md`)
  covers the dev-stack setup/seed-admin/RBAC-catalog gotchas this session
  ran into directly — worth a quick read before the next Docker-touching
  session, since it already documents "a freshly-started `compose:up`
  stack has zero users."
