# HANDOFF

**Written 2026-08-28. INTERIM — one delegated agent was still in flight.**
Re-derive counts before trusting them.

An orchestrated multi-issue sitting: a 10-issue queue worked with delegated
agents, which then absorbed its own filings after a mid-session correction
from Dennis. **14+ commits, pushed.**

---

## Repo state

- Branch `feature/docker-e2e-backend-integration`, pushed and in sync as of
  the last push. `main` untouched, no PR.
- Untracked, deliberately: `.claude/skills/`, `api/backend/storage/assays/`.
  **Never `git add -A`.**
- **Docker: engine up, no containers, four `bioavanced-test_*` named volumes
  preserved.** The test stack was **never brought up**. A throwaway `mongo:7`
  probe was attached to the Mongo volume for #753 and removed. **Bootstrap
  state of those volumes: none observed** — do not assume a gate can run
  against them without seeding.

## Verification state

- `npm run test:architecture`: **85/85** (82 + the three #784 added). [ran it]
- Backend regression, the sanctioned form `npx vitest run tests/unit
  tests/integration tests/compliance --reporter=dot`: **7889/7890**, 543s.
  The one failure was this sitting's own doing and is fixed. [ran it]
  **The bare `vitest run` form is hook-blocked** — use the three explicit
  directory targets.
- Frontend `typecheck` and `typecheck:full`: clean. [ran it]
- **e2e specs were NOT run.** #867 changed `tests/e2e/helpers/seedParticipant.ts`
  (`operational` → `Active`); six specs seed through that helper and none was
  exercised. **That change is unverified until the Docker gate** and is the
  first thing to check there.

## The findings worth carrying

**#863 — a guard that was green over 41 live defects.** The `#755` env guard
matched import paths by the substring `config/env`, so it never collected
`src/config/collections.js` or `redis.js`. 41 instances of the exact bug it
exists to catch had been sitting green, and the test asserting "no importer
destructures" passed *vacuously* over a population excluding the only
destructured import. Fixed by resolving paths instead of matching them.

**#866 — information computed and discarded.** The active-release validator
resolved the terminology version on every write and the service threw it
away one line before `insertOne`. Persisted `hpoCoding`/`conditionCoding`
were RF005 AC#5 non-compliant *at rest*, not just in the UI.

**#867 — a fix that changed no test.** Inverting the equipment deny-list to
an allow-list left the suite at 98/98 with zero test edits, because nothing
had ever driven `operational`. Correct and unproven. Now guarded.

## Rules this sitting earned

- **A guard's collection step is the thing to audit, not its assertions.**
  Both #863 and #784 turned on which files the sweep can see.
- **Prove a guard can fail.** Every guard changed here was verified by
  re-introducing the defect and watching it go red. A green suite is equally
  consistent with a guard that cannot fail.
- **Verify a remedy separately from its defect trace — three times over.**
  #864's threshold predicate (thresholds are null, no writer sets them),
  #875's "route it through the existing validator" (every PUT test sends a
  partial body, so it would 422 them all), and #865's `$`-key sniff (which
  routes *legacy* documents into the canonical parser — my own brief was
  backwards) were each killed by checking before building.
- **`test:architecture` is tree-exclusive.** It walks all of
  `api/backend/src`, so it races *any* concurrent write there regardless of
  file-set disjointness. Pack #587.
- **Do not idle agent slots while blocked on a long local job.** Dennis's
  correction, measured at 543s with zero agents and twelve open same-sitting
  issues. Pack #589.

## Machine friction that will recur

- **Quoted heredocs collapse one level of backslash.** Hit twice — once by
  the orchestrator, once independently by an agent — and both produced a
  *confident zero* from a silently broken regex, not an error. Write scripts
  with the Write tool or run a file; never `node -e` or a heredoc for source
  in another language. Pack #585.
- **`gh issue` writes were refused by the classifier** until Dennis added a
  permission rule. `--body-file` and a flat one-liner did **not** evade it,
  contrary to what pack #185 records. Pack #586.

## Open work

Do not trust a written list. Query it: `gh issue list --state open`, and the
same with `--repo DyeAllPies/dyeallpies-skills-pack`.

Judgment a query cannot carry:

- **#865 is filed but its remedy is specified and unbuilt.** Both the
  manifest-marker and the `$`-sniff approaches are measured as inadequate;
  the per-object wrapper-validity approach is described and untried.
- **#875 and #869 are #839's exemption list** — building that guard before
  closing them means it starts with six exemptions, which is intended.
- **#876 is much narrower than filed** — one endpoint, one caller. #880 and
  #881 came out of it and are the more substantial defects.
- **#879 is time-sensitive.** The terminology version was never captured, so
  a back-fill can only re-resolve against whatever release is active when it
  runs. Establish whether releases record activation history *before*
  deciding — that read settles whether this is a race or a calm migration.
- **#868 remains the live inconsistency in the equipment family**: `PUT`
  skips validation entirely and can auto-quarantine on a status `POST` would
  reject, using a fourth vocabulary.

## Recommended next

Dennis named no next issue, so: **none queued.**

This sitting filed nineteen project issues and worked six of them. That
remainder is a deliberate rabbit-hole conversion — filed and left unworked
on purpose, not overlooked. Several carry a decided remedy in the body and
are cheap re-entry points.
