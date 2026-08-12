# HANDOFF

**Written:** 2026-08-12, end of session on `feature/docker-e2e-backend-integration`,
after Dennis chose "Continue #549 (DUO/Uberon/NCBI Taxonomy/Cell Ontology/EDAM)"
from an explicit menu at session start.

## What happened this session

Continued issue #549 per the prior handoff's queued candidate list —
shipped **DUO**, the twelfth of the (corrected count, see below) 16
Fase 2 reference-data sources, via `build-loop`, in the identical shape
every prior source (HPO through ATC) established:

- `sources/duo.js` + `normalizeDuo.js`, a bundled `duo-sample.jsonl`
  fixture (8 valid + 2 intentionally-invalid records), `import-duo-
  reference-dataset.js` + `reference:import:duo`/`:dry-run` npm scripts,
  a `reference-data-bootstrap-duo` compose.dev.yml service chained onto
  `reference-data-bootstrap-atc`, `reference-import-boundary.arch.test.js`
  extended with a mirror pair of assertions, `normalizeDuo.test.js`
  (6 unit tests), and a new per-source assertion in
  `pipeline-continuity.spec.ts`'s RF028 describe block.
- **Judgment calls, checked directly against `dict-01_FONTES.md`'s
  SRC_DUO row rather than assumed:** `sourceFormat` `OWL` (row lists
  "OWL/OBO/Git" — OWL is the genuine distribution format; third source
  in this loop to introduce a format outside JSON/XML, after LOINC's CSV
  and DCB's XLSX). `systemUri` `http://purl.obolibrary.org/obo/duo.owl`
  — DUO's real OBO Foundry PURL, same well-established convention
  HPO/MONDO already used (not a DCB/ORPHA-style row-URL fallback, since
  DUO genuinely has a canonical OBO PURL even though the dict row's own
  "URL de download" column points at the GitHub source repo instead).
  `license` `'Licença do repositório'` (row's literal text, pending
  verification at real-download time — same shape as HPO's license
  string). First source with `semanticType: 'consent'`.
- Fixture content: real GA4GH DUO permission-hierarchy terms (root
  `DUO:0000001` "data use permission" plus 5 genuine primary/narrower
  permission categories) + 2 disclosed fabricated placeholder leaves —
  same disclosed-fabrication pattern DCB/ATC used, except DUO's real
  ontology already has a true single root, so (unlike DCB/ATC) no
  fabricated root ID was needed.

Verified: 6 targeted unit tests (vitest, direct file target — see
friction note below) + full architecture suite (45→47) natively; then
(Docker-on-by-default for this loop) the real dev stack brought up
targeting the bootstrap chain directly (thirteen links deep now,
`foundation-bootstrap` through `reference-data-bootstrap-duo`) — clean
on the first try, 10 records read / 8 validated / 2 rejected / 15
inserted; then the real `pipeline-continuity.spec.ts -g "Reference data
importers"` Playwright spec against that stack (12→13 passing tests).

Own branch `test/549-duo-reference-source`, committed, merged (no-ff)
into `feature/docker-e2e-backend-integration`, pushed (`04fecf80`),
progress comment posted on #549.

**One documentation-accuracy finding filed this session (not this
slice's scope to fix):** `compose.dev.yml`'s bootstrap-chain comments
(HPO through ATC, 11 occurrences) all say "one of the 14 Fase 2
sources" — counting `3-Plano_Integrado_Foundation_Data_Pipeline.md`
§7.4's own recommended order (steps 2–8) gives **16**, not 14. This
session's new DUO comment avoids repeating the wrong figure (says
"twelfth of the Fase 2 sources" with no total asserted) but didn't go
back and fix the 11 prior comments — filed as **issue #553**
(`documentation` label), suggested to fix once all 16 sources are
operational (4 remain: Uberon, NCBI Taxonomy, Cell Ontology, EDAM).

`wrap-up`'s core + shipping audits found the one finding above (filed)
and nothing else — `git diff --stat` for the DUO commit confirmed the
entire 10-file/308-line diff is scoped to the reference-imports feature
(source config, normalizer, fixture, import script, npm scripts,
compose.dev.yml service, arch test, unit test, pipeline-continuity.spec.ts
assertion) — no scope creep, no lazy fixes, no unresolved "needs owner
call" labels closed without a matching open issue.

**Security/safety note:** none. One more data-import source addition,
same shape as every prior RF028 source — no new routes, no auth changes,
no secrets introduced.

## Repo state

- **`feature/docker-e2e-backend-integration`**: at `04fecf80`, clean,
  pushed, up to date with origin. Carries #549's DUO source on top of
  everything from prior sessions (HPO, MONDO, ORPHA, ICD-11, ICD-10,
  OMIM, HGNC, LOINC, UCUM, DCB, ATC).
- Issues this session: **#549 still open** (progress comment posted,
  tracking the remaining 4 sources). **#553 filed** (product-repo,
  compose.dev.yml comment count inaccuracy, documentation-only).
- Docker: dev stack was brought up and torn down (`docker compose
  down`, no `-v`) once this session, targeting the bootstrap chain
  directly through `reference-data-bootstrap-duo`. Named volumes
  (mongodb/neo4j data) untouched. Session-built images left cached,
  same reasoning as prior sessions (#549's next source, Uberon, is an
  immediate rebuild otherwise).
- **Pre-existing dangling branches, not touched this session** (carried
  forward unchanged, 16 local + remote items — see earlier handoffs for
  the full list; unchanged this session so not re-enumerated here to
  avoid drift from a list nobody re-verified).

## Which issue is next

Dennis has not explicitly said which issue to pick up next session — per
this skill's "only if the user explicitly said so" rule, nothing is
queued.

Candidates carried forward (#549 still open, not resolved):

- **#549 continuation** — next per §7.4 step 8 is **Uberon** (second of
  the final five: DUO done, Uberon/NCBI Taxonomy/Cell Ontology/EDAM
  remain). Same build-loop shape as every source shipped so far, reusing
  `pipeline.js` as-is. Check `dict-01_FONTES.md`'s `SRC_UBERON` row
  directly (don't assume from this handoff) for `sourceFormat`/
  `license`/`systemUri` — every prior slice has needed its own
  per-source judgment call there, even when the pattern looks
  predictable. This session's own read of the row (line 47): `Formatos/
  Interface` = "OWL/OBO" (same as DUO — expect `sourceFormat: ['OWL']`
  again, no new format-type judgment call needed); `URL de download` =
  `http://purl.obolibrary.org/obo/uberon.owl` (a genuine OBO Foundry
  PURL already present directly in the row this time, unlike DUO's row
  which only had the GitHub source link); `Licença/termos` = "Licença
  indicada no OBO Foundry" (verify-at-OBO-Foundry style, similar
  shape to DUO's "Licença do repositório"). `semanticType` will need a
  new value — Uberon is anatomy (`Não usar para` column: "Tipo celular
  ou diagnóstico"), so something like `'anatomy'` or `'body-site'` (not
  yet used by any prior source — pick one and stay consistent for Cell
  Ontology's likely-adjacent `'cell-type'` value next).
- **#550/#551/#552** — independent of #549, can be picked up in any
  order once #367 (satisfied) is the only real dependency.
- **#530** — `dictionary:validate` isn't wired into `ci-pipeline.yml`.
  Unrelated to the RF028 cluster, still open.
- **#489** — full-suite vitest flakiness (JWT/encryption-secret failure
  shape, ~89 files), open, not re-confirmed.
- **#336** — still open: is `import.controller.js#importFhirBundle` dead
  code to remove, or does something still call it?
- **#553** — filed this session: `compose.dev.yml`'s "14 Fase 2 sources"
  comments undercount the real total (16). Low priority, fix once all
  16 sources are operational (suggested target: after EDAM closes out
  step 8).
- Older backlog, unchanged: `#371`/`#374`/`#378`/`#379`, `#368`, `#345`,
  `#341`/`#340`, `#334`, `#331`/`#326`/`#325`, `#321`, `#319`, `#286`,
  `#284`, `#283`, `#282`, `#228`, `#115`, next e2e slice per
  `E2E_TRACEABILITY_PLAN.md`.
- **skills-pack#233/#234/#235/#236/#237/#238/#239/#240/#241/#243/#244/#246/#247/#250/#251/#254/#259**
  — pack-repo only, low priority, unchanged this session.

## Dev stack state

Torn down at session end (`docker compose down`, no `-v`). Named volumes
(mongodb/neo4j data) untouched — next session's `compose up` will see
the same accumulated fixture data prior sessions' gotcha already
documents, now including DUO's concepts/relations alongside every prior
source's. Images left cached — a next `compose up --build` should be
fast (cache hits) unless something invalidates a layer.

**Reminder for next session's first Docker command:** use
`docker compose --env-file .env.docker -f compose.yml -f compose.dev.yml
up -d --build <targets>` — never bare `up -d --build` — and if targeting
a reference-data bootstrap chain, target the chain services directly
(`foundation-bootstrap reference-data-bootstrap reference-data-bootstrap-mondo
reference-data-bootstrap-orpha reference-data-bootstrap-icd11
reference-data-bootstrap-icd10 reference-data-bootstrap-omim
reference-data-bootstrap-hgnc reference-data-bootstrap-loinc
reference-data-bootstrap-ucum reference-data-bootstrap-dcb
reference-data-bootstrap-atc reference-data-bootstrap-duo [next-source]`),
skipping `frontend` entirely, per the overlay's documented fix — this ran
clean on the first try again this session, thirteen links deep now.

**Reminder for a manual Playwright run against the dev stack:** on top
of the documented `E2E_MONGO_URI`/`E2E_MONGO_DB`/Neo4j-creds env vars,
also set `PLAYWRIGHT_BASE_URL=http://localhost:5173`,
`PLAYWRIGHT_API_BASE_URL=http://localhost:3000`, and
`PLAYWRIGHT_SKIP_WEBSERVER=1` — otherwise Playwright's own `webServer`
config tries (and fails, on this machine's Windows-reserved port range)
to launch a second frontend dev server on 5173. See skills-pack#258
(resolved per Dennis, underlying gotcha unchanged).

## Which skills to use

- `build-loop` worked smoothly end-to-end again this session, including
  the Docker section — chain targeting worked on the first
  `up -d --build`, thirteen links deep by the end.
- `docker-workflow`'s BioAvanceD-v2 overlay's documented fixes
  (env-file, chain-targeting) continue to hold across sessions and
  across many more chain links than when first documented — worth
  reconfirming as a strong pattern, not just a lesson learned once.
- The `full-suite-guard.cjs` directory-target threshold friction from
  the prior session (skills-pack#259, filed, unresolved) didn't recur
  this session because the targeted unit-test run used the explicit
  single-file path (`npx vitest run tests/unit/reference-imports/
  normalizeDuo.test.js`) rather than the directory target — the
  workaround documented in that prior handoff, still needed until the
  pack fix lands.
