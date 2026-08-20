# HANDOFF

**Written:** 2026-08-20, end of this sitting. Picked up right after the
prior rotation's close (#669/#670 landed). Dennis said "continue rabbit
hole... Docker is on... free to divide and conquer" — no mid-workflow
prompts, repeated twice this sitting. Landed **#671**, **#672**, and
**#673** (RF029 slices 3/6, 4/6, 5/6). Stopping here to report back per
the budget checkpoint flagged in this file's own prior rotation, not
because anything blocked.

## What landed this sitting

- **#671 (RF029 slice 3/6: telemetry) — shipped, merge `6ca21758`.**
  `canonical.v1.telemetry` (dict-02 TelemetryReading), proved via the
  probe-only pattern. Resolved the open "probe-only vs. real production
  route" coordination question #670 flagged, explicitly, in favor of
  probe-only — AC#7's InfluxDB routing already has independent proof in
  `interop-monitoring.spec.ts`. 5 unit + 4 e2e tests, all green.
- **#672 (RF029 slice 4/6: files) — shipped, merge `8bdd98d3`.**
  `canonical.v1.file` (dict-02 DataFile), same probe-only pattern. New
  `seedRawSpecimen` e2e fixture (minimal raw insert, mirrors
  `seedStudy`/`seedProtocol`). AC#7 (Object Storage) already proven by
  `scientific-data-access.spec.ts`. 5 unit + 4 e2e tests, all green
  after a rebuild (see gotcha below).
- **#673 (RF029 slice 5/6: datasets/assays) — shipped, merge
  `f25efb46`.** `canonical.v1.assay` + `canonical.v1.dataset` (dict-02
  Assay/Dataset — both entities already closely dictionary-aligned in
  the real models). Neither schema requires its own `<entity>Id` —
  both are purely server-generated, unlike `participantId`. #664
  (Assay referential-integrity gap on the real route) stays open,
  explicitly unaddressed — this slice only proves the gateway's generic
  reference-check against `studyId`. 10 unit + 5 e2e tests, all green
  on the first run (proactive rebuild this time, see gotcha below).

Full writeups: each issue's own closing comment and #668's three
"Slice N/6 ... landed" comments.

**RF029 is now 5/6 slices done.** Only **#674** (workflows/omics)
remains, still blocked on RF027 (Wave 4, not yet scheduled) — #668 and
#646 cannot close until RF027 lands and #674 is built, independent of
any pacing decision.

## Six follow-ups filed this sitting (all open, none blocking)

BioAvanceD-v2 tracker:
- **#678** — no `ThresholdProfile` entity exists (dict-02 requires one
  for `TelemetryReading.thresholdProfileId`); `temperaturePolicies` is
  the practical but differently-shaped stand-in. From #671.
- **#679** — `canonical.v1.file`'s `fileFormat`/`fileRole` vocabularies
  (EDAM/MIME, processing-stage) aren't populated by the real upload
  path's narrower `fileType` enum. From #672.

`dyeallpies-skills-pack` tracker (skill/hook orchestration findings, not
this repo's product — filed there per `wrap-up`'s routing rule):
- **#355** — the product-file-edit routing gate didn't recognize an
  already-invoked `build-loop` (reactive block + `work-issue`+re-invoke
  workaround needed, twice — #671 and #672). Third attempt (#673)
  invoked `work-issue`+`build-loop` together *proactively* before the
  first edit and hit no block at all — that workaround is now the
  known-good pattern for this session's remaining life, until #355 is
  actually fixed upstream.
- **#356** — `build-loop`'s "run against real backend" step doesn't
  point at the `backend-app-test` build-not-mount gotcha at the moment
  it's relevant (bit reactively on #672 despite having read the rule
  earlier the same session). Applying it proactively on #673 (rebuild
  before first run) worked cleanly — also now the known-good pattern.

Also carried from the prior rotation, still open: #675 (probe route
write-primitive exposure), #676 (`activeCodeValidator` tie-break),
#677 (RF005 AC4-6 structured clinical data).

## Rabbit-hole state: still open, not exited

**#646 stays open** (RF029/#668 is the one Wave 3 RF not yet done) and
**so does #668** (1/6 RF029 slices remain: #674, blocked). Both carry
full queue state; this file is a snapshot.

**Budget note (rabbit-hole Step 5):** three "medium" (2-3 point) slices
landed this sitting — running total ≈9, at the ~10 point budget ceiling.
This is the actual stop-and-report point Step 5 describes, not an early
or arbitrary one.

## Repo state

- On `feature/docker-e2e-backend-integration`, 8 commits ahead of
  `origin/feature/docker-e2e-backend-integration` — not yet pushed;
  pushing is a `ship-integration-branch`-gate decision, not a per-item
  one. Working tree clean except the gitignored/junctioned
  `.claude/skills/` and the pre-existing untracked
  `api/backend/storage/assays/` (neither this sitting's doing).
- No PR to `main` exists.
- **Docker**: test stack was up the whole sitting (`backend-app-test`
  rebuilt twice — once reactively for #672, once proactively for
  #673) — **being torn down now** via `clean-up` (this is the sitting's
  real stopping point, not a per-item pause — see build-loop's "Docker
  on by default answers bring-up, not teardown" note).
- All three of this sitting's branches (`test/671-...`, `test/672-...`,
  `test/673-...`) were merged and deleted locally; none were ever
  pushed remotely.
- **Two self-corrected slips, no lasting effect**: forgot to cut a
  fresh branch before the first edit twice (between #671→#672, and
  briefly at the very start of #673 before catching it) — both times
  `edit-branch-guard.cjs` blocked before any edit landed, branch
  created, edit retried successfully. By #673's actual implementation
  work the branch was cut first, cleanly. Not filed anywhere — self-
  corrected in-session, not a skill/hook gap (the hook did exactly its
  job both times).

## Recommended next steps

Dennis's "continue, free to divide and conquer" instruction still
stands — this sitting stopped at three slices as the budget's own
stop-and-report point (Step 5), not because anything blocked. Next
session: pick up **#674** if RF027 has landed by then (check first —
it hadn't as of this writing), or address **#675/#676/#677/#678/#679**
(all smaller, independent, non-blocking), or check on
**dyeallpies-skills-pack#355/#356** if that repo's own session has
picked them up — the proactive-invocation workarounds documented above
remain necessary until then either way.
