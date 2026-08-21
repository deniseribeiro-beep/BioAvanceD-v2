# HANDOFF

**Written:** 2026-08-21. Docker is on (inherited stack from a prior session, left running -- see "Repo state" below).

## Still inside the rabbit hole: #646 -> #668 -> #674 -> #716 (RF027, slices 1-3/4 landed, 1 remains)

**Tracker chain, re-derived fresh this sitting from the issue threads
themselves (not from an even-earlier handoff's summary):** #646 (Wave 3
kickoff) is **not** actually closed/unrelated as an earlier handoff
claimed -- its own comment thread already established #668 (RF029
tracker) and, through #668, #674 (RF029 slice 6/6) as live descendants.
#674 was the one open item left in #646's queue, blocked on **RF027**
("Workflows e dados ômicos") not existing yet -- explicitly Wave 4,
lowest-urgency, per `E2E_TRACEABILITY_PLAN.md`.

**Dennis explicitly chose to pull RF027 forward this sitting** rather
than leave #674 parked. Filed **#716** as RF027's own tracking issue,
scoped from `docs/docs-7-31-2026/1-Requisitos-Funcionais-e-Nao-Funcionais.md:638-651`
(AC text unchanged from v3.0.0, confirmed via the 2026-07-31 changelog)
and `dict-02_DICIONARIO.md` ELM-0326-0356. Initially split into 4
separate issue numbers (#717-720) by mistake -- corrected mid-sitting
and closed them, folding the same 4-slice breakdown into #716's own
body as a checklist instead, per this repo's precedent for multi-item
requirements that don't need independent backend/ownership split
(`build-loop`'s local-env overlay, #278; contrast #668/RF029, which
*did* split because its slices targeted genuinely different storage
backends -- RF027's 4 slices are all MongoDB master-data entities via
the same `createMasterDataRouter` pattern). Filed the sequencing gap
that let that mistake happen as
[dyeallpies-skills-pack#380](https://github.com/DyeAllPies/dyeallpies-skills-pack/issues/380)
(`rabbit-hole`'s tracker-opening step runs before the implementing loop
skill's own multi-item precedent is in context).

**#716's checklist (only source of truth for what's left -- re-derive
from the issue itself, don't trust this summary if stale):**
- [x] **1/4 -- WorkflowRun foundation** -- landed, see below.
- [x] **2/4 -- Input/output file linkage** -- landed, see below.
- [x] **3/4 -- OmicsQualification** -- landed, see below.
- [ ] **4/4 -- Omics data run records + genomic reference, e2e proof**
  (AC#5 + AC#7 scope-cap check, depends on 1/4) -- design call not yet
  made: default to one modality-discriminated `OmicsRun` model rather
  than dict-02's 7 separate modality entities (ELM-0343-0356), per the
  "structurally interchangeable" reasoning #668 used for RF029. Also
  where the tracker's real-backend e2e proof belongs
  (`scientific-data-access.spec.ts`, per `E2E_TRACEABILITY_PLAN.md:225`).
  **This is the last piece of #716** -- once it lands, close #716, then
  re-check #674 and #668 for closure (upward-cascade), then #646.

## What landed this sitting

- **Slice 1/4 (#716):** `WorkflowRun` model (dict-02 ELM-0326-0336) +
  master-data CRUD route at `/api/workflow-runs`, mounted in `app.js`
  via the existing `createMasterDataRouter` factory (same as
  `/api/assays`/`/api/datasets`). Covers AC#1 (workflow/version/
  container image), AC#2 (parameters/dependencies), AC#4 (start/end/
  executor/status) -- AC#4's "executor" reuses BaseRecord's shared
  `createdBy` field (ELM-0007) rather than inventing new vocabulary,
  same precedent #669 set for its own ingestion envelope.
  `inputFileIds`/`outputFileIds` stay optional pending slice 2/4,
  mirroring `Dataset.js`'s own `distributionFiles` precedent.
  30/30 unit tests, 6/6 integration tests. Merge `0d719166`.
- **Slice 2/4 (#716):** AC#3 "vincular arquivos de entrada e saída".
  This repo has no single unified DataFile collection -- scientific
  files are stored per-parent (`sample_files`/`assayFiles`/
  `datasetFiles`) -- so linkage is a dedicated endpoint
  (`POST`/`GET /api/workflow-runs/:workflowRunId/files`,
  `workflow-run-file-link.routes.js` + `workflowRunFileLinker.js`
  service) that resolves an existing file's id across all three
  collections and `$addToSet`s it onto `inputFileIds`/`outputFileIds`,
  rather than re-implementing upload/download/replace -- a workflow run
  references files that already exist elsewhere, it doesn't own new
  file bytes. 7/7 unit tests, 8/8 integration tests. Merge `c732ed63`.
- **Slice 3/4 (#716):** AC#6 "registrar qualificação ômica específica
  ao ensaio" (dict-02 ELM-0337-0342). `OmicsQualification` model +
  master-data CRUD route at `/api/omics-qualifications`, same shape as
  slice 1. Independent of slices 1/4-2/4. 17/17 unit tests, 6/6
  integration tests. Merge `33751b01`.
  All 3 slices re-ran clean together alongside `master-data.api.test.js`
  (39/39) -- 106/106 total as of slice 3. Branches
  `test/716-rf027-workflowrun-foundation`,
  `test/716-rf027-workflowrun-file-linkage`, and
  `test/716-rf027-omics-qualification` all merged `--no-ff` and deleted
  locally; none pushed remotely.
- No Docker/e2e proof run this sitting for any of the 3 slices -- per
  `build-loop`'s local-env overlay, a backend-internal slice's proof
  bar is mocked-Mongo supertest, not literal Docker; Docker/Playwright
  proof is deferred to slice 4/4's own e2e-spec addition.
- Queue-membership comments posted on #646/#668/#674 pointing at #716.
- One self-caught process error, already fixed: two `gh issue edit 716
  --body-file /tmp/...` calls silently failed to persist a checklist
  edit (the issue body reverted to its pre-checklist state) -- traced to
  `/tmp` path unreliability on this Windows/Git-Bash setup, exactly the
  failure mode `dennis-windows`'s "Use the session scratchpad, never
  /tmp" section already documents. Re-did the edit via the session
  scratchpad path and confirmed it landed (`gh issue view --json body`).
  No skill fix needed -- the guidance was already correct, this session
  just didn't follow it the first two times.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed to origin at
  `33751b01` (plus this handoff rotation, pushed after). No PR to
  `main` exists; `main` stays frozen per convention.
- **Docker: UP**, inherited from a prior session (not started this
  sitting). Dennis was asked at session start whether to tear it down
  and chose to leave it running. Confirm it's still healthy
  (`docker ps`) before trusting it, and rebuild
  `backend-app-test`/`frontend-app-test` before any e2e run against it
  -- this sitting made backend source changes (slices 1-3/4) that an
  already-running container won't reflect (build-not-mount gotcha).

## Recommended next steps

Dennis didn't name a specific next issue beyond continuing RF027 itself.
**Slice 4/4 of #716** (omics data run records + genomic reference +
the tracker's own real-backend e2e proof) is the direct continuation
and the last piece -- it's also the largest slice, with a design call
not yet made (single modality-discriminated `OmicsRun` model vs.
dict-02's 7 separate modality entities) and the first slice needing an
actual Docker/Playwright run rather than mocked-Mongo tests, since it's
where `scientific-data-access.spec.ts` coverage for the whole tracker
belongs. Re-read #716 fresh rather than trusting this summary once any
more time has passed.
