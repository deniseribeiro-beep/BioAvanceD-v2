# HANDOFF

**Written:** 2026-08-13, end of session on `feature/docker-e2e-backend-integration`,
after Dennis said "Continue 557, see if it's manageably to loop until the
issue is fully finished, then report to the skills pack repo a need for a
multi step loop, or a loop of multiple issues."

## What happened this session

Continued #557 via `work-issue` → `build-loop`, running **7 consecutive
iterations in one continuous session** (no user re-prompting between them)
to close out every remaining named source, then closed both #557 and its
parent tracking issue #550. Also filed one product-repo bug (#558) and two
skills-pack issues (#270, #271) surfaced along the way.

### The 7 build-loop iterations (DCB → EDAM)

Each landed on its own `test/557-live-verify-<code>` branch, merged (no-ff)
into `feature/docker-e2e-backend-integration`, with a progress comment
posted to #557 after each:

- **DCB** (§7.4 step 7) — third `'fixed-edition'` entry. `gov.br/anvisa/.../
  farmacopeia/dcb` 200s directly under Node `fetch()`, current updating IN
  embedded inline ("IN nº 342, de 20 de dezembro de 2024"). The page also
  links the Anvisa Digital Library for the actual XLSX, which repeats
  LOINC's curl-vs-fetch() Cloudflare split — but that doesn't block
  verification since the release signal lives on the reachable page, not
  the blocked one. License reuses gov.br's sitewide Terms of Use page (CC
  BY-ND 3.0 pointer in its footer). Commit `ce3f84de` / merge `34fd758e`.
- **ATC** (§7.4 step 7, closing the DCB/ATC pair) — fourth `'fixed-edition'`
  entry. `whocc.no/atc_ddd_index/` 301-redirects to `atcddd.fhi.no` (WHOCC
  relocated to the Norwegian Institute of Public Health) — Node `fetch()`
  follows transparently. Page carries `<h1>ATC/DDD Index 2026</h1>`. License
  is a dedicated Copyright/Disclaimer page. Commit `ebb3e7b8` / merge
  `c440db1e`.
- **DUO** (§7.4 step 8, first of 5) — needed a genuinely new `kind`,
  `'github-release-file'`: `EBISPOT/DUO`'s latest release (`v2021-02-23`)
  carries **no attached assets** — `duo.owl` lives checked into the repo
  tree itself. New kind proves the release via the releases API and the
  file's presence via a HEAD check against its raw.githubusercontent.com
  URL. Commit `6edfe9e0` / merge `5c1e9bc7`.
- **UBERON** (§7.4 step 8) — back to plain `'github-release'` (its sibling
  DUO needed the new kind; this one didn't) — `obophenotype/uberon`'s
  release does carry a matching `uberon.owl` asset. Commit `de0c0fae` /
  merge `2ce0ff0f`.
- **NCBI Taxonomy** (§7.4 step 8) — needed another new kind, `'rest-version'`:
  genuinely public, continuously-updated REST API (similar to HGNC's
  `'rest-info'`), but the live signal is the NCBI Datasets v2 API's own
  `/datasets/v2/version` endpoint (a version string) rather than a
  `lastModified` timestamp. Commit `28a66457` / merge `ca7584a3` — this
  particular push hit GitHub's own transient `Internal Server Error` on
  4 consecutive attempts before landing via a background retry loop; not a
  repo-side problem.
- **Cell Ontology** (§7.4 step 8) — plain `'github-release'` again
  (`obophenotype/cell-ontology`, `cl.owl` asset present, CC-BY-4.0
  auto-detected). Commit `93551e31` / merge `9ef3a2da`.
- **EDAM** (§7.4 step 8, fifth and final) — plain `'github-release'`
  (`edamontology/edamontology`, `EDAM.owl` asset present, CC-BY-SA-4.0 —
  the only ShareAlike variant in the whole loop). Commit `cec8ee24` / merge
  `f7820825`. Closed out a full regression pass across all 15 prior sources
  natively as a final sanity check — all still report their expected status
  (14 `verified`, OMIM/LOINC `not-verifiable`).

None of the 7 iterations touched product source (`api/backend/src`,
`frontend/src`) — confirmed via `git diff --stat` across the whole session's
range: only `package.json`, `liveVerifySources.js`, `verify-live-release.js`,
and `verifyLiveRelease.test.js` changed, same boundary precedent as every
prior #557 slice.

**verify-live-release.js now has 8 verification `kind`s** total (see #557's
closing comment for the full list): `'github-release'` (default),
`'direct-download'`, `'redirect-version'`, `'fixed-edition'`,
`'not-live-verifiable'`, `'rest-info'`, `'github-release-file'` (new this
session), `'rest-version'` (new this session).

### Closed this session

- **#557** — all 16 Fase 2 sources now live-verified (HPO's #556 pilot +
  the 15 this issue named). Closed with a summary comment listing all 8
  verification kinds.
- **#550** — the original tracking issue for the 3-way #555/#556/#557
  split. All three sub-issues confirmed closed; closed as fully resolved.

### Filed this session

- **BioAvanceD-v2#558** — `storageService.test.js` has 2 pinned tests
  (`allocateSampleToPosition`, `autoAssignSampleToBox` happy-paths) still
  asserting `status: 'AVAILABLE'` in a mocked `$set` payload, stale since
  #544 removed that write from `MongoStorageRepository` (which
  `storageService.js` delegates to). #544's own resolution un-weakened
  `MongoStorageRepository.test.js` but missed this file. Confirmed
  pre-existing on the integration branch (unaffected by this session's
  changes) via `git stash`. Not fixed — out of scope for the #557 loop.
- **dyeallpies-skills-pack#270** (bug) — `full-suite-guard.cjs` said a
  specific command should block (confirmed via direct stdin test, and by
  hand-tracing the regex) but that command **ran to completion, unblocked,
  in the live session**. Clean repro included; root cause not diagnosed
  (no session-side visibility into the harness's own hook dispatch). Likely
  explains how at least 5 consecutive prior #557 comments (OMIM→UCUM) each
  reported a "unit tests: N/N" figure that was actually
  `verifyLiveRelease.test.js`'s own count mislabeled as a suite-wide total
  (true total is ~5918, not 121–129) — corrected on the live #557 DCB
  comment this session.
- **dyeallpies-skills-pack#271** (enhancement, the one Dennis asked for) —
  "Need a multi-step loop mode: iterate a whole multi-slice issue (or a
  queue of issues) without re-invocation." Documents that driving #557's 7
  iterations required inventing ad hoc scaffolding (a hand-built `TodoWrite`
  list from the issue body, manual "is this issue actually done" checks)
  the pack doesn't provide, and — the concrete correctness gap — that
  `fix-bugs`/`build-loop`'s "invoke `wrap-up` every iteration" instruction
  is genuinely ambiguous against `push-wrapup-checkpoint.cjs`'s own
  "mid-task, more slices coming" wording once several iterations run back
  to back without stopping: this session read 7 slices as one continuous
  task and skipped `wrap-up` for 6 of them, self-caught only at the very
  end against the skill's own literal text (then ran it for real before
  reporting). Full writeup, including what worked and didn't need fixing,
  is in the issue.

## Repo state

- **`feature/docker-e2e-backend-integration`**: at `f7820825`, clean,
  pushed, up to date with origin. Carries all of #555/#556's live-verify
  infrastructure + all 16 Fase 2 sources' live-verify entries (HPO, MONDO,
  ORPHA, ICD-11, ICD-10, OMIM, HGNC, LOINC, UCUM, DCB, ATC, DUO, Uberon,
  NCBI Taxonomy, Cell Ontology, EDAM), on top of #549's full 16-source
  fixture-import group.
- Docker: not used this session — live-verify is a network-only script, no
  Mongo/Docker involved, same as every prior #557 slice.
- **Pre-existing dangling branches, not touched this session** (carried
  forward unchanged from before — see earlier handoffs for the full list;
  not re-enumerated here to avoid drift from a list nobody re-verified this
  session either).

## Which issue is next

Dennis has not explicitly said which issue to pick up next session — per
this skill's own rule, nothing is queued.

Candidates carried forward:

- **#558** (new this session) — `storageService.test.js`'s 2 stale
  `status:'AVAILABLE'` pinned assertions, quick test-only fix (see above for
  the full diagnosis — the fix is already scoped, just not applied).
  Reasonable quick pick.
- **#553**/**#554** — the "14 vs 16" Fase 2 source undercount in
  `compose.dev.yml` and #550's own old title. #550 is now closed, so #554's
  title-undercount complaint is moot on the *closed* issue but the
  underlying `compose.dev.yml` comment (#553) is still live and still a
  quick win.
- **#551** — full AC7 lifecycle (checkpoint/resume, quarantine recovery,
  rollback). Unchanged, still open.
- **#552** — Neo4j outbox projection (AC9) for TerminologyConcept/
  TerminologyRelation. Unchanged, still open.
- **#530** — `dictionary:validate` isn't wired into `ci-pipeline.yml`.
  Unrelated to the RF028 cluster, still open.
- **#489** — full-suite vitest flakiness (JWT/encryption-secret failure
  shape, ~89 files), open, not re-confirmed. Note: this session found a
  *different* pre-existing full-suite failure shape (#558's
  storageService.test.js) while running the real full suite for an
  unrelated reason — worth checking whether #489's own signature has
  drifted the next time someone's in there.
- **#336** — still open: is `import.controller.js#importFhirBundle` dead
  code to remove, or does something still call it?
- Older backlog, unchanged: `#371`/`#374`/`#378`/`#379`, `#368`, `#345`,
  `#341`/`#340`, `#334`, `#331`/`#326`/`#325`, `#321`, `#319`, `#286`,
  `#284`, `#283`, `#282`, `#228`, `#115`, next e2e slice per
  `E2E_TRACEABILITY_PLAN.md`.
- **skills-pack#233/#234/#235/#236/#237/#238/#239/#240/#241/#243/#244/#246/#247/#250/#251/#254/#259/#260/#262/#263/#265/#267/#268/#269/#270/#271**
  — pack-repo only, low priority except #270/#271 (this session's new
  finds), unchanged otherwise this session. (#266 is resolved by #267;
  #267/#268/#269/#270/#271 are the pack maintainer's call, not this repo's.)

**The RF028 Fase 2 live-verify cluster (#550/#555/#556/#557) is now fully
closed** — no more candidates in that specific cluster. The next
naturally-related work would be wiring the fixture-based operational import
pipeline itself to real license/download verification (explicitly out of
scope for #550/#557 per both issues' own text), if that's still wanted; no
issue currently tracks it.

## Dev stack state

Not brought up this session — no Docker/database-dependent code touched.
Same state as the prior handoff left it: torn down, named volumes
(mongodb/neo4j data) untouched, images cached.

## Which skills to use

- **New pattern this session, not yet filed as a skill fix (it's the
  subject of skills-pack#271 instead)**: driving several build-loop
  iterations back to back in one session, per explicit user instruction to
  "loop until done," works mechanically but has no first-class support —
  expect to hand-track progress (this session used `TodoWrite` seeded from
  the issue's own named-source list) and to explicitly re-decide, every
  iteration, whether `wrap-up` is due now or at the end. Until #271 is
  resolved, default to running `wrap-up` after **every** iteration, per
  `fix-bugs`'s literal text — don't repeat this session's mistake of
  reading "mid-task, more slices coming" as license to defer it.
- Confirmed again this session: **a `kind`'s own field names don't
  automatically generalize to a new source with a superficially similar
  shape** — HGNC's `'rest-info'` (a `lastModified` JSON field) and NCBI
  Taxonomy's new `'rest-version'` (a `version` JSON field from a different
  endpoint) are both "genuinely public, continuously-updated REST API, no
  releases/tags" in spirit, but different enough in concrete signal that
  reusing `'rest-info'` as-is would have required breaking HGNC's existing
  tests to generalize a hardcoded field name — a new small kind was
  cleaner and safer than a generalized-but-riskier single kind.
- Confirmed again this session: **don't report a "N/N unit tests" total in
  a progress comment unless it's actually been checked against the real
  suite** — report the specific test file's own count instead (e.g. "29/29
  in `verifyLiveRelease.test.js`"), since `test-loop`'s own full-suite guard
  makes the real total expensive/blocked to verify per iteration. This
  session found and corrected a ~40x-wrong figure that had propagated
  across 5 prior comments this way.
- `.claude/skills/build-loop/local-env/` and `wrap-up`/`handoff`/`work-issue`
  overlay files are junctions into the skills-pack clone — file an issue
  against the pack repo (`DyeAllPies/dyeallpies-skills-pack`) with exact
  replacement text rather than editing directly. Confirmed again this
  session (#270, #271).
- `test-loop`'s full-suite-run guard hook fires inconsistently on different
  shapes of a bare-directory `vitest run` invocation — see #270 for the
  confirmed repro before assuming it reliably blocks every untargeted
  full-suite call.
