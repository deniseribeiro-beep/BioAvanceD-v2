# HANDOFF

**Written:** 2026-08-12, end of session on `feature/docker-e2e-backend-integration`,
after Dennis said "Continue 549" (which the prior handoff had queued as
the top candidate, next source NCBI Taxonomy).

## What happened this session

Continued issue #549 per the prior handoff's queued next-source pointer —
shipped **NCBI Taxonomy**, the fourteenth of the 16 Fase 2 reference-data
sources, via `build-loop`, in the identical shape every prior source
(HPO through Uberon) established:

- `sources/ncbitax.js` + `normalizeNcbitax.js`, a bundled
  `ncbitax-sample.jsonl` fixture (8 valid + 2 intentionally-invalid
  records), `import-ncbitax-reference-dataset.js` +
  `reference:import:ncbitax`/`:dry-run` npm scripts, a
  `reference-data-bootstrap-ncbitax` compose.dev.yml service chained onto
  `reference-data-bootstrap-uberon`, `reference-import-boundary.arch.test.js`
  extended with a mirror pair of assertions, `normalizeNcbitax.test.js`
  (6 unit tests), and a new per-source assertion in
  `pipeline-continuity.spec.ts`'s RF028 describe block.
- **Judgment calls, checked directly against `dict-01_FONTES.md`'s
  SRC_NCBITAX row (line 46) rather than assumed:** `sourceFormat` `JSON`
  — the row lists "Taxdump/REST/JSON", and JSON is a genuine listed
  option, so this followed HPO/MONDO/ICD-11/HGNC's precedent (pick JSON
  when the row lists it as a real option) rather than DUO/Uberon's OWL
  special-case (their rows had no JSON option at all). `systemUri`
  `http://purl.obolibrary.org/obo/ncbitaxon.owl` — NCBI Taxonomy is a
  registered OBO Foundry ontology (`ncbitaxon`) with its own canonical
  PURL; the row's own "URL de informação"/API-doc URLs
  (`ncbi.nlm.nih.gov/taxonomy`, the REST API docs page) are NCBI's own
  web pages, not a canonical systemUri, so this needed the same
  HPO/MONDO/DUO-style convention judgment call the handoff flagged in
  advance, confirmed correct once the row was read directly. `license`
  `'Termos NCBI'` (row's literal text, same shape as ICD-11's "Termos
  WHO", pending verification at real-download time). First source with
  `semanticType: 'organism'`, matching the row's own "Organismos" domain
  column and its "Não usar para: Anatomia ou tipo celular" note (those
  stay Uberon's and Cell Ontology's, the next source in this group).
- Fixture content: real, publicly-known NCBI Taxonomy nodes — the genuine
  root (TaxID `1` "root") plus its four genuine top-level children
  (`131567` "cellular organisms", `10239` "Viruses", `28384` "other
  sequences", `12908` "unclassified sequences") and one genuine deeper
  child of "cellular organisms" (`2759` "Eukaryota") — plus 2 disclosed
  fabricated placeholder leaves (TaxID `9000001`/`9000002`, chosen well
  above any taxid NCBI has assigned to date), same disclosed-fabrication
  pattern DCB/ATC/DUO/Uberon used. Like DUO/Uberon, NCBI Taxonomy's real
  hierarchy already has a single true root, so no fabricated root ID was
  needed.

Verified: 6 targeted unit tests (vitest, direct file target) + full
architecture suite (49→51) natively; then (Docker-on-by-default for this
loop) the real dev stack brought up targeting the bootstrap chain
directly (fifteen links deep now, `foundation-bootstrap` through
`reference-data-bootstrap-ncbitax`) — clean on the first try, 10 records
read / 8 validated / 2 rejected / 15 inserted; then the real
`pipeline-continuity.spec.ts -g "Reference data importers"` Playwright
spec against that stack (14→15 passing tests).

Own branch `test/549-ncbitax-reference-source`, committed, merged (no-ff)
into `feature/docker-e2e-backend-integration`, pushed (`fe785233`),
progress comment posted on #549.

**No workflow-mechanics findings filed this session.** `wrap-up`'s core
audit found nothing to report — the slice matched the established
14-source pattern exactly, every judgment call was anticipated by the
prior handoff and resolved directly against `dict-01_FONTES.md`, and the
Docker chain-targeting fix (`docker-workflow`'s BioAvanceD-v2 overlay)
worked on the first try again, now fifteen links deep. `git diff --stat`
for the merge confirmed the entire 10-file/315-line diff is scoped to
the reference-imports feature (source config, normalizer, fixture,
import script, npm scripts, compose.dev.yml service, arch test, unit
test, pipeline-continuity.spec.ts assertion) — no scope creep, no lazy
fixes, no unresolved "needs owner call" labels closed without a matching
open issue.

**Security/safety note:** none. One more data-import source addition,
same shape as every prior RF028 source — no new routes, no auth changes,
no secrets introduced.

## Repo state

- **`feature/docker-e2e-backend-integration`**: at `fe785233`, clean,
  pushed, up to date with origin. Carries #549's NCBI Taxonomy source on
  top of everything from prior sessions (HPO, MONDO, ORPHA, ICD-11,
  ICD-10, OMIM, HGNC, LOINC, UCUM, DCB, ATC, DUO, Uberon).
- Issues this session: **#549 still open** (progress comment posted,
  tracking the remaining 2 sources). No new issues filed.
- Docker: dev stack was brought up and torn down (`docker compose
  down`, no `-v`) once this session, targeting the bootstrap chain
  directly through `reference-data-bootstrap-ncbitax`. Named volumes
  (mongodb/neo4j data) untouched. Session-built images left cached,
  same reasoning as prior sessions (#549's next source, Cell Ontology,
  is an immediate rebuild otherwise).
- **Pre-existing dangling branches, not touched this session** (carried
  forward unchanged, 16 local + remote items — see earlier handoffs for
  the full list; unchanged this session so not re-enumerated here to
  avoid drift from a list nobody re-verified).

## Which issue is next

Dennis has not explicitly said which issue to pick up next session — per
this skill's "only if the user explicitly said so" rule, nothing is
queued.

Candidates carried forward (#549 still open, not resolved):

- **#549 continuation** — next per §7.4 step 8 is **Cell Ontology**
  (fourth of the final five: DUO, Uberon, NCBI Taxonomy done; Cell
  Ontology/EDAM remain). Same build-loop shape as every source shipped
  so far, reusing `pipeline.js` as-is. Check `dict-01_FONTES.md`'s
  `SRC_CL` row directly (don't assume from this handoff) for
  `sourceFormat`/`license`/`systemUri`/`semanticType` — every prior
  slice has needed its own per-source judgment call there, even when
  the pattern looks predictable. This session's own read of the row
  (line 48, seen in passing while confirming SRC_NCBITAX's line
  number): "Formatos/Interface" = "OWL/OBO" (same shape as DUO/Uberon,
  so `sourceFormat: ['OWL']` is the likely call, not a new judgment
  needed there). `URL de download` =
  `http://purl.obolibrary.org/obo/cl.owl` — already a genuine OBO
  Foundry PURL directly in the row (like Uberon's row, unlike DUO's),
  so probably no HPO/MONDO-style convention judgment call needed for
  `systemUri` this time either. `Licença/termos` = "Licença indicada no
  OBO Foundry" (same literal text as Uberon's row — same license
  string, `licenseUri: null` pending verification). `semanticType` will
  need a new value — Cell Ontology is cell-type vocabulary (row's "Não
  usar para": "Linhagem física da amostra ou anatomia completa" —
  don't use for physical specimen lineage or full anatomy), so
  something like `'cell-type'` (reserved for exactly this source back
  when Uberon shipped, per Uberon's own source-file comment).
- **#550/#551/#552** — independent of #549, can be picked up in any
  order once #367 (satisfied) is the only real dependency.
- **#530** — `dictionary:validate` isn't wired into `ci-pipeline.yml`.
  Unrelated to the RF028 cluster, still open.
- **#489** — full-suite vitest flakiness (JWT/encryption-secret failure
  shape, ~89 files), open, not re-confirmed.
- **#336** — still open: is `import.controller.js#importFhirBundle` dead
  code to remove, or does something still call it?
- **#553** — filed in a prior session: `compose.dev.yml`'s "14 Fase 2
  sources" comments undercount the real total (16). Low priority, fix
  once all 16 sources are operational (suggested target: after EDAM
  closes out step 8).
- Older backlog, unchanged: `#371`/`#374`/`#378`/`#379`, `#368`, `#345`,
  `#341`/`#340`, `#334`, `#331`/`#326`/`#325`, `#321`, `#319`, `#286`,
  `#284`, `#283`, `#282`, `#228`, `#115`, next e2e slice per
  `E2E_TRACEABILITY_PLAN.md`.
- **skills-pack#233/#234/#235/#236/#237/#238/#239/#240/#241/#243/#244/#246/#247/#250/#251/#254/#259/#260**
  — pack-repo only, low priority, unchanged this session.

## Dev stack state

Torn down at session end (`docker compose down`, no `-v`). Named volumes
(mongodb/neo4j data) untouched — next session's `compose up` will see
the same accumulated fixture data prior sessions' gotcha already
documents, now including NCBI Taxonomy's concepts/relations alongside
every prior source's. Images left cached — a next `compose up --build`
should be fast (cache hits) unless something invalidates a layer.

**Reminder for next session's first Docker command:** use
`docker compose --env-file .env.docker -f compose.yml -f compose.dev.yml
up -d --build <targets>` — never bare `up -d --build` — and if targeting
a reference-data bootstrap chain, target the chain services directly
(`foundation-bootstrap reference-data-bootstrap reference-data-bootstrap-mondo
reference-data-bootstrap-orpha reference-data-bootstrap-icd11
reference-data-bootstrap-icd10 reference-data-bootstrap-omim
reference-data-bootstrap-hgnc reference-data-bootstrap-loinc
reference-data-bootstrap-ucum reference-data-bootstrap-dcb
reference-data-bootstrap-atc reference-data-bootstrap-duo
reference-data-bootstrap-uberon reference-data-bootstrap-ncbitax
[next-source]`), skipping `frontend` entirely, per the overlay's
documented fix — this ran clean on the first try again this session,
fifteen links deep now.

**Reminder for a manual Playwright run against the dev stack:** on top
of the documented `E2E_MONGO_URI`/`E2E_MONGO_DB`/Neo4j-creds env vars,
also set `PLAYWRIGHT_BASE_URL=http://localhost:5173`,
`PLAYWRIGHT_API_BASE_URL=http://localhost:3000`, and
`PLAYWRIGHT_SKIP_WEBSERVER=1` — otherwise Playwright's own `webServer`
config tries (and fails, on this machine's Windows-reserved port range)
to launch a second frontend dev server on 5173. See skills-pack#258
(resolved per Dennis, underlying gotcha unchanged). Pull Mongo/Neo4j
creds from `.env.docker` with `grep '^VARNAME=' .env.docker`
per-credential, not by sourcing the whole file directly — it's a dotenv
file, not valid shell, and errors on unquoted `<...>` values (e.g.
`EMAIL_FROM`). See skills-pack#260 (filed last session, not yet
resolved — this session used the grep workaround directly and hit no
friction).

## Which skills to use

- `build-loop` worked smoothly end-to-end again this session, including
  the Docker section — chain targeting worked on the first
  `up -d --build`, fifteen links deep by the end.
- `docker-workflow`'s BioAvanceD-v2 overlay's documented fixes
  (env-file, chain-targeting, the `.env.docker`-grep workaround) continue
  to hold across sessions and across many more chain links than when
  first documented — worth reconfirming as a strong pattern, not just a
  lesson learned once.
- No new friction this session — the prior session's `.env.docker`-
  sourcing gotcha (skills-pack#260) was avoided cleanly by grepping the
  two needed vars individually instead of sourcing the whole file.
