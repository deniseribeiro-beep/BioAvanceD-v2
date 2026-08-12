# HANDOFF

**Written:** 2026-08-12, end of session on `feature/docker-e2e-backend-integration`,
after Dennis said "Skills pack issues are resolved. Continue #549."

## What happened this session

Continued issue #549 per the prior handoff's queued candidate: next
single source per §7.4 step 4's order after ICD-11 is **ICD-10** (CID-10
in the dictionary's Portuguese-plan naming). Routed to `build-loop`.

**Built and shipped ICD-10 (RF028's fifth Fase 2 source) this session**,
mirroring HPO (#367)/MONDO (#548)/ORPHA/ICD-11 (#549 prior slices)'s
exact shape:

- `api/backend/src/reference-data/reference-imports/sources/icd10.js` +
  `normalizeIcd10.js`. `sourceFormat` is `XML` per `dict-01_FONTES.md`'s
  `SRC_ICD10` row — its Formato column is "Browser/arquivos licenciados"
  (no JSON option listed, unlike ICD-11's "REST/JSON/Browser"), so this
  follows ORPHA's XML special-case precedent rather than
  HPO/MONDO/ICD-11's JSONL justification. `license` is
  `'Termos WHO/edição nacional'`, the row's own literal value (distinct
  from ICD-11's `'Termos WHO'`); `licenseUri` stays `null` pending #550's
  live download/license-verification follow-up. `systemUri` is the HL7
  FHIR standard ICD-10 system URI (`http://hl7.org/fhir/sid/icd-10`).
- `fixtures/icd10-sample.jsonl` — 8 valid + 2 intentionally-invalid
  records, same shape as the prior sources' fixtures. Illustrative
  ICD-10 codes/labels (an "illness, unspecified" root plus two
  chapter-range branches — `A00-B99`, `C00-D48`), not asserted as a
  verified snapshot of any real ICD-10 edition.
- `scripts/reference-imports/import-icd10-reference-dataset.js` +
  `reference:import:icd10`/`:dry-run` npm scripts +
  `reference-data-bootstrap-icd10` compose.dev.yml service (depends on
  `reference-data-bootstrap-icd11` completing, matching §7.4's
  documented order).
- **Closed out the ICD-11 slice's deferred judgment call:**
  `import-large-reference-dataset.js`'s placeholder scaffold now
  **removes `'cid'`** from its allowed-datasets set (it now only lists
  `'omim'`) — the shared CID-11/CID-10 placeholder token is no longer
  needed now that both have their own operational scripts, mirroring
  HPO/MONDO/ORPHA/ICD-11's own removals.
- `reference-import-boundary.arch.test.js` extended with ICD-10-mirror
  assertions (fixture-only, no live network) plus an updated
  "large import scaffold no longer lists cid or icd10" test.
- `normalizeIcd10.test.js` — 6 unit tests, mirroring
  `normalizeIcd11.test.js`/`normalizeOrpha.test.js`.
- `pipeline-continuity.spec.ts`'s RF028 describe block got a new
  ICD-10-specific assertion, reusing the already-generic
  `countReferenceDatasetReleasesByDatasetCode`/
  `countTerminologyConceptsBySystemUri` helpers (no new helper code
  needed).

Verified: 30/30 targeted unit tests (HPO+MONDO+ORPHA+ICD11+ICD10), 16/16
`reference-import-boundary` arch assertions (32/32 full arch suite)
natively; then (Docker-on-by-default for this loop) brought up the real
dev stack targeting the bootstrap chain directly (per the documented
`--env-file`/chain-targeting fix from #548, now carried through six
chain links) and confirmed `reference-data-bootstrap-icd10` ran after
`reference-data-bootstrap-icd11` — 10 records read, 8 validated, 2
rejected, 15 inserted (8 concepts + 7 `is_a` relations) — then ran the
real `pipeline-continuity.spec.ts -g "Reference data importers"`
Playwright spec against that stack: all 6 tests pass, including the new
ICD-10-specific one. The compose chain drove through cleanly on the
first `up -d --build` call again this session — the documented fix keeps
holding across every new link added to the chain.

**Two pieces of real friction this session, both self-caused, both
filed against the pack (not this project's own scope to fix, since both
overlays are junctioned in):**

1. Writing the removal-rationale comment for `import-large-
   reference-dataset.js`'s `'cid'` token (explaining *why* it was
   removed) accidentally used `'cid'` in quotes in the prose itself —
   which is exactly the shape `reference-import-boundary.arch.test.js`'s
   `doesNotMatch(/['"]cid['"]/)` check matches against. The arch test
   failed against its own explanatory comment, not the code, and took a
   moment to trace. Filed as **skills-pack#257** (will recur for every
   future Fase-2-source token removal — OMIM next).
2. Running `pipeline-continuity.spec.ts` manually against the dev stack
   failed immediately on `listen EACCES: permission denied 0.0.0.0:5173`
   — Playwright's own `webServer` config trying to launch the frontend
   dev server (unrelated to the already-healthy Docker stack). Needed
   `PLAYWRIGHT_SKIP_WEBSERVER=1` (which `package.json`'s `test:e2e:docker`
   script already sets, but wasn't called out in the docker-workflow
   overlay's "Connecting Playwright to the dev stack manually" section).
   Filed as **skills-pack#258**.

Committed on `test/549-icd10-reference-source`, merged (no-ff) into
`feature/docker-e2e-backend-integration` at `d25c9d20`, pushed, progress
comment posted on **#549** (left open — 10 sources remain, next is
OMIM).

`wrap-up`'s core + shipping audits found the two frictions above (both
filed) and nothing else — no scope creep outside the ICD-10 slice's
files (confirmed via `git diff --stat` against the merge), no lazy
fixes, no unresolved "needs owner call" labels closed without a matching
open issue.

**Security/safety note:** none. Product change is a data-import source
addition with a real-backend proof; no new routes, no auth changes, no
secrets introduced.

## Repo state

- **`feature/docker-e2e-backend-integration`**: at `d25c9d20`, clean,
  pushed, up to date with origin. Carries #549's ICD-10 source on top of
  ICD-11/ORPHA/MONDO and everything from prior sessions.
- Issues this session: **#549 still open** (progress comment posted,
  tracking the remaining 10 sources). **skills-pack#257 filed**
  (pack-repo, arch-test self-tripping-comment trap). **skills-pack#258
  filed** (pack-repo, `PLAYWRIGHT_SKIP_WEBSERVER` doc gap). Per Dennis at
  session start, all skills-pack issues from the *prior* session
  (including #255, the CID→ICD naming trap) are already resolved.
- Docker: dev stack was brought up this session to verify ICD-10, then
  torn down (`docker compose down`, no `-v`) at session end. Named
  volumes (mongodb/neo4j data) untouched. Session-built images left
  cached, same reasoning as prior sessions (#549's very likely next
  source, OMIM, is an immediate rebuild otherwise).
- **Pre-existing dangling branches, not touched this session** (carried
  forward unchanged, 16 local + remote items — see earlier handoffs for
  the full list; unchanged this session so not re-enumerated here to
  avoid drift from a list nobody re-verified).

## Which issue is next

Dennis has not explicitly said which issue to pick up next session — per
this skill's "only if the user explicitly said so" rule, nothing is
queued.

Candidates carried forward (#549 still open, not resolved):

- **#549 continuation** — next single source per §7.4 step 4's order is
  **OMIM** (closing out step 4's "ORPHA, CID-11, CID-10 e OMIM" group),
  then HGNC (step 5), LOINC/UCUM (step 6), DCB/ATC (step 7),
  DUO/Uberon/NCBI Taxonomy/Cell Ontology/EDAM (step 8). Same build-loop
  shape as HPO/MONDO/ORPHA/ICD11/ICD10, reusing `pipeline.js` as-is. Two
  things this slice should carry: (1) OMIM's `dict-01_FONTES.md` row is
  already `SRC_OMIM` — no CID/ICD-style naming trap expected there, but
  re-check anyway; (2) OMIM's row shows `Chave/API/licença` under
  autenticação (needs a key/license), unlike HPO/MONDO/ORPHA/ICD-11/
  ICD-10's open-access rows — this is likely to force a real judgment
  call about whether the bundled-sample-fixture pattern still applies
  cleanly, or whether the license-gated nature of OMIM's real API needs
  a different treatment/note than the previous five sources. Also
  re-check `sourceFormat`/`license` against OMIM's own dict-01 row rather
  than assuming JSONL/a fixed license value, per the same per-source
  judgment call every prior slice has documented. When writing the
  removal-rationale comment for OMIM's own placeholder token in
  `import-large-reference-dataset.js`, avoid quoting the token itself in
  single/double quotes in the prose — see skills-pack#257.
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
- **skills-pack#257/#258** — filed this session (see above), pack-repo
  fix, not this project's scope to resolve.

## Dev stack state

Torn down at session end (`docker compose down`, no `-v`). Named volumes
(mongodb/neo4j data) untouched — next session's `compose up` will see
the same accumulated fixture data prior sessions' gotcha already
documents, now including ICD-10's 8 concepts/7 relations alongside
HPO's/MONDO's/ORPHA's/ICD-11's. Images left cached — a next
`compose up --build` should be fast (cache hits) unless something
invalidates a layer.

**Reminder for next session's first Docker command:** use
`docker compose --env-file .env.docker -f compose.yml -f compose.dev.yml
up -d --build <targets>` — never bare `up -d --build` — and if targeting
a reference-data bootstrap chain, target the chain services directly
(`foundation-bootstrap reference-data-bootstrap reference-data-bootstrap-mondo
reference-data-bootstrap-orpha reference-data-bootstrap-icd11
reference-data-bootstrap-icd10 [next-source]`), skipping `frontend`
entirely, per the overlay's documented fix — this ran clean on the first
try again this session, six links deep into the chain now.

**Reminder for a manual Playwright run against the dev stack:** on top
of the documented `E2E_MONGO_URI`/`E2E_MONGO_DB`/Neo4j-creds env vars,
also set `PLAYWRIGHT_BASE_URL=http://localhost:5173`,
`PLAYWRIGHT_API_BASE_URL=http://localhost:3000`, and
`PLAYWRIGHT_SKIP_WEBSERVER=1` — otherwise Playwright's own `webServer`
config tries (and fails, on this machine's Windows-reserved port range)
to launch a second frontend dev server on 5173. See skills-pack#258.

## Which skills to use

- `build-loop` worked smoothly end-to-end this session, including the
  Docker section — chain targeting worked on the first `up -d --build`
  again, six links deep. Two small gaps surfaced and were filed against
  the pack rather than reworked ad hoc: skills-pack#257 (arch-test
  self-tripping removal comment) and skills-pack#258
  (`PLAYWRIGHT_SKIP_WEBSERVER` missing from the manual-Playwright-run
  doc).
- `docker-workflow`'s BioAvanceD-v2 overlay's documented fixes (env-file,
  chain-targeting) continue to hold across sessions once written down —
  worth noting as a confirmation, not just a lesson learned once.
