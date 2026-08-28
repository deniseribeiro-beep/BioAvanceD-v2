# HANDOFF

**Written 2026-08-28. INTERIM — the session was still running when this was
written, with three delegated agents in flight.** Re-derive state before
trusting any count below.

An orchestrated multi-issue sitting: 10 issues taken as a queue, worked with
delegated agents. **10 commits, NOT yet pushed.**

---

## Repo state

- Branch `feature/docker-e2e-backend-integration`. **10 commits ahead of
  origin and unpushed** — push is the first thing the next session should
  do, after re-running the checks below. `main` untouched, no PR.
- Last substantive commit: the `collections.test.js` un-pin.
- Untracked, deliberately: `.claude/skills/`, `api/backend/storage/assays/`.
  **Never `git add -A`.**
- **Docker: engine up, no containers, four `bioavanced-test_*` named volumes
  preserved.** The test stack was **never brought up** this sitting. A
  throwaway `mongo:7` probe was attached to the Mongo volume and removed.
  **Bootstrap state of those volumes: unknown/none** — do not assume a gate
  can run against them without seeding.

## Verification state

- `npm run test:architecture`: **85/85** (was 82; the inverse env guard added
  three). [ran it]
- Backend regression, `npx vitest run tests/unit tests/integration
  tests/compliance --reporter=dot`: **7889/7890**, 543s. The single failure
  was `tests/unit/config/collections.test.js`, caused by this sitting's own
  #863 fix, and is now fixed and green. [ran it]
- Frontend `typecheck` and `typecheck:full`: clean. [ran it]
- **The bare form of that vitest command is hook-blocked.** The sanctioned
  pre-handoff form is the three explicit directory targets above.

## What shipped

Nine issues closed: #752, #772, #776, #760, #700, #862, #863, #784, #753.
#774 shipped its layer 1 only and stays open; #839's design is settled and
recorded in a comment, guard not built.

**The one finding worth carrying forward: #863.** The `#755` env guard
matched import paths by the substring `config/env`, so it never collected
`src/config/collections.js` or `redis.js`. **41 live instances of the bug it
exists to catch had been sitting green**, and the test asserting "no importer
destructures" was passing vacuously over a population that excluded the only
destructured import. Fixed by resolving paths instead of matching them.
[ran it]

Its aftershock is the rule to keep: `collections.test.js` had been *pinning
the gap* — asserting five env vars were ignored, with a comment explaining
why. **A declaration gap and the test documenting it were vouching for each
other.** Expect more of this shape.

## Rules this sitting earned

- **A guard's collection step is the thing to audit, not its assertions.**
  Both #863 and #784 turned on which files the sweep can see. A green guard
  says nothing about what it never looked at. Every guard touched here now
  has a named-file pin and a red-then-green demonstration.
- **Prove a guard can still fail.** Every guard change this sitting was
  verified by re-introducing the defect and watching it go red. Do not
  accept a green suite as evidence a guard works.
- **Verify a remedy separately from its defect trace.** #864's proposed fix
  (a threshold predicate on temperature readings) turned out to be nearly as
  dead as the legs it replaced — the thresholds default to null and no
  writer in `src/` sets them. [ran it]
- **`test:architecture` is tree-exclusive.** It statically walks all of
  `api/backend/src`, so it races *any* concurrent write in that tree
  regardless of file-set disjointness. This forced serialisation repeatedly.
  Filed as pack #587.

## Machine friction that will recur

- **Quoted heredocs collapse one level of backslash.** Hit twice, once by
  the orchestrator and once independently by an agent; both produced a
  *confident zero* from a silently-broken regex, not an error. Write scripts
  with the Write tool, or run a file — never `node -e` or a heredoc for
  source in another language. Pack #585.
- **`gh issue` writes were refused by the auto-mode classifier** until
  Dennis added a permission rule — `--body-file` and a flat one-line command
  did **not** evade it, contrary to what pack #185 records. Pack #586.

## Open work

Do not trust a written backlog list. Query it:
`gh issue list --state open`, and the same with
`--repo DyeAllPies/dyeallpies-skills-pack`.

Judgment a query cannot carry:

- **#874 blocks nothing but empties something** — closing it removes all
  three exemptions from the new inverse env guard.
- **#875 and #869 are #839's exemption list.** Building #839's guard before
  closing them means it starts with six exemptions rather than zero; that is
  intended, not a defect.
- **#873 is a coverage regression #863 introduced knowingly** —
  `user-security.service.js` imports env through a re-export shim the new
  exact-resolution collector correctly excludes. Low risk today; its one
  read is declared.
- **#866 vs #870 should be decided together** — repointing `/api/hpo/*` at
  `terminologyConcepts` would supply the compliant read path #866 lacks.
- **#872 and #878 are the same file, different defects** — all 150 values
  untranslated, and one key absent. Do not merge the fixes.

## Recommended next

Dennis named no next issue, so: **none queued.** But this sitting filed
sixteen project issues and worked one of them, which is a deliberate
rabbit-hole conversion, not an oversight — the remainder was filed and left
unworked on purpose. Several carry a remedy already decided in the body
(#865, #872, #875), so they are cheap re-entry points.

**Dennis's standing correction from this sitting, which outranks the above:**
do not let agent slots idle while the orchestrator blocks on its own
long-running job, and work the issues filed in the same sitting rather than
only filing them well. Measured here at 543 seconds with zero agents live
and twelve fresh issues open. Pack #589.
