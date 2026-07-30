# HANDOFF

**Written:** 2026-07-30, a `fix-bugs` session on
`feature/docker-e2e-backend-integration`, Docker on (user-confirmed at
session start, though this fix didn't end up needing it — native tests
were sufficient to prove it).

## What happened this session

1. Read the prior HANDOFF.md (the #337 build-loop session's, which closed
   #337/#333 — RF003 fully covered). Dennis asked to pick up #338.
2. #338 (session tokens issued within the same second were
   byte-identical, so revoking one session revoked both): root cause was
   `auth.service.js`'s `issueAccessToken`/`issueRefreshToken` JWT
   payloads having no per-login nonce, combined with `iat`/`exp` being
   second-granularity — two logins for the same user in the same
   wall-clock second signed identical tokens, which collided in
   `session.service.js`'s `hashToken`-keyed session storage.
3. Reproduced first: added failing unit tests to
   `auth.service.unit.test.js` asserting two same-user token issuances
   are distinct and each carries a unique `jti` — confirmed they failed
   against the unfixed code.
4. Fixed: added a random UUID `jti` claim to both the access and refresh
   token payloads in `auth.service.js` (using `crypto.randomUUID()`).
   This is the exact direction the issue itself suggested. No session
   storage changes needed — the hash now differs because the payload
   does.
5. Verified: targeted run (`auth.service.unit.test.js`,
   `session.service.unit.test.js`, `auth.routes.branch-coverage.test.js`,
   `auth.routes.contract.test.js`, `auth-session-revocation.test.js`,
   `auth.api.test.js`) — 97 tests green on the merged tree (140 including
   the fix-branch-only run before merge).
6. Committed (`16d4167b`) on `fix/338-jwt-jti-collision` (branched off
   `feature/docker-e2e-backend-integration`), pushed, commented the hash
   on #338.
7. Merged `fix/338-jwt-jti-collision` into
   `feature/docker-e2e-backend-integration` (`9250feb3`), re-ran targeted
   tests on the merged tree, pushed. Deleted the fix branch (local +
   remote).
8. Closed **#338**, referencing the merge commit.
9. wrap-up audit: no scope violations (only `auth.service.js` + its test
   touched), no lazy fixes, no stale instructions, no permission denials,
   no judgment calls needed — the fix matched the issue's own suggested
   direction and fully resolved it (no residual gap, no new issue filed).

## Repo state

- `feature/docker-e2e-backend-integration` at `9250feb3`, pushed. Carries
  the #338 fix plus everything from the prior #324 session.
- `test/e2e-real-backend-foundation` (from the prior two sessions, at
  `7a1de69f`) still not reconciled with this branch — the two-branch
  divergence noted in prior HANDOFFs is still open; nobody's done the
  merge pass yet.
- `main` still not touched, still frozen.
- **#338 is closed.**
- **#339** (from the #337 session, still open): `institutionalScope` is
  stored/validated/returned but has no enforcement anywhere — needs
  Dennis's product call on which resources/roles it should constrain
  before a build-loop slice could implement it.
- **#336** (from the #324 session, still open): legacy synchronous
  `POST /api/import/fhir` looks superseded by the FHIR staging pipeline,
  needs Dennis/Denise reconciliation, non-blocking.

## Recommended next steps

None queued — Dennis hasn't named a specific next issue. Candidates,
unranked: #339 (institutional-scope enforcement, needs Dennis's product
call first, then `build-loop`-shaped, or `resolve-issue` first to get
that call); reconciling the `test/e2e-real-backend-foundation` /
`feature/docker-e2e-backend-integration` divergence; #325/#326
(RF020/RF021) still blocked on #320's CRUD gap; #334 (RF007 remainder,
divide-and-conquer-shaped); #336 (legacy FHIR endpoint reconciliation).
Tracking issue #331 covers integrating all Wave 2 specs onto
`feature/docker-e2e-backend-integration` once they land.

## Which skills to use

`build-loop` for #339 once Dennis has triaged which resources/roles
institutional scope should constrain (or `resolve-issue` first, to get
that call from him). `build-loop` for #325/#326 once #320's CRUD gap is
resolved. `ship-integration-branch` only once Wave 2 is fully landed and
Dennis explicitly asks to graduate to `main`.
