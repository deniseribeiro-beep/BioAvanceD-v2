# HANDOFF

**Written:** 2026-08-13, end of session on `feature/docker-e2e-backend-integration`.

## What happened this session

Two parts: (1) cross-repo debugging requested by Dennis against two
`dyeallpies_skills_pack` issues that needed a genuine BioAvanceD-v2
primary-directory session to test, and (2) closing out `#551` (RF028
AC7 full lifecycle), dogfooding the pack's `issue-loop` skill in
`--until-done` single-issue mode per the pack's own `#277`.

### Part 1 — pack-repo #248/#270, both still open, no repro

Read the pack repo's `HANDOFF.md`, identified `#248` (intermittent
empty `git diff <A> <B> -- <path>`) and `#270` (`full-suite-guard.cjs`
sometimes not blocking a live untargeted `vitest run`) as needing this
exact session shape. Neither reproduced: 25 more attempts on #248 (I/O
load, real interleaved tool calls, genuine parallel dispatch — 41/41
clean across two sessions now), four angles on #270 (exact original
command/cwd, parallel-dispatch race-condition test, hook-latency timing
check — all blocked correctly). Both progress-commented on the pack
repo, left open. No BioAvanceD-v2 code touched for this part.

**Along the way**, rotating the pack repo's `HANDOFF.md` directly from
this (non-pack-primary) session tripped a real gap in `work-issue`'s
"pack repo on itself" routing clause — filed as pack-repo `#281`, fixed
by Dennis same session (`routing-gate.cjs` now skips its product-file-
edit gate for a write outside the session's own repo root — `#282`,
already deployed to this repo's `.claude/`). Also established (Dennis's
call, not this session's own judgment): a cross-repo session should
*never* commit directly to the pack repo's tracked files even when the
gate allows it — file the content as an issue (pack repo `#280`) for a
pack-primary session to fold in instead. Both `#280`/`#281` are still
open in the pack repo.

### Part 2 — #551 closed, all three AC7 pieces landed

`#551` (checkpoint/resume, quarantine recovery, rollback) came in
already 1/3 done (quarantine recovery, prior session). This session
landed the other two as separate `issue-loop` iterations in one
sitting, no user re-prompting between them:

- **Checkpoint/resume** (`c4edecc`, merged `934e6ad0`): `runImport()`
  now batches staging writes (concepts *and* relations — relations were
  previously in-memory only, never persisted) into `batchSize`-sized
  chunks, checkpointing `{offset: N}` on the `ReferenceImportRun` doc
  after each chunk. A run left `running` (interrupted) resumes from its
  checkpoint on retry instead of restarting or short-circuiting as
  idempotent; promotion now reads staged data back from the collection
  (source of truth) instead of an in-memory variable. 8/8 in
  `pipeline.test.js` (3 new).
- **Rollback** (`2581af6`, merged `88119862`): new `rollbackRelease()`
  next to `promote()` — reactivates a dataset's previous
  `ReferenceDatasetRelease`, flips the current active one to
  `rolled_back` (not `superseded` — that status means something else),
  writes a `ReferenceImportRun` (`importMode: 'rollback'`). Nothing
  physically deleted. 11/11 in `pipeline.test.js` (3 new).

Both slices used the native fake-collection proof bar (this repo's
established "real backend" bar for a backend-internal, non-e2e-Playwright
slice per `build-loop`'s overlay) — no Docker.

**#551 closed.** Parent-chain check (`resolve-issue` step 7) against
`#373`: 3 of its 4 listed items are now closed (`#549` sources, `#550`
live download/license, `#551` AC7) — the 4th, Neo4j outbox projection,
is still open as `#552`. Commented on `#373` with that state; left it
open.

**Also found and fixed**: `docs/architecture/reference-data-seeding.md`
still listed checkpoint/resume and quarantine recovery as undone —
corrected that one line in the checkpoint/resume commit. The doc turned
out far more broadly stale than that (still describes HPO as the only
importer, predates `#549`'s 15 additional sources and `#557`'s
live-verify work) — filed separately as `#559` rather than rewritten
inline, since a full rewrite was out of this slice's own scope.

**Dogfooding note for future sessions**: `issue-loop`'s single-issue
`--until-done` mode now has a real, confirmed-clean run against this
repo (pack-repo `#277`, closed this session) — classify-once, no-
reprompt re-entry, per-iteration wrap-up, and the close+parent-chain
sequence all worked exactly as the skill describes. Safe to reach for
directly next time a multi-slice issue like this comes up, no need to
hand-roll the checklist again.

### Closed this session

- BioAvanceD-v2 `#551` (this repo).
- pack-repo `#277` (dogfooding confirmation).

### Filed this session

- BioAvanceD-v2 `#559` — `docs/architecture/reference-data-seeding.md`'s
  broader staleness (see above).
- pack-repo `#280`, `#281` (see Part 1) — both still open.

## Repo state

- **`feature/docker-e2e-backend-integration`**: clean, pushed, at
  `88119862`. Carries both of this session's #551 slices on top of
  everything the prior handoff described.
- Two local branches from this session, both merged and safe to delete:
  `test/551-checkpoint-resume`, `test/551-rollback`. `clean-up` invoked
  at session end to handle this (and confirm no Docker stack was
  started — none was, this session's proof bar was native-only
  throughout).
- **Pre-existing dangling local branches, not touched this session**
  (carried forward unchanged from prior handoffs — `fix/476-...`,
  `fix/477-...`, `fix/481-...`, `fix/485-...`, `fix/513-...`,
  `test/377-...`, `test/428-...`, `test/431-...`, `test/440-...`,
  `test/441-...`, `test/486-...`, `test/507-...` through `test/511-...`,
  the nine `test/549-*-reference-source` branches, plus a stray
  `worktree-agent-*` branch — not re-verified against the integration
  branch this session).

## Next steps

No issue named as next by Dennis. For context (not a directive):
- **`#373`** (RF028 parent tracking issue) — down to one remaining item,
  `#552` (Neo4j outbox projection, AC9). A natural next RF028 pickup.
- **pack-repo `#248`/`#270`** — both still open, both now have two full
  sessions of negative-repro data. Only remaining lever for either is
  "deep into a long, loaded, real session" rather than a dedicated
  isolated test — not worth another dedicated debugging session.
- **pack-repo `#280`/`#281`** — `#280` needs a pack-primary session to
  fold its content into that repo's `HANDOFF.md`; `#281` needs the
  `work-issue`/Rule-0-adjacent wording fix it proposes (small,
  self-contained, natural pickup from inside the pack repo).
