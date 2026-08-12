# HANDOFF

**Written:** 2026-08-12, end of session on `feature/docker-e2e-backend-integration`,
after Dennis said "Continue 549" (which the prior handoff had queued as
the top candidate, next source EDAM).

## What happened this session

Continued issue #549 per the prior handoff's queued next-source pointer —
shipped **EDAM**, the sixteenth and final of the 16 Fase 2 reference-data
sources, via `build-loop`, closing out the entire RF028 Fase 2 group and
issue #549 itself:

- `sources/edam.js` + `normalizeEdam.js`, a bundled `edam-sample.jsonl`
  fixture (11 valid + 2 intentionally-invalid records),
  `import-edam-reference-dataset.js` + `reference:import:edam`/
  `:dry-run` npm scripts, a `reference-data-bootstrap-edam` compose.dev.yml
  service chained onto `reference-data-bootstrap-cl`,
  `reference-import-boundary.arch.test.js` extended with a mirror pair of
  assertions, `normalizeEdam.test.js` (6 unit tests), and a new per-source
  assertion in `pipeline-continuity.spec.ts`'s RF028 describe block.
- **Judgment calls, checked directly against `dict-01_FONTES.md`'s
  SRC_EDAM row (line 49) rather than assumed:** `sourceFormat` `['OWL']`
  (row lists "OWL" plainly, unlike DUO/Uberon/Cell Ontology's "OWL/OBO" —
  no interpretation judgment call needed this time, the literal value
  already matched the stored array). `systemUri`
  `http://edamontology.org/EDAM.owl` — the row's own "URL de download"
  column already points at EDAM's genuine ontology PURL directly, so no
  HPO/MONDO-style convention judgment call was needed. `license`
  `'Licença do projeto'` (row's literal text, distinct wording from
  Uberon/Cell Ontology's "Licença indicada no OBO Foundry" since EDAM's
  row points at edamontology.org directly rather than an OBO Foundry
  listing page; `licenseUri: null`, pending real license verification at
  real-download time). `semanticType` `'bioinformatics'` — dict-01's own
  "Bioinformática" domain column for SRC_EDAM, translated the same way
  every prior source's domain column became its semanticType, kept as
  one fixed value across all four EDAM branches (every normalizer in
  this loop returns one constant semanticType regardless of the record's
  shape — this slice followed that established pattern rather than
  introducing per-record derivation).
- **Structural deviation from every prior single-root OBO/OWL source in
  this loop (DUO, Uberon, Cell Ontology):** EDAM is genuinely organized
  into four independent branches — Data, Format, Operation, Topic — each
  with its own root and no shared parent, matching dict-01's own "Campos
  usados" column for SRC_EDAM ("Tipo de dado, formato de arquivo,
  operação e tópico de análise"). Rather than force a single fabricated
  umbrella root (which every prior single-root source didn't need
  either, just for a different reason — they had one genuine root),
  the fixture carries all four genuine roots.
- **Fixture content verified against a live authoritative API, not
  training-data recall** — EDAM's exact numeric term IDs (`data_0006`,
  `format_1915`, etc.) are real but far less universally memorable than
  CL:0000000/UBERON:0001062-style anchors used by prior sources, so this
  slice used WebFetch against EBI OLS's ontology API
  (`https://www.ebi.ac.uk/ols4/api/ontologies/edam/terms/roots` and
  `.../terms/<url-encoded-iri>/children`) to confirm real term IDs/labels
  before writing the fixture. Result: all four genuine branch roots
  (`data_0006` "Data", `format_1915` "Format", `operation_0004`
  "Operation", `topic_0003` "Topic"), one genuine direct child of each
  (`data_2044` "Sequence", `format_3464` "JSON", `operation_2945` "Data
  analysis", `topic_0605` "Informatics"), and one genuine narrower child
  of `data_2044` (`data_2977` "Nucleic acid sequence", a real is_a
  relationship in the ontology) — plus 2 disclosed fabricated placeholder
  leaves under the Format/Topic branches (`format_9001`, `topic_9002`),
  same disclosed-fabrication pattern DCB/ATC/DUO/Uberon/NCBI
  Taxonomy/Cell Ontology's slices used.

Verified: 6 targeted unit tests (vitest, direct file target) + full
architecture suite (53→55) natively; then (Docker-on-by-default for this
loop) the real dev stack brought up targeting the bootstrap chain
directly (seventeen links deep now, `foundation-bootstrap` through
`reference-data-bootstrap-edam`) — clean on the first try (no repeat of
the prior session's shell-`&`/`run_in_background` backgrounding mistake,
confirming skills-pack#262's fix held), 13 records read / 11 validated /
2 rejected / 18 inserted (11 concepts + 7 relations); then the real
`pipeline-continuity.spec.ts -g "Reference data importers"` Playwright
spec against that stack (16→17 passing tests).

Own branch `test/549-edam-reference-source`, committed, merged (no-ff)
into `feature/docker-e2e-backend-integration`, pushed (`7b0c1674`),
progress comment posted on #549, **#549 closed** (all 16 Fase 2 sources
now shipped: MONDO under #548, the other 15 — HPO, ORPHA, ICD-11,
ICD-10, OMIM, HGNC, LOINC, UCUM, DCB, ATC, DUO, Uberon, NCBI Taxonomy,
Cell Ontology, EDAM — under #367/#549).

**Two findings filed this session:**
1. [BioAvanceD-v2#554](https://github.com/deniseribeiro-beep/BioAvanceD-v2/issues/554)
   — #550's own title ("...for all 14 Fase 2 sources") has the same
   stale undercount #553 already flagged for compose.dev.yml's comments;
   the real total is 16. Noticed while double-checking #549's close
   comment's own follow-up-issue references. Low priority, wording-only.
2. [dyeallpies-skills-pack#263](https://github.com/DyeAllPies/dyeallpies-skills-pack/issues/263)
   — proposed a `build-loop`'s BioAvanceD-v2 overlay addition documenting
   the live-API fixture-verification technique used for EDAM (see above),
   since the overlay file is an installed junction and can't be edited
   directly from a consuming-project session (Rule 0). Not yet resolved.

`git diff --stat` for the merge confirmed the entire 10-file/329-line
diff is scoped to the reference-imports feature (source config,
normalizer, fixture, import script, npm scripts, compose.dev.yml
service, arch test, unit test, pipeline-continuity.spec.ts assertion) —
no scope creep, no lazy fixes, no unresolved "needs owner call" labels
closed without a matching open issue.

**Security/safety note:** none. One more data-import source addition,
same shape as every prior RF028 source — no new routes, no auth changes,
no secrets introduced.

## Repo state

- **`feature/docker-e2e-backend-integration`**: at `7b0c1674`, clean,
  pushed, up to date with origin. Carries #549's full 16-source Fase 2
  group on top of everything from prior sessions.
- Issues this session: **#549 closed** (all 16 Fase 2 sources shipped).
  Two new issues filed: BioAvanceD-v2#554 (product repo, stale title
  wording on #550, low priority) and dyeallpies-skills-pack#263 (pack
  repo, build-loop overlay lesson, not a BioAvanceD-v2 product issue).
- Docker: dev stack was brought up and torn down (`docker compose
  down`, no `-v`) once this session, targeting the bootstrap chain
  directly through `reference-data-bootstrap-edam`. Named volumes
  (mongodb/neo4j data) untouched. Session-built images left cached — no
  more Fase 2 sources are queued, so the next rebuild benefit is smaller
  than prior sessions', but harmless to leave.
- **Pre-existing dangling branches, not touched this session** (carried
  forward unchanged, 16 local + remote items — see earlier handoffs for
  the full list; unchanged this session so not re-enumerated here to
  avoid drift from a list nobody re-verified).

## Which issue is next

Dennis has not explicitly said which issue to pick up next session — per
this skill's "only if the user explicitly said so" rule, nothing is
queued.

Candidates carried forward:

- **#549 is now closed** — the entire RF028 Fase 2 group (16/16 sources)
  is shipped. Explicitly out-of-scope follow-up work from #549's own
  description is tracked separately:
  - **#550** — live download + real license verification for all 16
    sources (title still says "14", see BioAvanceD-v2#554 above).
  - **#551** — full AC7 lifecycle (checkpoint/resume, quarantine
    recovery, rollback).
  - **#552** — Neo4j outbox projection (AC9) for TerminologyConcept/
    TerminologyRelation.
  - **#553** — compose.dev.yml's "14 Fase 2 sources" comments undercount
    the real total (16) — now ripe per its own suggested target ("after
    EDAM closes out step 8").
  - **#554** — (new this session) #550's title has the same undercount.
  Any of #550/#551/#552/#553/#554 can be picked up in any order; #553
  and #554 are both small wording-only fixes if a quick win is wanted.
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
- **skills-pack#233/#234/#235/#236/#237/#238/#239/#240/#241/#243/#244/#246/#247/#250/#251/#254/#259/#260/#262/#263**
  — pack-repo only, low priority, unchanged this session except for
  #263 (new, filed this session).

## Dev stack state

Torn down at session end (`docker compose down`, no `-v`). Named volumes
(mongodb/neo4j data) untouched — next session's `compose up` will see
the same accumulated fixture data prior sessions' gotcha already
documents, now including EDAM's concepts/relations alongside every
prior source's. Images left cached.

**Reminder for next session's first Docker command (if any RF028-adjacent
work resumes):** use `docker compose --env-file .env.docker -f
compose.yml -f compose.dev.yml up -d --build <targets>` — never bare
`up -d --build` — and never combine that with a trailing shell `&`, even
under `run_in_background: true` (dyeallpies-skills-pack#262 — confirmed
resolved again this session, clean run on the first try). The full
17-link reference-data bootstrap chain is now complete end-to-end:
`foundation-bootstrap reference-data-bootstrap reference-data-bootstrap-mondo
reference-data-bootstrap-orpha reference-data-bootstrap-icd11
reference-data-bootstrap-icd10 reference-data-bootstrap-omim
reference-data-bootstrap-hgnc reference-data-bootstrap-loinc
reference-data-bootstrap-ucum reference-data-bootstrap-dcb
reference-data-bootstrap-atc reference-data-bootstrap-duo
reference-data-bootstrap-uberon reference-data-bootstrap-ncbitax
reference-data-bootstrap-cl reference-data-bootstrap-edam` — no more
sources will be appended to this chain unless a new Fase 2 source is
discovered/added to scope.

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
`EMAIL_FROM`). See skills-pack#260 (filed several sessions ago, not yet
resolved — this session used the grep workaround directly and hit no
friction).

## Which skills to use

- `build-loop` worked smoothly end-to-end again this session, including
  the Docker section — chain targeting worked on the first correctly-
  launched `up -d --build`, seventeen links deep, closing out the whole
  RF028 Fase 2 group.
- `docker-workflow`'s BioAvanceD-v2 overlay's documented fixes
  (env-file, chain-targeting, the `.env.docker`-grep workaround) held
  again across the full 17-link chain — strong pattern, reconfirmed one
  more time as this particular series wraps up.
- New this session: EDAM's fixture needed a live-API verification step
  (WebFetch against EBI OLS) that no prior source in this loop had
  needed, since EDAM's real term IDs are less memorable than CL/Uberon's
  famous anchors — proposed as a `build-loop` overlay addition via
  dyeallpies-skills-pack#263 (not yet resolved; the pack repo owns
  applying it).
