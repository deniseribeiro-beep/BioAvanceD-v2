# HANDOFF

**Written:** 2026-08-21. Docker is on (inherited stack from a prior session, left running -- see "Repo state" below).

## Still inside the rabbit hole: #646 -> #668 -> #674 (RF027/#716 closed this sitting, #674 unblocked but its own scope unstarted)

**Tracker chain, re-derived fresh this sitting from the issue threads
themselves (not from an even-earlier handoff's summary):** #646 (Wave 3
kickoff) is **not** actually closed/unrelated as an earlier handoff
claimed -- its own comment thread already established #668 (RF029
tracker) and, through #668, #674 (RF029 slice 6/6) as live descendants.
#674 was the one open item left in #646's queue, blocked on **RF027**
("Workflows e dados ômicos") not existing yet -- explicitly Wave 4,
lowest-urgency, per `E2E_TRACEABILITY_PLAN.md`.

**Dennis explicitly chose to pull RF027 forward this sitting.** Filed
**#716** as RF027's own tracking issue, split into 4 slices (all landed
and closed this sitting -- see "What landed" below), scoped from
`docs/docs-7-31-2026/1-Requisitos-Funcionais-e-Nao-Funcionais.md:638-651`
and `dict-02_DICIONARIO.md` ELM-0326-0356.

**Important distinction for whoever picks this up next: #716's closure
does NOT close #674.** #674's own scope (read its body fresh, don't
trust this summary) is wiring the 3 entities RF027 built
(`WorkflowRun`/`OmicsQualification`/`OmicsRun`) through #668's RF029
ingestion-gateway foundation -- `canonical.v1.workflow`/
`canonical.v1.omicsQualification`/`canonical.v1.omicsRun` schemas + a
probe-only real-backend proof in `pipeline-continuity.spec.ts`, the same
pattern #669-673 used for their own entities (dict-02 telemetry/file/
assay/dataset). That's separate work from building RF027 itself, and it
was **not started this sitting** -- #674 is now unblocked (its
dependency exists) but still needs its own iteration. #668 and #646 both
stay open on #674 for this reason.

**Filed this sitting, both still open:**
- [**#721**](https://github.com/deniseribeiro-beep/BioAvanceD-v2/issues/721):
  dict-02's 2 remaining "Dados ômicos e imagens" entities
  (ImagingStudy/ImagingDerivedData, ELM-0353-0356, DICOM-specific
  structured metadata) weren't folded into `OmicsRun` -- structurally
  different from the 5 modalities `OmicsRun` covers (file-reference
  bundles), so absorbing them would've misrepresented their real shape.
  Not blocking #716's own closure -- RF027's own AC#5/#6 are both
  satisfied without it.
- [**dyeallpies-skills-pack#380**](https://github.com/DyeAllPies/dyeallpies-skills-pack/issues/380):
  a process-sequencing gap -- `rabbit-hole`'s tracker-opening step ran
  before `build-loop`'s own multi-item-tracking precedent was in
  context, which let this sitting initially mis-split RF027 into 4
  separate issue numbers (#717-720) before self-correcting mid-sitting
  (closed those 4, folded the breakdown into #716's own body instead).

## What landed this sitting

**#716 (RF027) closed, all 4 slices merged to
`feature/docker-e2e-backend-integration`, pushed at `e77f2024`:**

- **1/4 WorkflowRun foundation** (AC#1/2/4) -- model + master-data route
  at `/api/workflow-runs`. AC#4's "executor" reuses BaseRecord's shared
  `createdBy` field (ELM-0007) rather than inventing new vocabulary.
  Merge `0d719166`.
- **2/4 Input/output file linkage** (AC#3) -- this repo has no unified
  DataFile collection (files are per-parent: `sample_files`/
  `assayFiles`/`datasetFiles`), so linkage is a dedicated endpoint
  (`/api/workflow-runs/:workflowRunId/files`) resolving an existing
  file's id across all three. Merge `c732ed63`.
- **3/4 OmicsQualification** (AC#6) -- model + master-data route at
  `/api/omics-qualifications`, same shape as slice 1. Merge `33751b01`.
- **4/4 OmicsRun** (AC#5) + real-backend e2e proof for the whole
  tracker -- a single modality-discriminated model (genomics/
  transcriptomics/proteomics/metabolomics/microbiome) covering 5 of
  dict-02's 7 "Dados ômicos e imagens" entities (imaging carved out to
  #721). New "Workflows and omics data (RF027)" describe block in
  `scientific-data-access.spec.ts` (RF027's own mapped file per
  `E2E_TRACEABILITY_PLAN.md:225`), 2/2 passing against the real Docker
  test stack (`backend-app-test` rebuilt first to pick up all 4
  slices' backend source changes -- build-not-mount gotcha). Full
  `scientific-data-access.spec.ts` re-run clean: 11/11. Merge `e77f2024`.

152/152 native unit+integration tests across all 4 slices. All 4
per-slice branches (`test/716-rf027-*`) merged `--no-ff` and deleted
locally; none pushed remotely. AC#7 (no AI/XAI) verified throughout as a
completeness check, nothing built touches AI/XAI surface.

**One self-caught process error, already fixed:** two `gh issue edit
716 --body-file /tmp/...` calls silently failed to persist a checklist
edit (the issue body reverted) -- traced to `/tmp` path unreliability on
this Windows/Git-Bash setup, the exact failure mode `dennis-windows`'s
"Use the session scratchpad, never /tmp" section already documents.
Re-did the edit via the scratchpad path and confirmed it landed. No
skill fix needed -- the guidance was already correct.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed to origin at
  `e77f2024` (plus this handoff rotation, pushed after). No PR to
  `main` exists; `main` stays frozen per convention.
- **Docker: UP**, inherited from a prior session, still running.
  `backend-app-test` was rebuilt this sitting (`--build`) to pick up
  slices 1-4's backend source changes and is healthy as of the e2e run
  above. Confirm it's still healthy (`docker ps`) before trusting it in
  a future session, and rebuild again before any further e2e run if
  more backend source has changed since.

## Recommended next steps

Dennis didn't name a specific next issue. The direct continuation of
this sitting's own thread is **#674's own remaining scope** (RF029
ingestion-gateway wiring for the 3 entities RF027 just built) --
re-read #674 and #668 fresh before starting, since this file's summary
of them will go stale. Otherwise:
- [**#721**](https://github.com/deniseribeiro-beep/BioAvanceD-v2/issues/721)
  (imaging entities carve-out) -- smaller, well-scoped, not urgent.
- **#646** itself has no other open items beyond the #668/#674 chain as
  of this sitting -- re-derive fresh, don't assume from this summary.
