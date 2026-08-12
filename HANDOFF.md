# HANDOFF

**Written:** 2026-08-12, end of session on `feature/docker-e2e-backend-integration`,
after Dennis said "Read handoff" then "Continue #549".

## What happened this session

Continued issue #549 per the prior handoff's queued candidate: next
single source per §7.4 step 4's order after ORPHA is **CID-11** (ICD-11
in the dictionary's English naming — see the gotcha below). Routed to
`build-loop`.

**Built and shipped ICD-11 (RF028's fourth Fase 2 source) this session**,
mirroring HPO (#367)/MONDO (#548)/ORPHA (#549 first slice)'s exact
shape:

- `api/backend/src/reference-data/reference-imports/sources/icd11.js` +
  `normalizeIcd11.js`. `sourceFormat` is `JSONL` per
  `dict-01_FONTES.md`'s `SRC_ICD11` row (`REST/JSON/Browser` — JSON is a
  real listed distribution format, unlike ORPHA's XML-only case, so this
  follows HPO/MONDO's precedent rather than ORPHA's XML special-case).
  `license` is `'Termos WHO'`, the row's literal value (not a
  pending-verification placeholder the way HPO's is); `licenseUri` stays
  `null` pending #550's live download/license-verification follow-up.
  `systemUri` is the WHO ICD-11 MMS linearization URI used in FHIR
  terminology bindings (`http://id.who.int/icd/release/11/mms`).
- `fixtures/icd11-sample.jsonl` — 8 valid + 2 intentionally-invalid
  records, same shape as `hpo-sample.jsonl`/`mondo-sample.jsonl`/
  `orpha-sample.jsonl`. Illustrative MMS codes/labels (a "disease,
  unspecified" root plus two chapter branches), not asserted as a
  verified snapshot of any real ICD-11 release.
- `scripts/reference-imports/import-icd11-reference-dataset.js` +
  `reference:import:icd11`/`:dry-run` npm scripts +
  `reference-data-bootstrap-icd11` compose.dev.yml service (depends on
  `reference-data-bootstrap-orpha` completing, matching §7.4's
  documented order).
- **Judgment call, deliberately deviates from HPO/MONDO/ORPHA
  precedent:** `import-large-reference-dataset.js`'s placeholder
  scaffold **keeps `'cid'`** in its allowed-datasets set — unlike the
  full-removal precedent those three sources set. `'cid'` was always one
  shared placeholder token for both CID-11 (graduated this slice) and
  CID-10 (not yet built, next in §7.4's own group). Removing it now
  would misrepresent CID-10 as also covered by its own script. It comes
  out once CID-10 graduates its own operational script — **next
  session building CID-10 should remove `'cid'` from that Set as part of
  that slice**, the same way HPO/MONDO/ORPHA each removed their own
  token.
- `reference-import-boundary.arch.test.js` extended with ICD-11-mirror
  assertions (fixture-only, no live network, excluded from the
  placeholder scaffold).
- `normalizeIcd11.test.js` — 6 unit tests, mirroring
  `normalizeMondo.test.js`/`normalizeOrpha.test.js`.
- `pipeline-continuity.spec.ts`'s RF028 describe block got a new
  ICD-11-specific assertion, reusing the already-generic
  `countReferenceDatasetReleasesByDatasetCode`/
  `countTerminologyConceptsBySystemUri` helpers (no new helper code
  needed).

Verified: 34/34 targeted unit tests (HPO+MONDO+ORPHA+ICD11), 13/13
`reference-import-boundary` arch assertions (29/29 full arch suite)
natively; then (Docker-on-by-default for this loop) brought up the real
dev stack targeting the bootstrap chain directly (per the documented
`--env-file`/chain-targeting fix from #548) and confirmed
`reference-data-bootstrap-icd11` ran after `reference-data-bootstrap-orpha`
— 10 records read, 8 validated, 2 rejected, 15 inserted (8 concepts + 7
`is_a` relations) — then ran the real `pipeline-continuity.spec.ts -g
"Reference data importers"` Playwright spec against that stack: all 5
tests pass, including the new ICD-11-specific one. Unlike the #548
session, the Docker chain drove through cleanly on the first `up -d`
call this time (no `--env-file` mistake, no restart-loop recovery
needed) — the documented fix from the prior session's gotcha held.

**One piece of real friction, self-caused and filed:** grepped
`dict-01_FONTES.md` for `CID-11`/`CID11`/`SRC_CID11` (matching the plan
doc's own Portuguese wording, "Importar ORPHA, CID-11, CID-10 e OMIM")
and got zero matches — the dictionary's actual row uses the English WHO
abbreviation `SRC_ICD11`, not the Portuguese "CID" the plan doc uses
everywhere else. Cost one extra full-file read to find it. Will recur
identically for **CID-10** next (row will be `SRC_ICD10`, not
`SRC_CID10`). Filed as **skills-pack#255** (build-loop's BioAvanceD-v2
overlay should document the CID→ICD translation before the next session
greps for it again).

Committed on `test/549-icd11-reference-source`, merged (no-ff) into
`feature/docker-e2e-backend-integration` at `31d55744`, pushed, progress
comment posted on **#549** (left open — 11 sources remain, next is
CID-10).

`wrap-up`'s core + shipping audits found the one piece of friction above
(filed as skills-pack#255) plus the 'cid' token judgment call (not a
skill gap — session-specific, already documented in the commit/issue
comment and flagged above for next session to act on). No lazy fixes, no
scope creep outside the ICD-11 slice's files (confirmed via `git status`
before staging), no unresolved "needs owner call" labels closed without
a matching open issue.

**Security/safety note:** none. Product change is a data-import source
addition with a real-backend proof; no new routes, no auth changes, no
secrets introduced.

## Repo state

- **`feature/docker-e2e-backend-integration`**: at `31d55744`, clean,
  pushed, up to date with origin. Carries #549's ICD-11 source on top of
  #548's MONDO, ORPHA, and everything from prior sessions.
- Issues this session: **#549 still open** (progress comment posted,
  tracking the remaining 11 sources). **skills-pack#255 filed**
  (pack-repo, dict-01_FONTES.md CID→ICD naming gotcha, will recur for
  CID-10 unless fixed first).
- Docker: dev stack was brought up this session to verify ICD-11, then
  torn down (`docker compose down`, no `-v`) at session end. Named
  volumes (mongodb/neo4j data) untouched. Session-built images left
  cached, same reasoning as prior sessions (#549's very likely next
  source, CID-10, is an immediate rebuild otherwise).
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
  **CID-10**, then OMIM (closing out step 4's group), then HGNC (step
  5), LOINC/UCUM (step 6), DCB/ATC (step 7), DUO/Uberon/NCBI
  Taxonomy/Cell Ontology/EDAM (step 8). Same build-loop shape as
  HPO/MONDO/ORPHA/ICD11, reusing `pipeline.js` as-is. Two things this
  slice should carry: (1) the `dict-01_FONTES.md` row is `SRC_ICD10`,
  not `SRC_CID10` — see skills-pack#255; (2) once CID-10's own script
  exists, remove `'cid'` from `import-large-reference-dataset.js`'s
  allowed-datasets set — see the judgment-call note above. Also
  re-check each remaining source's `sourceFormat`/`license` against its
  own dict-01 row rather than assuming JSONL/a fixed license value, per
  the same per-source judgment call ORPHA's and ICD-11's slices both
  documented.
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
- **skills-pack#255** — filed this session (see above), pack-repo fix,
  not this project's scope to resolve.

## Dev stack state

Torn down at session end (`docker compose down`, no `-v`). Named volumes
(mongodb/neo4j data) untouched — next session's `compose up` will see
the same accumulated fixture data prior sessions' gotcha already
documents, now including ICD-11's 8 concepts/7 relations alongside
HPO's/MONDO's/ORPHA's. Images left cached — a next `compose up --build`
should be fast (cache hits) unless something invalidates a layer.

**Reminder for next session's first Docker command:** use
`docker compose --env-file .env.docker -f compose.yml -f compose.dev.yml
up -d --build <targets>` — never bare `up -d --build` — and if targeting
a reference-data bootstrap chain, target the chain services directly
(`foundation-bootstrap reference-data-bootstrap reference-data-bootstrap-mondo
reference-data-bootstrap-orpha reference-data-bootstrap-icd11
[next-source]`), skipping `frontend` entirely, per the overlay's
documented fix — this ran clean on the first try this session, so the
fix is holding.

## Which skills to use

- `build-loop` worked smoothly end-to-end this session, including the
  Docker section — no `--env-file` mistake this time, chain targeting
  worked on the first `up -d`. The one gap was doc lookup, not workflow:
  see skills-pack#255 (CID→ICD naming trap in `dict-01_FONTES.md`).
- `docker-workflow`'s BioAvanceD-v2 overlay's documented fixes (env-file,
  chain-targeting) continue to hold across sessions once written down —
  worth noting as a confirmation, not just a lesson learned once.
