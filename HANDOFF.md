# HANDOFF

**Written:** 2026-08-12, end of session on `feature/docker-e2e-backend-integration`,
after Dennis said "Read handoff" then "Pick next issue".

## What happened this session

Read the prior HANDOFF.md (#548/MONDO closed, nothing queued for next).
Dennis said "Pick next issue" with no issue number — routed via
`work-issue`: no `bug`/`test-branch`-labeled candidate outranked
continuing the RF028 expansion #373 started, so checked the primary
planning doc's §7.4 "Ordem recomendada da Fase 2" for the documented
source order and picked **ORPHA**, the next single source after MONDO
within #549 (the umbrella issue for the remaining 13 Fase 2 sources).
Routed to `build-loop`.

**Built and shipped ORPHA (RF028's third Fase 2 source) this session**,
mirroring HPO (#367)/MONDO (#548)'s exact shape:

- `api/backend/src/reference-data/reference-imports/sources/orpha.js` +
  `normalizeOrpha.js`. License is fixed (`CC BY 4.0` per
  `dict-01_FONTES.md`'s `SRC_ORPHA` row). `sourceFormat` is `XML`
  (ORPHA's real distribution format per the dict has no JSON option,
  unlike HPO/MONDO's OBO/OWL/JSON/TSV) even though the bundled fixture
  is still JSONL — `pipeline.js`'s Parse stage has no other parser yet,
  and extending it was out of this slice's scope.
- `fixtures/orpha-sample.jsonl` — 8 valid + 2 intentionally-invalid
  records, same shape as `hpo-sample.jsonl`/`mondo-sample.jsonl`. Codes/
  labels are a small illustrative sample, not asserted as a verified
  snapshot of a specific official Orphanet Nomenclature Pack release
  (see the file's own header comment in `sources/orpha.js`).
- `scripts/reference-imports/import-orpha-reference-dataset.js` +
  `reference:import:orpha`/`:dry-run` npm scripts +
  `reference-data-bootstrap-orpha` compose.dev.yml service (depends on
  `reference-data-bootstrap-mondo` completing, matching §7.4's
  documented order).
- `import-large-reference-dataset.js`'s placeholder scaffold no longer
  lists `orpha` in its allowed-datasets set (graduated, same as
  HPO/MONDO) — now just `['cid', 'omim']`.
- `reference-import-boundary.arch.test.js` extended with ORPHA-mirror
  assertions (fixture-only, no live network, excluded from the
  placeholder scaffold).
- `normalizeOrpha.test.js` — 6 unit tests, mirroring
  `normalizeMondo.test.js`.
- `pipeline-continuity.spec.ts`'s RF028 describe block got a new
  ORPHA-specific assertion, reusing the already-generic
  `countReferenceDatasetReleasesByDatasetCode`/
  `countTerminologyConceptsBySystemUri` helpers (no new helper code
  needed — #548 had already generalized them).

Verified: 18/18 targeted unit tests (HPO+MONDO+ORPHA), 26/26
architecture tests natively; then (Docker-on-by-default for this loop)
brought up the real dev stack and confirmed `reference-data-bootstrap-orpha`
actually ran after `reference-data-bootstrap-mondo` — 10 records read, 8
validated, 2 rejected, 15 inserted (8 concepts + 7 `is_a` relations) —
then ran the real `pipeline-continuity.spec.ts -g "Reference data
importers"` Playwright spec against that stack: all 4 tests pass,
including the new ORPHA-specific one.

**Mid-session Docker friction, self-caused and self-corrected:** the
first `docker compose -f compose.yml -f compose.dev.yml up -d --build`
was run without `--env-file .env.docker` — compose-file-level `${VAR}`
interpolation only reads the shell env or a literal `.env`, never a
service's `env_file:` entry, so `NEO4J_AUTH: ${NEO4J_USERNAME}/${NEO4J_PASSWORD}`
resolved to a bare `/`, crashing `neo4j` in a restart loop and leaving
every dependent one-shot service (`foundation-bootstrap`,
`reference-data-bootstrap*`) stuck in `Created`. Recovered with `docker
compose down` (no `-v`, volumes preserved) + the correct invocation with
`--env-file .env.docker`, targeting the bootstrap chain directly — both
the `--env-file` requirement and the "target the chain directly" fix
were already documented in `docker-workflow`'s BioAvanceD-v2 overlay
from #548, one level away from where `build-loop` looked. Filed as
**skills-pack#254** (build-loop's Docker section should point sessions
at `docker-workflow` before the first per-iteration docker command, not
just "confirm Docker is running").

Committed on `test/549-orpha-reference-source`, merged (no-ff) into
`feature/docker-e2e-backend-integration` at `3124a647`, pushed, progress
comment posted on **#549** (left open — 12 sources remain). Also posted
a correction comment on #549: its own body claimed "#548 will have
already proven the Parse-stage extension pattern for a non-JSONL
format" — false, MONDO's fixture is still JSONL like HPO; no non-JSONL
parser exists anywhere in this repo. Local branch deleted.

`wrap-up`'s core + shipping audits found one piece of real friction
(the Docker `--env-file` gap above, filed as skills-pack#254) plus the
stale-assumption correction on #549 (not a new issue — a correction
comment on the existing one, same pattern #548 used for the Cell
Ontology correction). No lazy fixes, no scope creep outside the ORPHA
slice's files (confirmed via `git diff --stat` on the merge range), no
unresolved "needs owner call" labels closed without a matching open
issue.

**Security/safety note:** none. Product change is a data-import source
addition with a real-backend proof; no new routes, no auth changes, no
secrets introduced.

## Repo state

- **`feature/docker-e2e-backend-integration`**: at `3124a647`, clean,
  pushed, up to date with origin. Carries #549's ORPHA source on top of
  #548's MONDO and everything from prior sessions.
- Issues this session: **#549 still open** (progress comment + stale-
  assumption correction posted, tracking the remaining 12 sources).
  **skills-pack#254 filed** (pack-repo, build-loop/docker-workflow
  cross-reference gap).
- Docker: dev stack was brought up this session (after a self-corrected
  misconfiguration, see above) to verify ORPHA, then torn down via
  `clean-up` at session end. Named volumes (mongodb/neo4j data)
  untouched. Session-built images left cached, same reasoning as prior
  sessions (#549's very likely next source is an immediate rebuild
  otherwise).
- **Pre-existing dangling branches, not touched this session** (carried
  forward unchanged, 16 local + remote items — see prior handoffs for
  the full list; unchanged this session so not re-enumerated here to
  avoid drift from a list nobody re-verified).

## Which issue is next

Dennis has not explicitly said which issue to pick up next session — per
this skill's "only if the user explicitly said so" rule, nothing is
queued.

Candidates carried forward (#549 still open, not resolved):

- **#549 continuation** — next single source per §7.4 step 4's order is
  **CID-11**, then CID-10, then OMIM (the rest of step 4's group), then
  HGNC (step 5), LOINC/UCUM (step 6), DCB/ATC (step 7), DUO/Uberon/NCBI
  Taxonomy/Cell Ontology/EDAM (step 8). Same build-loop shape as
  HPO/MONDO/ORPHA, reusing `pipeline.js` as-is. Note the sourceFormat
  judgment call ORPHA's slice documented (dict-01's real format per
  source, not blindly `JSONL`) applies to each remaining source too —
  check `dict-01_FONTES.md`'s row for each before assuming.
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
- **skills-pack#233/#234/#235/#236/#237/#238/#239/#240/#241/#243/#244/#246/#247/#250/#251**
  — pack-repo only, low priority, unchanged this session.
- **skills-pack#254** — filed this session (see above), pack-repo fix,
  not this project's scope to resolve.

## Dev stack state

Torn down at session end via `clean-up` (docker domain). Named volumes
(mongodb/neo4j data) untouched — next session's `compose up` will see
the same accumulated fixture data prior sessions' gotcha already
documents, now including ORPHA's 8 concepts/7 relations alongside
HPO's/MONDO's. Images left cached — a next `compose up --build` should
be fast (cache hits) unless something invalidates a layer.

**Reminder for next session's first Docker command:** use
`docker compose --env-file .env.docker -f compose.yml -f compose.dev.yml
up -d --build <targets>` — never bare `up -d --build` — and if targeting
a reference-data bootstrap chain, target the chain services directly
(`foundation-bootstrap reference-data-bootstrap reference-data-bootstrap-mondo
reference-data-bootstrap-orpha [next-source]`), skipping `frontend`
entirely, per the overlay's documented fix.

## Which skills to use

- `work-issue` correctly found no better-ranked candidate than
  continuing #373's RF028 tree when given no specific issue; checking
  the primary doc's §7.4 for the next source order (rather than asking)
  worked smoothly, per `build-loop`'s own "check spec docs before
  asking" rule.
- `build-loop` worked as documented for the product/test side of the
  ORPHA slice — but its Docker section's gap (not pointing to
  `docker-workflow` before the first per-iteration docker command) cost
  a real redo this session. Filed as skills-pack#254; until it lands,
  manually invoke `docker-workflow` (or at least read its project
  overlay) before any `docker compose` call in a build-loop iteration.
