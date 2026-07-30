# HANDOFF

**Written:** 2026-07-30, a `test-loop` (routed via `e2e-test-loop`) session
on `test/e2e-real-backend-foundation`, Docker on (user-confirmed
mid-session).

## What happened this session

1. Read the prior HANDOFF.md (the #333 AC#2 session's). Dennis asked to
   read the handoff and pick an issue myself — no specific issue named.
2. Picked up #333's remaining scope (AC#3/AC#4/AC#5), the top recommended
   candidate from the prior handoff, now fully unblocked (#293's TOTP
   generator dependency resolved).
3. Before writing anything, checked what the API actually supports (per
   the prior session's explicit warning):
   - `user.routes.js`'s `DELETE /:id` is a hard `deleteOne` — **not** a
     soft delete, so it cannot be the mechanism AC#4 ("inactivate without
     deleting history") is proven with. `PUT /:id` with `status:
     'inactive'` is the real inactivation path and preserves the record.
   - `User.js`'s `validate`/`create` have **no** vigência (validity
     period) or institutional-scope field at all — AC#3 as worded isn't
     satisfiable by the current API. Filed as a product gap, **#337**;
     not a test gap, so left out of this iteration (test-loop never
     builds product code). #333 stays open for it.
   - Session revoke (`DELETE /api/user/security/sessions/:id`, self-
     service) and admin-only `POST /api/users/:id/reset-mfa` both exist
     and are real, testable AC#5 mechanisms; confirmed `authenticate`
     really re-checks the session doc (not just the JWT signature) so a
     revoke has a provable effect.
4. Added two tests to `auth-access-security.spec.ts`'s "User management
   (RF003)" block:
   - AC#4: admin inactivates a Técnico via `PUT /:id`, audited; the
     record and its username persist; a fresh login attempt afterward is
     refused.
   - AC#5: a Técnico revokes its own active session (fetched via `GET
     /security/sessions`), then confirms the same token is genuinely
     401'd afterward; separately, a second (non-admin) session is
     refused (403) attempting `reset-mfa` on itself, then an admin's
     `reset-mfa` call succeeds and actually clears `mfaEnabled`.
5. Found and filed **#338** while building the AC#5 test: two logins for
   the same user within the same wall-clock second return a **byte-
   identical JWT** (no `jti`, second-granularity `iat`), so session
   storage keyed on the token hash conflates the two sessions — a second,
   independent login can come back pre-revoked if it collides with an
   unrelated revoke issued in the same second. Worked around it in the
   test with a short delay (documented inline, points at #338) rather
   than weakening any assertion — this is incidental to what AC#5
   proves, not the thing under test.
6. Docker gate (session-authorized mid-session via explicit confirmation,
   not assumed): brought up `compose.test.yml`'s stack, stopped the
   auto-started `playwright-runner`, ran `auth-access-security.spec.ts`
   alone — 8/8 passing (all 6 pre-existing + both new) — then tore the
   stack down (`down --volumes --remove-orphans`).
7. Updated `E2E_TRACEABILITY_PLAN.md`'s RF003 row (AC#4/AC#5 now covered;
   AC#3 reframed as a product gap tracked in #337, not a test gap).
8. Committed (`cb7be9ca`) and pushed `test/e2e-real-backend-foundation`.
   No PR opened (Dennis's call, unchanged); not merged forward into
   `feature/docker-e2e-backend-integration`.
9. wrap-up audit: no scope violations. One self-inflicted friction point
   — read `docker-workflow`'s explicit "never background a compose
   build with a shell `&`, use the harness's `run_in_background`" rule,
   then violated it anyway moments later (had to redo it correctly);
   likely started the build twice concurrently, harmless here since
   `up -d --build` is idempotent and the stack came up healthy, but
   worth naming since it's exactly the failure mode that skill warns
   about. No skill text needed fixing — the rule was already right.

## Repo state

- `test/e2e-real-backend-foundation` at `cb7be9ca`, pushed.
- `feature/docker-e2e-backend-integration` still has its own divergent
  slices (per the prior handoff) not yet reconciled with this branch —
  still worth a deliberate merge/integration pass sometime soon; nobody
  has done it yet.
- `main` still not touched, still frozen.
- Docker test stack torn down after the run — nothing left running;
  confirmed via `docker compose ps` before tear-down and the tear-down's
  own output.
- **#333 stays open** — only AC#3 remains, and it's a product gap (no
  vigência/scope field exists), not a test gap. It's blocked on a
  `build-loop` pass (or Dennis's call on rewording the criterion) before
  any e2e spec could prove it.
- **#337** (new): AC#3's missing vigência/institutional-scope fields —
  product gap, not yet built.
- **#338** (new): same-second logins produce byte-identical JWTs; session
  storage conflates them. Security-adjacent (session identity/
  revocation), not yet fixed.

## Recommended next steps

None queued — Dennis hasn't named a specific next issue. Candidates,
unranked since nothing was said: #337/#338 (both filed this session,
either could be a `build-loop`/`fix-bugs` pick once Dennis triages them);
reconciling the two-branch divergence noted above; #325/#326 (RF020/
RF021) still blocked on #320's CRUD gap; #334 (RF007 remainder) is
divide-and-conquer-shaped, lower priority. Tracking issue #331 covers
integrating all Wave 2 specs onto `feature/docker-e2e-backend-
integration` once they land.

## Which skills to use

`fix-bugs` or `build-loop` for #337/#338 depending on Dennis's call on
each (a missing field/enforcement vs. a security-relevant fix to session
identity). `test-loop`/`e2e-test-loop` if #333 gets reworded rather than
built out. `build-loop` for #325/#326 once #320's CRUD gap is resolved.
`ship-integration-branch` only once Wave 2 is fully landed and Dennis
explicitly asks to graduate to `main`.
