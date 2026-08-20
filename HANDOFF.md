# HANDOFF

**Written:** 2026-08-20, mid-sitting rotation (rabbit-hole Step 4 — per
item, not end of session). Picked up right after the prior rotation's
close (#671 landed). Dennis said "continue rabbit hole... Docker is
on... free to divide and conquer" — no mid-workflow prompts. This item
landed **#672** (RF029 slice 4/6, files). **Still inside the rabbit hole
(tracker #668) — continuing the queue, not stopping.**

## What landed this item

- **#672 (RF029 slice 4/6: files ingestion) — shipped, merge
  `8bdd98d3`.** Added `canonical.v1.file` (dict-02's `DataFile`,
  ELM-0316..0321) and proved it through slice 1's gateway (#669) via the
  same probe-only pattern slices 2-3 established — no new production
  ingestion routes, RF007's real file-upload path
  (`sample-file.controller.js`) untouched. `fileUri`/`checksum`/
  `fileSizeBytes` map onto `SampleFile.js`'s real `storageUri`/
  `checksum`/`fileSize` fields; `fileRole`/`fileFormat` stay optional
  (real `fileType` enum is a different vocabulary — see #679).
  `specimenId` reference-checks against the real `samples` collection
  via a new `seedRawSpecimen` e2e fixture (added to `seedParticipant.ts`,
  same minimal-raw-insert shape as the existing `seedStudy`/
  `seedProtocol`). A payload using the legacy `storageUri` field instead
  of canonical `fileUri` is quarantined, not silently accepted — same
  alias-discipline slices 2-3 already proved. AC#7 (Object Storage
  routing) not re-proven here: `scientific-data-access.spec.ts` already
  covers it against the same real upload path. 5 new unit tests
  (`fileSchema.test.js`) + 4 new real-backend e2e tests, all green;
  re-ran clean with no regressions: 18/18 RF029 e2e tests (slices 1-4),
  61/61 architecture tests. Full writeup: #672's own closing comment and
  #668's "Slice 4/6 ... landed" comment.

## Friction hit this item (all filed, none blocking)

- **Backend-app-test build-not-mount gotcha bit reactively**: first e2e
  run against the still-up stack failed all 4 new tests
  (`response.ok()` false) because `backend-app-test` was still serving
  slice 3's image, with no `canonical.v1.file` registered. Fixed with a
  targeted `up -d --build backend-app-test`; all green after. Filed
  **dyeallpies-skills-pack#356** suggesting `build-loop`'s own "run
  against real backend" step point at this gotcha explicitly, since I'd
  already read the rule this session and still missed applying it
  proactively.
- **Routing-gate hook friction recurred** (second occurrence, same shape
  as #671's — see prior rotation and **dyeallpies-skills-pack#355**):
  `work-issue`→`build-loop` had to be re-invoked immediately before the
  first `Edit`, even though `build-loop` had just been invoked
  immediately prior. Added a corroborating comment to #355 rather than
  filing a duplicate — this occurrence is stronger evidence the gate's
  allowlist doesn't recognize `build-loop` by name at all (not a
  recency/proximity issue, since the two invocations were back-to-back
  this time).
- **BioAvanceD-v2#679** — `canonical.v1.file`'s `fileFormat`/`fileRole`
  vocabularies (EDAM/MIME-coded, processing-stage) aren't populated by
  the real upload path's `fileType` enum (a different, narrower
  vocabulary). Not blocking #672 (both stayed optional) but will recur
  for any future slice needing either field populated for real.

## Rabbit-hole state: still open, not exited

**#646 stays open** (RF029/#668 is the one Wave 3 RF not yet done) and
**so does #668** (2/6 RF029 slices remain: #673-674). Next concrete
pickup: **#673** (datasets/assays — extends existing `Assay.js`/
`Dataset.js` routes with slice 1's contract validation + quarantine).
**#674** stays blocked on RF027 (not yet scheduled). Also still open,
non-blocking: **#675** (ingestion test-support route's write-primitive
exposure), **#676** (`activeCodeValidator`'s unversioned-code tie-break
ambiguity), **#677** (RF005 AC4-6 structured clinical data, own future
multi-slice build), **#678** (no ThresholdProfile entity, from #671),
**#679** (fileFormat/fileRole vocabulary gap, from #672). Both #646 and
#668 carry full queue state; this file is a snapshot.

**Budget note (rabbit-hole Step 5):** two "medium" (2-3 point) slices
landed this sitting (#671, #672) — running total ≈6, approaching half
the ~10 point budget. #673 is the same shape/size as the two just
landed; picking it up would push the total to ≈8-9, close to the
budget ceiling. Next session should treat the *next* pop after #673 (if
any) as the point to seriously weigh stopping to report back, per Step
5's "surface, rotate, let the user decide" guidance — not a hard
stop, but budget is real at that point, not just advisory headroom.

## Repo state

- On `feature/docker-e2e-backend-integration`, 3 commits ahead of
  `origin/feature/docker-e2e-backend-integration` (this item's merge +
  the prior item's merge + its own HANDOFF rotation) — not yet pushed;
  pushing is a `ship-integration-branch`-gate decision, not a per-item
  one. Working tree clean except the gitignored/junctioned
  `.claude/skills/` and the pre-existing untracked
  `api/backend/storage/assays/` (neither this item's doing).
- No PR to `main` exists.
- **Docker: test stack is up** (`compose.test.yml` core services +
  `admin-bootstrap-test`, all healthy; `backend-app-test` freshly
  rebuilt this item) — **left up deliberately**, per build-loop's
  Docker-on-by-default-per-iteration and this sitting's own precedent
  of leaving the stack up across slices. `playwright-runner` still has
  not auto-started (explicit service-name bring-up, not a bare `up -d`)
  — re-check `docker ps` before any future manual/targeted Playwright
  run against this stack if a later item ever does a bare `up -d`.
  **Reminder for the next item**: if it touches backend source, rebuild
  `backend-app-test` (`up -d --build backend-app-test`) before trusting
  an e2e run against the still-up stack — don't wait for a confusing
  failure to reveal it again.
- The `test/672-rf029-files-ingestion` branch was merged and deleted
  locally; never pushed remotely.

## Recommended next steps

Dennis's "continue, free to divide and conquer" instruction still
stands. Next: pick up **#673** (datasets/assays, unblocked, same shape
as the last two slices) — but per the budget note above, treat whatever
comes after #673 as a genuine checkpoint-and-report decision, not an
automatic continue. #675/#676/#677/#678/#679 remain available as
smaller alternatives if a change of pace is preferred over another
full slice.
