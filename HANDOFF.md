# HANDOFF

**Written:** 2026-07-28, end of a `build-loop` session — first real
exercise of that skill (previously registered but untested). Delivered
Phase 0 of `E2E_IMPLEMENTATION_PLAN.md`: the real-backend Playwright
foundation (admin bootstrap, real login, audit assertion) that every
RF/RNF wave depends on.

**Branch:** `test/e2e-real-backend-foundation` (off
`feature/docker-e2e-backend-integration`), pushed and clean as of this
writing, two commits ahead of last session's handoff point
(`ab5cb575` the Phase 0 feature commit, `61e8c113` reconciling
`E2E_IMPLEMENTATION_PLAN.md` with what actually shipped).

## What happened this session

1. **Phase 0 landed and was verified against the real `compose.test.yml`
   stack**, not just built: `BOOTSTRAP_ADMIN_*` env vars +
   `admin-bootstrap-test` service, `playwright-runner` rebuilt from a
   dedicated `Dockerfile.playwright`, `tests/e2e/helpers/realAuth.ts`,
   `tests/e2e/helpers/assertAuditEvent.ts`, and
   `tests/e2e/auth-access-security.spec.ts` (real UI login + a
   wrong-password rejection case). Confirmed green against the live stack,
   and confirmed the audit assertion isn't a false-pass (temporarily
   required an impossible delta, watched it fail, reverted).
2. **Found and fixed two pre-existing infra bugs** while bringing the full
   stack up for the first time ever: CRLF line endings on
   `infra/tsa`/`infra/witness`'s `entrypoint.sh` (fixed via
   `.gitattributes` `*.sh text eol=lf`), and `frontend-app-test`'s `npm
   ci` intermittently omitting `@rollup/rollup-linux-x64-musl` under
   Docker Desktop for Windows even though CI doesn't hit it with the same
   lockfile+image (mitigated with a defensive fallback install in
   `frontend/Dockerfile.dev`; root cause not identified — tracked as
   issue #286).
3. **Two gaps the original plan didn't anticipate, both needed for the
   host-based verification workflow to work at all:** host port
   publishing (`3000:3000`/`5173:5173`) on `backend-app-test`/
   `frontend-app-test`, and `frontend-app-test`'s `VITE_API_BASE_URL`
   switched from the compose-internal hostname to `http://localhost:3000/api`
   (the browser loading the app is the host browser, via the published
   port — it can't resolve compose-internal service names).
4. **`E2E_IMPLEMENTATION_PLAN.md`'s Phase 0 section rewritten** to match
   what shipped rather than the original guess (4 bootstrap vars not 2,
   the `playwright-runner` Dockerfile deviation, the two host-reachability
   gaps above, pointers to the two infra bugs).
5. **Filed 3 issues**: `deniseribeiro-beep/BioAvanceD-v2#286` (the
   rollup/npm mystery, mitigated but not root-caused),
   `DyeAllPies/dyeallpies-skills-pack#134` (three docker-workflow lessons:
   don't auto-launch Docker Desktop, prefer a dedicated Dockerfile over a
   bind-mount for cross-platform builds, the rollup/npm elimination
   checklist), `DyeAllPies/dyeallpies-skills-pack#135` (Git Bash mangles
   `docker run -v/-w` paths — needs `MSYS_NO_PATHCONV=1`).
6. **Ran `clean-up`** at session end: removed the 7 session-tagged Docker
   images, ran `docker builder prune -af`, cleared 2 dangling images left
   over from iterative rebuilds (166.2MB), removed this session's
   `playwright-report/`/`test-results/`, and the one stray temp file this
   session left in the shared `/c/tmp` scratch area. Left `helion-v2`'s
   images/named volumes on the same Docker daemon untouched (not this
   session's, not this project's). WSL2 vhdx is 38GB physical vs ~27GB
   logical — an ~11GB gap, not the extreme case the hygiene note flags,
   so no reset run.

## Repo state

- Working tree clean, `test/e2e-real-backend-foundation` pushed and
  matching `origin/test/e2e-real-backend-foundation`.
- Docker stack torn down (`down --volumes`); no `bioavanced-test-*`
  containers/volumes/images remain.
- `test/migrate-rcs-governance-indexes-coverage` still carries the
  unmerged coverage work from issue #285 (untouched this session, not in
  scope).

## Recommended next steps

**None queued** — Dennis hasn't named a specific next task this session.
Phase 1 of `E2E_IMPLEMENTATION_PLAN.md` (the per-wave spec build, starting
with Wave 1: RF001, RF002, RF004, RF006, RF009, RF012, RF018, RF019,
RF023) is the obvious next milestone now that Phase 0 unblocks it, but
that's a plan-doc fact, not a session commitment — confirm with Dennis
before starting a wave.

## Which skills to use

`build-loop` is now proven against a real slice (Phase 0) — it held up
well: the "write the failing test first" framing loosened naturally into
"build the plumbing, then write the proving tests" for an infra-heavy
slice, which the skill's own text already allows for. `test/<slug>` as
the branch (no dedicated build-loop prefix) worked fine reusing the
milestone's existing long-lived branch rather than cutting a new one per
slice — matches the local-env overlay's guidance. `wrap-up` and
`clean-up` both ran this session; `clean-up`'s Docker domain in
particular earned its keep (7 tagged images + dangling layers + a build
cache that would otherwise have sat there).

## Dependency notes

Phase 0 no longer blocks anything — Phase 1 waves can start. RF022/RF028
still need their own focused design pass when their waves start
(intentionally not pre-designed). `dyeallpies-skills-pack#122`–`#129`,
`#134`, `#135` are pack-repo items, not BioAvanceD-v2 blockers.

## Session note

One direct user correction: an attempt to launch Docker Desktop directly
via Bash (to unblock a "Docker isn't running" check) was rejected — the
user started it manually instead and said to continue. Filed as part of
`dyeallpies-skills-pack#134`: don't launch Docker Desktop (or equivalent
GUI apps) directly, ask/wait instead.
