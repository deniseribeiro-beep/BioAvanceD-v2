# HANDOFF

**Written:** 2026-08-12, end of session on `feature/docker-e2e-backend-integration`,
after Dennis said "Skills pack issues are resolved. See how much you can
do of #549 in a consistent manner."

## What happened this session

Continued issue #549 per the prior handoff's queued candidate (OMIM),
then kept going — six sources shipped back-to-back this session, all via
`build-loop`, all in the identical shape HPO/MONDO/ORPHA/ICD-11/ICD-10
established in prior sessions:

1. **OMIM** (sixth source, closes §7.4 step 4's "ORPHA, CID-11, CID-10 e
   OMIM" group). `sourceFormat` `JSON` (OMIM's REST API documents a JSON
   response option, per dict-01's ambiguous "API/arquivos autorizados"
   row). `license` `'Termos OMIM; conteúdo narrativo restrito'`.
   **Judgment call carried from the prior handoff:** SRC_OMIM's row is
   the first of these sources requiring an API key/license
   (`Chave/API/licença`) for real access — doesn't change this slice's
   shape (every source stays a bundled-fixture, no-live-network import),
   just a note for #550's future live-download scope.
2. **HGNC** (seventh, §7.4 step 5). `sourceFormat` `JSON`, directly
   listed in the row ("TSV/JSON/REST") — no special-case reasoning
   needed. First source with `semanticType: 'gene'` rather than
   disease/phenotype.
3. **LOINC** (eighth, §7.4 step 6, leads the LOINC/UCUM pair).
   `sourceFormat` `CSV` — first source to use CSV, directly listed in
   the row ("CSV/RELMA/API/FHIR"). `systemUri`
   `http://loinc.org` (HL7 FHIR standard, no judgment call).
   `semanticType: 'observation'`.
4. **UCUM** (ninth, §7.4 step 6, closes the pair). `sourceFormat` `XML`
   (row: "XML/especificação", no JSON option). `systemUri`
   `http://unitsofmeasure.org` (HL7 FHIR standard). `semanticType:
   'unit'`.
5. **DCB** (tenth, §7.4 step 7, leads the DCB/ATC pair). `sourceFormat`
   `XLSX`, directly listed ("XLSX/PDF/portal") — second source outside
   JSON/XML. `systemUri` is dict-01's own official URL for SRC_DCB (no
   FHIR-standard URI exists for a Brazil-specific nomenclature).
   `semanticType: 'medication'`.
6. **ATC** (eleventh, §7.4 step 7, closes the pair). `sourceFormat`
   `XML` (row: "Portal/XML/XLSX conforme aquisição"). `systemUri`
   `http://www.whocc.no/atc` (HL7 FHIR standard). `semanticType:
   'medication'`, same as DCB.

Each slice: `sources/<x>.js` + `normalizeX.js`, a bundled
`<x>-sample.jsonl` fixture (8 valid + 2 intentionally-invalid records —
mixing real, publicly-known identifiers/labels for the source with a
few fabricated placeholders where needed, always disclosed in the source
config's own comment), `import-<x>-reference-dataset.js` +
`reference:import:<x>`/`:dry-run` npm scripts, a
`reference-data-bootstrap-<x>` compose.dev.yml service chained onto the
prior source, `reference-import-boundary.arch.test.js` extended with a
mirror pair of assertions, `normalizeX.test.js` (6 unit tests), and a new
per-source assertion in `pipeline-continuity.spec.ts`'s RF028 describe
block.

Verified per slice: targeted unit tests (grew 30→45 across the session)
+ full architecture suite (32→45) natively; then (Docker-on-by-default
for this loop) the real dev stack brought up targeting the bootstrap
chain directly (chain-targeting fix from #548/#549 held clean across all
six new links — twelve deep by session end, first-try clean every time)
confirming each new `reference-data-bootstrap-<x>` service ran after its
predecessor (10 records read, 8 validated, 2 rejected, 15 inserted each
time); then the real `pipeline-continuity.spec.ts -g "Reference data
importers"` Playwright spec against that stack (grew 6→12 passing tests
across the session, including each new per-source assertion).

Each source: its own `test/549-<source>-reference-source` branch off
`feature/docker-e2e-backend-integration`, committed, merged (no-ff),
pushed, individual progress comment posted on #549. (One progress
comment had an arithmetic slip — said "4 sources remain" then listed
5 — corrected with an immediate follow-up comment.)

**One piece of real friction this session, filed against the pack (not
this project's own scope to fix):** `full-suite-guard.cjs`'s
directory-target vitest run (`npx vitest run
tests/unit/reference-imports/`) passed cleanly for the first two slices
(8 then 9 files in that directory), then started getting blocked
partway through the session once the directory crossed 10 files — no
code change on this session's side, the same command just crossed some
file-count threshold. Filed as **skills-pack#259**, including the exact
overlay text for a pack session to add to `unit-test-loop`'s
BioAvanceD-v2 `local-env` file (workaround used this session: switch to
listing the explicit test files, which the hook accepts regardless of
directory size).

Stopped deliberately after ATC — a clean §7.4 step 7 boundary — rather
than continuing to step 8 (DUO, Uberon, NCBI Taxonomy, Cell Ontology,
EDAM — 5 more sources, bringing the total Fase 2 source count to 16).
Not a blocker, just a natural pause point after six iterations.

`wrap-up`'s core + shipping audits found the one friction above (filed)
and nothing else — `git diff --stat` from session start (`d037c32b`) to
the final merge (`0a9cbdb0`) confirmed the entire 36-file/1819-line diff
is scoped to the reference-imports feature (source configs, normalizers,
fixtures, import scripts, npm scripts, compose.dev.yml services, arch
tests, unit tests, pipeline-continuity.spec.ts assertions) plus the one
package.json edit for npm scripts — no scope creep, no lazy fixes, no
unresolved "needs owner call" labels closed without a matching open
issue.

**Security/safety note:** none. Six more data-import source additions,
same shape as every prior RF028 source — no new routes, no auth changes,
no secrets introduced.

## Repo state

- **`feature/docker-e2e-backend-integration`**: at `0a9cbdb0`, clean,
  pushed, up to date with origin. Carries #549's OMIM/HGNC/LOINC/UCUM/
  DCB/ATC sources on top of everything from prior sessions (HPO, MONDO,
  ORPHA, ICD-11, ICD-10).
- Issues this session: **#549 still open** (six progress comments
  posted, tracking the remaining 5 sources). **skills-pack#259 filed**
  (pack-repo, full-suite-guard.cjs directory-target threshold gap).
- Docker: dev stack was brought up and torn down (`docker compose down`,
  no `-v`) six times this session, once per slice — each verification
  run targeted the growing bootstrap chain directly, then torn down
  before starting the next slice's implementation. Named volumes
  (mongodb/neo4j data) untouched. Session-built images left cached, same
  reasoning as prior sessions (#549's very likely next source, DUO, is
  an immediate rebuild otherwise).
- **Pre-existing dangling branches, not touched this session** (carried
  forward unchanged, 16 local + remote items — see earlier handoffs for
  the full list; unchanged this session so not re-enumerated here to
  avoid drift from a list nobody re-verified).

## Which issue is next

Dennis has not explicitly said which issue to pick up next session — per
this skill's "only if the user explicitly said so" rule, nothing is
queued.

Candidates carried forward (#549 still open, not resolved):

- **#549 continuation** — next per §7.4 step 8 is **DUO, Uberon, NCBI
  Taxonomy, Cell Ontology, and EDAM** (5 sources, closing out all of
  Fase 2's 16 total sources). Same build-loop shape as every source
  shipped so far, reusing `pipeline.js` as-is. Check each source's own
  `dict-01_FONTES.md` row (`SRC_DUO`, `SRC_UBERON`, `SRC_NCBITAX`,
  `SRC_CL`, `SRC_EDAM` — all captured in this session's read of the
  file, rows 42/46-49) for `sourceFormat`/`license`/`systemUri` rather
  than assuming a pattern from the six done this session — every prior
  slice has needed its own per-source judgment call there. Quick
  read from this session's dict-01 pass: DUO is `OWL/OBO/Git` (no JSON
  — likely another XML/special-case reasoning, or introduce 'OWL' the
  way LOINC introduced CSV/DCB introduced XLSX); Uberon and Cell
  Ontology are both `OWL/OBO` (same shape as DUO); NCBI Taxonomy is
  `Taxdump/REST/JSON` (JSON genuinely listed); EDAM is `OWL` only. All
  five have well-known real-world systemUris (DUO:
  `http://purl.obolibrary.org/obo/duo.owl`-style OBO Foundry PURLs,
  same pattern HPO/MONDO already used) — shouldn't need OMIM/HGNC/DCB's
  domain-based judgment call. When writing each one's removal-rationale
  comment (if any placeholder token needs removing from
  `import-large-reference-dataset.js` — unlikely, since that scaffold's
  `allowedDatasets` set is already fully empty as of the OMIM slice),
  avoid quoting the token itself in single/double quotes in the prose —
  see skills-pack#257 (resolved per Dennis, but the underlying trap in
  the arch test itself is unchanged).
- **#550/#551/#552** — independent of #549, can be picked up in any
  order once #367 (satisfied) is the only real dependency.
- **#530** — `dictionary:validate` isn't wired into `ci-pipeline.yml`.
  Unrelated to the RF028 cluster, still open.
- **#489** — full-suite vitest flakiness (JWT/encryption-secret failure
  shape, ~89 files), open, not re-confirmed.
- **#336** — still open: is `import.controller.js#importFhirBundle` dead
  code to remove, or does something still call it?
- Older backlog, unchanged: `#371`/`#374`/`#378`/`#379`, `#368`, `#345`,
  `#341`/`#340`, `#334`, `#331`/`#326`/`#325`, `#321`, `#319`, `#286`,
  `#284`, `#283`, `#282`, `#228`, `#115`, next e2e slice per
  `E2E_TRACEABILITY_PLAN.md`.
- **skills-pack#233/#234/#235/#236/#237/#238/#239/#240/#241/#243/#244/#246/#247/#250/#251/#254**
  — pack-repo only, low priority, unchanged this session.
- **skills-pack#259** — filed this session (see above), pack-repo fix,
  not this project's scope to resolve.

## Dev stack state

Torn down at session end (`docker compose down`, no `-v`). Named volumes
(mongodb/neo4j data) untouched — next session's `compose up` will see
the same accumulated fixture data prior sessions' gotcha already
documents, now including all six of this session's sources' concepts/
relations alongside HPO's/MONDO's/ORPHA's/ICD-11's/ICD-10's. Images left
cached — a next `compose up --build` should be fast (cache hits) unless
something invalidates a layer.

**Reminder for next session's first Docker command:** use
`docker compose --env-file .env.docker -f compose.yml -f compose.dev.yml
up -d --build <targets>` — never bare `up -d --build` — and if targeting
a reference-data bootstrap chain, target the chain services directly
(`foundation-bootstrap reference-data-bootstrap reference-data-bootstrap-mondo
reference-data-bootstrap-orpha reference-data-bootstrap-icd11
reference-data-bootstrap-icd10 reference-data-bootstrap-omim
reference-data-bootstrap-hgnc reference-data-bootstrap-loinc
reference-data-bootstrap-ucum reference-data-bootstrap-dcb
reference-data-bootstrap-atc [next-source]`), skipping `frontend`
entirely, per the overlay's documented fix — this ran clean on the first
try six times in a row this session, twelve links deep now.

**Reminder for a manual Playwright run against the dev stack:** on top
of the documented `E2E_MONGO_URI`/`E2E_MONGO_DB`/Neo4j-creds env vars,
also set `PLAYWRIGHT_BASE_URL=http://localhost:5173`,
`PLAYWRIGHT_API_BASE_URL=http://localhost:3000`, and
`PLAYWRIGHT_SKIP_WEBSERVER=1` — otherwise Playwright's own `webServer`
config tries (and fails, on this machine's Windows-reserved port range)
to launch a second frontend dev server on 5173. See skills-pack#258
(resolved per Dennis, underlying gotcha unchanged).

## Which skills to use

- `build-loop` worked smoothly end-to-end across all six iterations this
  session, including the Docker section every time — chain targeting
  worked on the first `up -d --build` all six times, twelve links deep
  by the end. One gap surfaced mid-session and was filed against the
  pack rather than reworked ad hoc: skills-pack#259
  (`full-suite-guard.cjs`'s directory-target threshold not documented
  anywhere, so a session hitting it mid-loop has to re-diagnose from
  scratch).
- `docker-workflow`'s BioAvanceD-v2 overlay's documented fixes
  (env-file, chain-targeting) continue to hold across sessions and
  across many more chain links than when first documented — worth
  reconfirming as a strong pattern, not just a lesson learned once.
- Running six build-loop iterations back-to-back in one session (rather
  than one per session) worked cleanly — each iteration's own
  branch/commit/merge/push/verify/comment cycle is fully
  self-contained, so there was no cross-iteration state bleed to manage
  beyond the compose chain naturally growing by one link each time.
