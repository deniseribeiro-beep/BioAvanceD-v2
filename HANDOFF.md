# HANDOFF

**Written:** 2026-08-12, end of session on `feature/docker-e2e-backend-integration`,
after Dennis said "Continue 549" (which the prior handoff had queued as
the top candidate, next source Cell Ontology).

## What happened this session

Continued issue #549 per the prior handoff's queued next-source pointer —
shipped **Cell Ontology**, the fifteenth of the 16 Fase 2 reference-data
sources, via `build-loop`, in the identical shape every prior source
(HPO through NCBI Taxonomy) established:

- `sources/cl.js` + `normalizeCl.js`, a bundled `cl-sample.jsonl` fixture
  (8 valid + 2 intentionally-invalid records), `import-cl-reference-
  dataset.js` + `reference:import:cl`/`:dry-run` npm scripts, a
  `reference-data-bootstrap-cl` compose.dev.yml service chained onto
  `reference-data-bootstrap-ncbitax`, `reference-import-boundary.arch.test.js`
  extended with a mirror pair of assertions, `normalizeCl.test.js`
  (6 unit tests), and a new per-source assertion in
  `pipeline-continuity.spec.ts`'s RF028 describe block.
- **Judgment calls, checked directly against `dict-01_FONTES.md`'s
  SRC_CL row (line 48) rather than assumed:** every value matched what
  the prior handoff had already anticipated from a passing read of the
  row, with no surprises — `sourceFormat` `['OWL']` (row lists
  "OWL/OBO", same shape as DUO/Uberon). `systemUri`
  `http://purl.obolibrary.org/obo/cl.owl` — the row's own "URL de
  download" column already points at Cell Ontology's genuine OBO
  Foundry PURL directly (like Uberon's row, unlike DUO's GitHub-repo
  fallback), so no HPO/MONDO-style convention judgment call was needed.
  `license` `'Licença indicada no OBO Foundry'` (row's literal text,
  same shape as Uberon's row, pending real license verification at
  real-download time, `licenseUri: null`). `semanticType` `'cell-type'`
  — the value reserved for Cell Ontology back when Uberon shipped (per
  Uberon's own source-file comment), matching the row's "Tipos
  celulares" domain column and its "Não usar para: Linhagem física da
  amostra ou anatomia completa" note.
- Fixture content: real, publicly-known Cell Ontology terms — the genuine
  root (CL:0000000 "cell") plus four genuine direct children (CL:0000255
  "eukaryotic cell", CL:0000003 "native cell", CL:0000738 "leukocyte",
  CL:0000842 "mononuclear cell") and one genuine deeper child of
  CL:0000738 (CL:0000542 "lymphocyte", a real is_a relationship in the
  ontology) — plus 2 disclosed fabricated placeholder leaves (CL:9001
  "accessory cell subtype", CL:9002 "regional cell subdivision"), same
  disclosed-fabrication pattern DCB/ATC/DUO/Uberon/NCBI Taxonomy used.
  Like Uberon/NCBI Taxonomy, Cell Ontology's real hierarchy already has a
  single true root, so no fabricated root ID was needed.

Verified: 6 targeted unit tests (vitest, direct file target) + full
architecture suite (51→53) natively; then (Docker-on-by-default for this
loop) the real dev stack brought up targeting the bootstrap chain
directly (sixteen links deep now, `foundation-bootstrap` through
`reference-data-bootstrap-cl`) — clean on the first try (after fixing a
self-inflicted backgrounding mistake, see below), 10 records read / 8
validated / 2 rejected / 15 inserted; then the real
`pipeline-continuity.spec.ts -g "Reference data importers"` Playwright
spec against that stack (15→16 passing tests).

Own branch `test/549-cl-reference-source`, committed, merged (no-ff)
into `feature/docker-e2e-backend-integration`, pushed (`085ad478`),
progress comment posted on #549.

**One workflow-mechanics finding filed this session** (skills-pack, not
this repo): the first `docker compose up -d --build` attempt was
launched as a shell background job (`... &`) *inside* a Bash tool call
that also had `run_in_background: true` set — the tool call returned in
seconds ("completed, exit 0"), but that was only the wrapping shell
(launch subprocess, print pid, exit), not the real `docker compose up`.
The actual command kept running detached from the tool's tracked
process tree and got cut off mid-build: its log stopped mid-image-build
with no `Container ... Started` lines, and `docker ps -a` afterward
showed zero containers despite all 20 images having built successfully.
Retried correctly — `run_in_background: true` on its own, no shell `&`
— and that run completed properly (full container lifecycle in the log,
chain ran clean to `reference-data-bootstrap-cl`). Cost one wasted
build cycle, mostly cache-absorbed so cheap this time but wouldn't be on
a cold cache. Filed as
[dyeallpies-skills-pack#262](https://github.com/DyeAllPies/dyeallpies-skills-pack/issues/262)
with proposed wording for `docker-workflow`'s Windows/Git Bash gotchas
section (never combine a trailing shell `&` with the tool's own
`run_in_background: true`).

`git diff --stat` for the merge confirmed the entire 10-file/309-line
diff is scoped to the reference-imports feature (source config,
normalizer, fixture, import script, npm scripts, compose.dev.yml
service, arch test, unit test, pipeline-continuity.spec.ts assertion) —
no scope creep, no lazy fixes, no unresolved "needs owner call" labels
closed without a matching open issue.

**Security/safety note:** none. One more data-import source addition,
same shape as every prior RF028 source — no new routes, no auth changes,
no secrets introduced.

## Repo state

- **`feature/docker-e2e-backend-integration`**: at `085ad478`, clean,
  pushed, up to date with origin. Carries #549's Cell Ontology source on
  top of everything from prior sessions (HPO, MONDO, ORPHA, ICD-11,
  ICD-10, OMIM, HGNC, LOINC, UCUM, DCB, ATC, DUO, Uberon, NCBI Taxonomy).
- Issues this session: **#549 still open** (progress comment posted,
  tracking the one remaining source, EDAM). One new issue filed
  ([dyeallpies-skills-pack#262](https://github.com/DyeAllPies/dyeallpies-skills-pack/issues/262),
  workflow mechanics only — not a BioAvanceD-v2 product issue).
- Docker: dev stack was brought up and torn down (`docker compose
  down`, no `-v`) once this session, targeting the bootstrap chain
  directly through `reference-data-bootstrap-cl`. Named volumes
  (mongodb/neo4j data) untouched. Session-built images left cached,
  same reasoning as prior sessions (#549's last source, EDAM, is an
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

- **#549 continuation** — next per §7.4 step 8 is **EDAM**, the
  fifth and last of the final five (DUO, Uberon, NCBI Taxonomy, Cell
  Ontology done; EDAM remains), closing out the entire 16-source Fase 2
  group. Same build-loop shape as every source shipped so far, reusing
  `pipeline.js` as-is. Check `dict-01_FONTES.md`'s `SRC_EDAM` row
  directly (don't assume from this handoff) for
  `sourceFormat`/`license`/`systemUri`/`semanticType` — every prior
  slice has needed its own per-source judgment call there, even when
  the pattern looks predictable (this session's own SRC_CL row check
  turned out to need no new judgment calls at all — every value matched
  the prior handoff's anticipation exactly — so "predictable" isn't a
  reason to skip the direct read, just a description of how it's gone
  lately). Once EDAM lands, `import-large-reference-dataset.js`'s
  `allowedDatasets` Set has been empty since the OMIM slice (nothing to
  remove there), and issue **#553** (compose.dev.yml's "14 Fase 2
  sources" comments undercounting the real total of 16) becomes ripe to
  fix, per its own suggested target ("after EDAM closes out step 8").
- **#550/#551/#552** — independent of #549, can be picked up in any
  order once #367 (satisfied) is the only real dependency.
- **#530** — `dictionary:validate` isn't wired into `ci-pipeline.yml`.
  Unrelated to the RF028 cluster, still open.
- **#489** — full-suite vitest flakiness (JWT/encryption-secret failure
  shape, ~89 files), open, not re-confirmed.
- **#336** — still open: is `import.controller.js#importFhirBundle` dead
  code to remove, or does something still call it?
- **#553** — filed in a prior session: `compose.dev.yml`'s "14 Fase 2
  sources" comments undercount the real total (16). Low priority, ripe
  once EDAM (the last source) lands next session.
- Older backlog, unchanged: `#371`/`#374`/`#378`/`#379`, `#368`, `#345`,
  `#341`/`#340`, `#334`, `#331`/`#326`/`#325`, `#321`, `#319`, `#286`,
  `#284`, `#283`, `#282`, `#228`, `#115`, next e2e slice per
  `E2E_TRACEABILITY_PLAN.md`.
- **skills-pack#233/#234/#235/#236/#237/#238/#239/#240/#241/#243/#244/#246/#247/#250/#251/#254/#259/#260/#262**
  — pack-repo only, low priority, unchanged this session except for
  #262 (new, filed this session).

## Dev stack state

Torn down at session end (`docker compose down`, no `-v`). Named volumes
(mongodb/neo4j data) untouched — next session's `compose up` will see
the same accumulated fixture data prior sessions' gotcha already
documents, now including Cell Ontology's concepts/relations alongside
every prior source's. Images left cached — a next `compose up --build`
should be fast (cache hits) unless something invalidates a layer.

**Reminder for next session's first Docker command:** use
`docker compose --env-file .env.docker -f compose.yml -f compose.dev.yml
up -d --build <targets>` — never bare `up -d --build` — and **never
combine that with a trailing shell `&`, even under `run_in_background:
true`** (see dyeallpies-skills-pack#262 above — the shell `&` orphans
the real command from the tool's process tracking and can get it killed
mid-build while the tool reports a fast false "completed"). If targeting
a reference-data bootstrap chain, target the chain services directly
(`foundation-bootstrap reference-data-bootstrap reference-data-bootstrap-mondo
reference-data-bootstrap-orpha reference-data-bootstrap-icd11
reference-data-bootstrap-icd10 reference-data-bootstrap-omim
reference-data-bootstrap-hgnc reference-data-bootstrap-loinc
reference-data-bootstrap-ucum reference-data-bootstrap-dcb
reference-data-bootstrap-atc reference-data-bootstrap-duo
reference-data-bootstrap-uberon reference-data-bootstrap-ncbitax
reference-data-bootstrap-cl [next-source]`), skipping `frontend`
entirely, per the overlay's documented fix — this ran clean on the
first try again this session (once launched correctly), sixteen links
deep now.

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
`EMAIL_FROM`). See skills-pack#260 (filed two sessions ago, not yet
resolved — this session used the grep workaround directly and hit no
friction).

## Which skills to use

- `build-loop` worked smoothly end-to-end again this session, including
  the Docker section, once the self-inflicted backgrounding mistake
  (see above) was corrected — chain targeting worked on the first
  correctly-launched `up -d --build`, sixteen links deep by the end.
- `docker-workflow`'s BioAvanceD-v2 overlay's documented fixes
  (env-file, chain-targeting, the `.env.docker`-grep workaround) continue
  to hold across sessions and across many more chain links than when
  first documented — worth reconfirming as a strong pattern, not just a
  lesson learned once.
- New friction this session: the shell-`&`-inside-`run_in_background`
  double-backgrounding trap described above — filed as
  dyeallpies-skills-pack#262, not yet resolved (pack skill file wasn't
  edited this session per Rule 0 — only editable from a session working
  in the skills-pack repo itself).
