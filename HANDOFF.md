# HANDOFF

**Written:** 2026-08-12, end of session on `feature/docker-e2e-backend-integration`,
after Dennis said "Continue #549" (which the prior handoff had queued as
the top candidate, next source Uberon).

## What happened this session

Continued issue #549 per the prior handoff's queued next-source pointer —
shipped **Uberon**, the thirteenth of the 16 Fase 2 reference-data
sources, via `build-loop`, in the identical shape every prior source
(HPO through DUO) established:

- `sources/uberon.js` + `normalizeUberon.js`, a bundled `uberon-sample.jsonl`
  fixture (8 valid + 2 intentionally-invalid records), `import-uberon-
  reference-dataset.js` + `reference:import:uberon`/`:dry-run` npm scripts,
  a `reference-data-bootstrap-uberon` compose.dev.yml service chained onto
  `reference-data-bootstrap-duo`, `reference-import-boundary.arch.test.js`
  extended with a mirror pair of assertions, `normalizeUberon.test.js`
  (6 unit tests), and a new per-source assertion in
  `pipeline-continuity.spec.ts`'s RF028 describe block.
- **Judgment calls, checked directly against `dict-01_FONTES.md`'s
  SRC_UBERON row (line 47) rather than assumed:** `sourceFormat` `OWL`
  (row lists "OWL/OBO", same as DUO). `systemUri`
  `http://purl.obolibrary.org/obo/uberon.owl` — taken directly from the
  row's own "URL de download" column, which (unlike DUO's row) already
  pointed at the genuine OBO Foundry PURL, so no HPO/MONDO-style
  convention judgment call was needed this time — the first source in
  this loop where the row's download URL and the systemUri coincided
  without extra reasoning. `license` `'Licença indicada no OBO
  Foundry'` (row's literal text, pending verification at real-download
  time). First source with `semanticType: 'anatomy'`, reserving
  `'cell-type'` for Cell Ontology (the next source in this group, per
  the row's own "Não usar para: Tipo celular ou diagnóstico" note).
- Fixture content: real, publicly-known Uberon terms — the genuine root
  (`UBERON:0001062` "anatomical entity") plus four genuine organ-level
  children (heart, liver, lung, brain) and one genuine narrower child of
  heart (`UBERON:0002082` "cardiac ventricle") — plus 2 disclosed
  fabricated placeholder leaves (`UBERON:9001`/`UBERON:9002`), same
  disclosed-fabrication pattern DCB/ATC/DUO used. Like DUO, Uberon's
  real ontology already has a single true root, so no fabricated root ID
  was needed.

Verified: 6 targeted unit tests (vitest, direct file target) + full
architecture suite (47→49) natively; then (Docker-on-by-default for this
loop) the real dev stack brought up targeting the bootstrap chain
directly (fourteen links deep now, `foundation-bootstrap` through
`reference-data-bootstrap-uberon`) — clean on the first try, 10 records
read / 8 validated / 2 rejected / 15 inserted; then the real
`pipeline-continuity.spec.ts -g "Reference data importers"` Playwright
spec against that stack (13→14 passing tests).

Own branch `test/549-uberon-reference-source`, committed, merged (no-ff)
into `feature/docker-e2e-backend-integration`, pushed (`6942ec85`),
progress comment posted on #549.

**One workflow-mechanics finding filed this session (skills-pack, not
this repo):** sourcing `.env.docker` directly in bash
(`set -a; source .env.docker; set +a`, a shortcut to pull Mongo/Neo4j
creds for a manual Playwright run against the dev stack) throws a
syntax error on line 71 (`EMAIL_FROM=BioAvanceD Dev <noreply@localhost>`
— unquoted `<...>` parsed as a shell redirect). Non-fatal (the vars
needed were already set from earlier lines by the time the parser hit
the bad line) and didn't block anything, but is a confusing red herring
in the output. Filed as **dyeallpies-skills-pack#260** (`documentation`
label), suggesting `docker-workflow`'s BioAvanceD-v2 overlay document
the gotcha and recommend `grep '^VARNAME=' .env.docker` per-credential
instead of sourcing the whole file.

`wrap-up`'s core + shipping audits found the one finding above (filed)
and nothing else — `git diff --stat` for the Uberon merge confirmed the
entire 10-file/308-line diff is scoped to the reference-imports feature
(source config, normalizer, fixture, import script, npm scripts,
compose.dev.yml service, arch test, unit test, pipeline-continuity.spec.ts
assertion) — no scope creep, no lazy fixes, no unresolved "needs owner
call" labels closed without a matching open issue.

**Security/safety note:** none. One more data-import source addition,
same shape as every prior RF028 source — no new routes, no auth changes,
no secrets introduced.

## Repo state

- **`feature/docker-e2e-backend-integration`**: at `6942ec85`, clean,
  pushed, up to date with origin. Carries #549's Uberon source on top of
  everything from prior sessions (HPO, MONDO, ORPHA, ICD-11, ICD-10,
  OMIM, HGNC, LOINC, UCUM, DCB, ATC, DUO).
- Issues this session: **#549 still open** (progress comment posted,
  tracking the remaining 3 sources). **skills-pack#260 filed**
  (pack-repo, `.env.docker`-sourcing gotcha, documentation-only).
- Docker: dev stack was brought up and torn down (`docker compose
  down`, no `-v`) once this session, targeting the bootstrap chain
  directly through `reference-data-bootstrap-uberon`. Named volumes
  (mongodb/neo4j data) untouched. Session-built images left cached,
  same reasoning as prior sessions (#549's next source, NCBI Taxonomy,
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

- **#549 continuation** — next per §7.4 step 8 is **NCBI Taxonomy**
  (third of the final five: DUO and Uberon done, NCBI Taxonomy/Cell
  Ontology/EDAM remain). Same build-loop shape as every source shipped
  so far, reusing `pipeline.js` as-is. Check `dict-01_FONTES.md`'s
  `SRC_NCBITAX` row directly (don't assume from this handoff) for
  `sourceFormat`/`license`/`systemUri` — every prior slice has needed
  its own per-source judgment call there, even when the pattern looks
  predictable. This session's own read of the row (line 46, seen
  in passing while confirming SRC_UBERON's line number): "Formatos/
  Interface" = "Taxdump/REST/JSON" — a new format shape, not OWL/OBO
  like DUO/Uberon, likely its own judgment call on `sourceFormat`
  (JSON? the row's actual download interface is "Download\API", not a
  single genuine OBO PURL like the last two sources). `URL de
  informação` = `https://www.ncbi.nlm.nih.gov/taxonomy`; a separate API
  doc URL is also listed
  (`https://www.ncbi.nlm.nih.gov/datasets/docs/v2/api/rest-api/`) —
  neither looks like a canonical systemUri in the OBO-PURL sense DUO/
  Uberon had, so this may need an HPO/MONDO-style convention judgment
  call again (NCBI Taxonomy's real-world canonical URI convention is
  typically `http://purl.obolibrary.org/obo/NCBITaxon_<id>` per OBO
  Foundry — worth checking that against the row before assuming).
  `Licença/termos` = "Termos NCBI" (a new license-string shape, distinct
  from DUO/Uberon's "Licença ..." wording). `semanticType` will need a
  new value — NCBI Taxonomy is organism/taxonomic classification
  (`Não usar para` column: "Anatomia ou tipo celular"), so something
  like `'organism'` or `'taxon'` (not yet used by any prior source).
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
  — pack-repo only, low priority, unchanged this session except #260
  (filed this session, see above).

## Dev stack state

Torn down at session end (`docker compose down`, no `-v`). Named volumes
(mongodb/neo4j data) untouched — next session's `compose up` will see
the same accumulated fixture data prior sessions' gotcha already
documents, now including Uberon's concepts/relations alongside every
prior source's. Images left cached — a next `compose up --build` should
be fast (cache hits) unless something invalidates a layer.

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
reference-data-bootstrap-uberon [next-source]`), skipping `frontend`
entirely, per the overlay's documented fix — this ran clean on the
first try again this session, fourteen links deep now.

**Reminder for a manual Playwright run against the dev stack:** on top
of the documented `E2E_MONGO_URI`/`E2E_MONGO_DB`/Neo4j-creds env vars,
also set `PLAYWRIGHT_BASE_URL=http://localhost:5173`,
`PLAYWRIGHT_API_BASE_URL=http://localhost:3000`, and
`PLAYWRIGHT_SKIP_WEBSERVER=1` — otherwise Playwright's own `webServer`
config tries (and fails, on this machine's Windows-reserved port range)
to launch a second frontend dev server on 5173. See skills-pack#258
(resolved per Dennis, underlying gotcha unchanged). **New this
session:** don't `source .env.docker` directly in bash to pull those
creds — it's a dotenv file, not valid shell, and errors on unquoted
`<...>` values (e.g. `EMAIL_FROM`); grep the specific vars instead. See
skills-pack#260 (filed this session, not yet resolved).

## Which skills to use

- `build-loop` worked smoothly end-to-end again this session, including
  the Docker section — chain targeting worked on the first
  `up -d --build`, fourteen links deep by the end.
- `docker-workflow`'s BioAvanceD-v2 overlay's documented fixes
  (env-file, chain-targeting) continue to hold across sessions and
  across many more chain links than when first documented — worth
  reconfirming as a strong pattern, not just a lesson learned once.
- New friction this session (see skills-pack#260 above): the overlay's
  manual-Playwright-run gotchas document *which* env vars are needed but
  not *how* to safely pull their values from `.env.docker` — sourcing it
  directly seemed like the obvious shortcut and silently half-worked
  (non-fatal syntax error, right values still set) rather than cleanly
  failing, which is the confusing case. Filed rather than fixed in-session
  since this repo can't edit the pack's skill files directly (Rule 0).
