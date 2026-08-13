# HANDOFF

**Written:** 2026-08-13, end of session on `feature/docker-e2e-backend-integration`,
after Dennis said "Continue 557" (following the prior handoff's top candidate).

## What happened this session

Continued #557 ("apply #556's live-download + license-verification pattern
to the remaining Fase 2 sources") via `build-loop`, picking up the last
member of §7.4's "ORPHA, CID-11, CID-10 e OMIM" group: **OMIM**.

- Read `dict-01_FONTES.md`'s SRC_OMIM row directly (not a paraphrase):
  URL oficial `https://www.omim.org/`, API `https://omim.org/api/`,
  Autenticação "Chave/API/licença" (key/API/license required).
- Checked whether OMIM's authority runs a public unauthenticated surface
  the way ICD-11/ICD-10 did (the discipline #265/#266 established) —
  it does not, decisively. `curl`/`WebFetch` against `omim.org` and
  `www.omim.org` all 403 with `Cf-Mitigated: challenge` (an interactive
  Cloudflare bot challenge, not a simple auth wall) on every path tried:
  `/`, `/help/api`, `/downloads`, `/about`, with a real browser
  User-Agent. `robots.txt` (itself un-challenged, 200 OK) explicitly
  disallows crawling and warns it auto-blocks IPs that request pages —
  confirmed live 2026-08-13, then stopped probing the domain further per
  its own stated policy.
- **This is the first Fase 2 source needing the "not live-verifiable"
  carve-out** the prior two sessions' handoffs predicted might be needed.
  Unlike ICD-11 (`'redirect-version'`) and ICD-10 (`'fixed-edition'`),
  there's no public fallback surface to build a real verification path
  around — the entire domain, not just the API, is walled.
- **Added a fifth `kind` to `verify-live-release.js`**: `'not-live-
  verifiable'` (`verifyNotLiveVerifiable`) — never calls `fetch()` at
  all (respecting the site's robots.txt), returns `status:
  'not-verifiable'` immediately with a `reason` string. Distinct from
  `'mismatch'` (which implies a fetch was attempted and something
  changed) and from a thrown network error.
- Added the `OMIM` entry (`datasetCode`/`kind`/`reason` only — no URLs,
  since none are ever requested) to `liveVerifySources.js`, the
  `reference:live-verify:omim` npm script, and one new mocked-fetch unit
  test asserting `global.fetch` is never invoked for this entry.
- **Ran `npm run reference:live-verify:omim` natively** — reports
  `status: "not-verifiable"` with the Cloudflare-challenge reason, exit
  code 1 (correct: not verified, distinct wording from a real mismatch).
  Also re-ran `reference:live-verify:hpo/mondo/orpha/icd11/icd10`
  natively as regression checks on the twice-more-refactored
  `verify-live-release.js` — all five still `"verified"`.
- No changes needed to the arch tests or the CI workflow — same
  directory-wide arch-test/`workflow_dispatch` precedent as every prior
  #557 slice.
- Did **not** touch `src/reference-data/reference-imports/sources/omim.js`
  (the fixture source config, already built in #549) — same boundary
  precedent as ICD-11/ICD-10.

Verified: 60/60 architecture tests (native, `node --test`, unchanged
count), 122/122 unit tests across `tests/unit/reference-imports/`
(vitest, up from 121 — the 1 new OMIM case), lint (383 files) clean, all
six live-verify scripts (OMIM, HPO/MONDO/ORPHA/ICD11/ICD10 regression)
run natively against their real upstreams (OMIM's "upstream" being the
confirmed-blocked domain — no fetch attempted by design).

Own branch `test/557-live-verify-omim` (same `test/<slug>` fallback as
every prior #557 slice), committed, merged (no-ff) into
`feature/docker-e2e-backend-integration`, pushed (`c1170ad0`), local
branch deleted (never pushed to remote, so no remote delete needed).
**#557 left open** with a corrected progress comment (6 of ~15-16 done —
HPO, MONDO, ORPHA, ICD-11, ICD-10, OMIM; ~9-10 remain) — not closed,
since the issue covers all Fase 2 sources and only one landed this
session. See below for a count discrepancy flagged in that comment.

`wrap-up` filed one issue: **dyeallpies-skills-pack#267** — the
`build-loop` BioAvanceD-v2 overlay's "Still outstanding for a future
#557 slice" paragraph (predicting OMIM might need the carve-out) is now
resolved; filed with exact suggested replacement text, same pattern as
#266 last session. Not edited directly — the overlay file is a junction
into the skills-pack clone (Rule 0).

**Also flagged, not filed as a new issue:** #557's own running progress
count ("5 of 15 done" in the prior handoff/comment) doesn't reconcile
against the 16-source Fase 2 total used elsewhere in this repo's history
(e.g. "EDAM, sixteenth and final source" from #549). This looks like the
same undercount pattern #553/#554 already track (those flag "14" instead
of 16; #557's own count looks like "15" instead of 16) — flagged in the
corrected #557 progress comment so whoever resolves #553/#554 also
reconciles #557's count, rather than filing a third overlapping issue
for the same underlying miscount.

## Repo state

- **`feature/docker-e2e-backend-integration`**: at `c1170ad0`, clean,
  pushed, up to date with origin. Carries #555/#556's live-verify
  infrastructure + HPO pilot + MONDO + ORPHA + ICD-11 + ICD-10 (prior
  sessions) + this session's OMIM carve-out and the fifth-`kind`-
  generalized `verify-live-release.js`, on top of #549's full 16-source
  Fase 2 fixture-import group.
- Issues this session: **none closed**. **#557 open**, progress comment
  corrected/updated (HPO/MONDO/ORPHA/ICD-11/ICD-10/OMIM done; count
  discrepancy flagged inline). **#550 open** (tracking issue for the
  original 3-way split, unchanged). **dyeallpies-skills-pack#267 opened**
  (pack-repo tracker, stale-overlay fix for the OMIM carve-out
  confirmation — see above).
- Docker: not used this session — live-verify is a network-only script
  (or, for OMIM specifically, a script that deliberately makes *no*
  network call), no Mongo/Docker involved, same as every prior #557
  slice.
- **Pre-existing dangling branches, not touched this session** (carried
  forward unchanged from before — see earlier handoffs for the full list;
  not re-enumerated here to avoid drift from a list nobody re-verified
  this session either).

## Which issue is next

Dennis has not explicitly said which issue to pick up next session — per
`handoff`'s own rule, nothing is queued.

Candidates carried forward:

- **#557** — continue the live-verify pattern for the next source. No
  explicit "recommended order" beyond the now-fully-landed "ORPHA,
  CID-11, CID-10, OMIM" group (§7.4 step 4) — the next natural pick is
  whichever source appears next in §7.4 after that group (not
  re-confirmed this session; check the doc before assuming an order).
  Remaining, by name: HGNC, LOINC, UCUM, DCB, ATC, DUO, Uberon, NCBI
  Taxonomy, Cell Ontology, EDAM. Per this session's confirmed pattern:
  (1) check `dict-01_FONTES.md`'s row for the source's stated
  distribution channel, (2) if nominally gated, check whether the
  authority's public website exposes a release/license signal
  unauthenticated *before* assuming the `'not-live-verifiable'`
  carve-out applies — OMIM is the first source that genuinely needed it,
  not the default outcome for every gated source.
- **#550** — stays open as the tracking issue for the original split
  until #557 fully lands.
- **#551** — full AC7 lifecycle (checkpoint/resume, quarantine recovery,
  rollback). Unchanged, still open.
- **#552** — Neo4j outbox projection (AC9) for TerminologyConcept/
  TerminologyRelation. Unchanged, still open.
- **#553** — compose.dev.yml's "14 Fase 2 sources" comments undercount the
  real total (16). Unchanged, still open, still a quick win — now also
  the likely fix point for #557's own "15" miscount (see above).
- **#554** — #550's own title has the same "14" undercount #553 flagged.
  Unchanged, still open, still a quick win.
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
- **skills-pack#233/#234/#235/#236/#237/#238/#239/#240/#241/#243/#244/#246/#247/#250/#251/#254/#259/#260/#262/#263/#265/#267**
  — pack-repo only, low priority except #267 (this session's OMIM
  overlay update), unchanged otherwise this session. (#266 from the
  prior session should be considered resolved by #267 landing, but that's
  the pack maintainer's call, not this repo's.)

## Dev stack state

Not brought up this session — no Docker/database-dependent code touched.
Same state as the prior handoff left it: torn down, named volumes
(mongodb/neo4j data) untouched, images cached.

## Which skills to use

- `build-loop`'s "check spec docs for recommended order" and "check the
  authority's public website before assuming a carve-out" guidance both
  paid off again this session — the second one this time by correctly
  *not* resolving into a real `kind`: OMIM's public surface genuinely is
  walled, unlike ICD-11/ICD-10's nominally-gated-but-actually-open case.
  Both outcomes are real possibilities each remaining source needs
  checked fresh, not assumed from precedent either way.
- Confirmed pattern for future #557 sources, unchanged from the prior
  two handoffs, plus this session's addition: (1) read the existing
  fixture source file for `systemUri`/`license`/`licenseUri`, (2) check
  `dict-01_FONTES.md`'s row for the source's stated distribution
  channel, (3) for a nominally API-key-gated source, check whether the
  authority's public website exposes the release/license signal
  unauthenticated — but if it comes back genuinely negative (not just
  "the API needs a key" but "the entire public domain 403s/blocks
  automated access"), that's the `'not-live-verifiable'` carve-out, not
  a reason to keep digging for a workaround; check the domain's
  robots.txt too — an explicit crawl-disallow is corroborating evidence
  and a reason to stop probing rather than try more paths, (4) add the
  registry entry (with the right `kind`, or just `datasetCode`/`kind`/
  `reason` for a carve-out) + npm script + mocked unit tests + run the
  live script natively, re-running the already-landed sources too as a
  regression check whenever `verify-live-release.js` itself changed.
- Confirmed again this session: `.claude/skills/build-loop/local-env/`
  overlay files are junctions into the skills-pack clone — file an issue
  against the pack repo (`DyeAllPies/dyeallpies-skills-pack`, found via
  the sibling checkout's `git remote -v`, not guessed) with exact
  replacement text rather than editing directly.
