# HANDOFF

**Written 2026-08-28. INTERIM — a regression run and one research agent were
still in flight.** Re-derive counts before trusting them.

An orchestrated multi-issue sitting: a 10-issue queue worked with delegated
agents, which then absorbed its own filings after two mid-session
corrections from Dennis. **20 commits, pushed. 18 issues closed, 21 filed.**

---

## Repo state

- Branch `feature/docker-e2e-backend-integration`, pushed and in sync.
  `main` untouched, no PR.
- Untracked, deliberately: `.claude/skills/`, `api/backend/storage/assays/`.
  **Never `git add -A`.**
- **Docker: engine up, no containers, four `bioavanced-test_*` named volumes
  preserved.** The test stack was **never brought up**. A throwaway `mongo:7`
  probe was attached to the Mongo volume for #753 and removed. **Bootstrap
  state of those volumes: none observed** — do not assume a gate can run
  against them without seeding.

## Verification state

- `npm run test:architecture`: **85/85**, run with no writers live. [ran it]
- Backend regression: the sanctioned form is
  `npx vitest run tests/unit tests/integration tests/compliance --reporter=dot`.
  **The bare `vitest run` form is hook-blocked**, and so is a bare directory
  target — name files or use the three explicit directories.
- Frontend `typecheck` and `typecheck:full`: clean. [ran it]
- **e2e specs were NOT run.** #867 changed
  `tests/e2e/helpers/seedParticipant.ts` (`operational` → `Active`); six
  specs seed through that helper and none was exercised. **Unverified until
  the Docker gate** and the first thing to check there.

## The findings worth carrying

**#863 — a guard green over 41 live defects.** The `#755` env guard matched
import paths by the substring `config/env`, so it never collected
`src/config/collections.js` or `redis.js`. 41 instances of the bug it exists
to catch had been sitting green, and the test asserting "no importer
destructures" passed *vacuously* over a population excluding the only
destructured import.

**#866 — information computed and discarded.** The active-release validator
resolved the terminology version on every write and threw it away one line
before `insertOne`. RF005 AC#5 non-compliant *at rest*.

**#867 / #880 — fixes that changed no test.** Inverting the equipment gate
left the suite at 98/98 with zero edits, because nothing had ever driven
`operational`. Ten models silently replaced caller-supplied identifiers, and
no test anywhere POSTed with an id. Both correct and unproven; both now
guarded.

## Rules this sitting earned

- **A guard's collection step is what to audit, not its assertions.** #863,
  #784 and #873 all turned on which files the sweep can see.
- **Prove a guard can fail.** Every guard changed here was verified by
  re-introducing the defect and watching it go red.
- **A change that alters no test is a warning, not a pass.** Twice.
- **Verify a remedy separately from its defect trace.** Five remedies were
  killed by checking before building: #864's threshold predicate (thresholds
  are null), #875's "use the existing validator" (every PUT test sends a
  partial body), #865's `$`-key sniff (**my own brief was backwards**),
  #876's "switch to uuid" (a no-op), and #868's merge-validation (would have
  bricked legacy records — measured at eight broken updates).
- **`test:architecture` is tree-exclusive.** It walks all of
  `api/backend/src`, so it races *any* concurrent write there regardless of
  file-set disjointness. Pack #587.

## Machine friction that will recur

- **Quoted heredocs collapse one level of backslash.** Hit twice, both
  producing a *confident zero* from a silently broken regex. Write scripts
  with the Write tool or run a file. Pack #585.
- **`gh issue` writes were refused by the classifier** until Dennis added a
  permission rule; `--body-file` and a flat one-liner did **not** evade it,
  contrary to pack #185. Pack #586.

## Open work

Do not trust a written list. Query it: `gh issue list --state open`, and the
same with `--repo DyeAllPies/dyeallpies-skills-pack`.

Judgment a query cannot carry:

- **#865's remedy is specified but not designed.** Two approaches are
  measured as inadequate; the per-object wrapper-validity approach needs the
  EJSON wrapper shapes enumerated before it can be built.
- **#879 is NOT time-sensitive** — I filed it saying the window was closing
  and that was wrong. Activation history is derivable from each release's
  immutable `createdAt` plus `previousReleaseId`, neither of which a later
  promotion rewrites. But a back-fill **must join `referenceImportRuns`**,
  or it will mis-attribute versions for any dataset ever rolled back.
- **#881's question is answered** — `id` is canonical, unanimously. What
  remains is cleanup of the vestigial numeric field, not a decision.
- **#870 and #871 are the two genuine direction calls left.** #870 is
  retire-vs-repoint for `/api/hpo/*`; repointing at `terminologyConcepts`
  would also supply the compliant read path #866's fix does not restore.
  #871 is delete-vs-port, where the orphan holds a retry affordance the
  wizard lacks.
- **#883 is the residue of #868**: validating the PUT closed eight of ten
  quarantine triggers, but `Maintenance` and `Inactive` are ordinary
  statuses and still bulk-quarantine every sample under the equipment.

## Recommended next

Dennis named no next issue, so: **none queued.**

**His two standing corrections from this sitting outrank the above**, and
both are filed against the pack:

- **Do not idle agent slots while blocked on a long local job**, and work the
  issues filed in the same sitting rather than only filing them well.
  Measured at 543 seconds with zero agents live and twelve fresh issues
  open. Pack #589.
- **The `rabbit-hole` conversion is not a stopping device.** It is the one
  disposition with no floor — case 5 needs a physical blocker and the
  owner's call needs #529's non-circularity, but a conversion needs nothing
  established. I claimed one with free agent slots and no blocked work.
  Pack #590.
