# HANDOFF

**Written:** 2026-08-14, end of a fix-bugs batch on
`feature/docker-e2e-backend-integration`. Deliberately picked *outside*
the prior session's `rabbit-hole` (RF021 protocol/consent/study linkage,
tracker `#587`) at Dennis's explicit instruction — he was AFK and asked
for a different, self-contained group of issues. That rabbit hole is
untouched and still exactly where the last handoff left it (see below).

## What landed this session

Worked a batch of independent, native-verifiable (no Docker) bugs from
the open backlog — picked specifically because none needed Dennis's
input to resolve. All merged into `feature/docker-e2e-backend-integration`
and pushed; branch is clean, up to date with `origin`.

- **`#572`** — closed as already-fixed, no code change. Verified all 8
  previously-failing tests across 5 files now pass (110/110); traced to
  commit `67d8ca52` from `#575`'s civil-identity-removal work, which
  covered the same files under a different issue number.
- **`#573`** — `reports.routes.js`'s `samplesbypatient`/`paciente`
  preview branches queried Patient/Sample documents on a `patientID`
  field that's never existed (canonical field is `participantId`) —
  every real preview silently matched nothing. Fixed all 6 call sites;
  updated both test files, which previously only passed by coincidence
  (fixtures set both field names to the same value). Merged `a780cc90`.
  Filed **`#595`** for the same bug class found in the (out-of-scope)
  `sampleAnalysis` branch — not fixed, just flagged.
- **`#571`** — `fhir-import-staging.service.js#commitBatch`'s Patient
  upsert wrote `patientName`/`cpf` directly onto Patient documents.
  The issue's original suggested fix (route `cpf`→`identityDocument`
  through `PatientModel.create()`) turned out stale — `#575` (landed
  after `#571` was filed) already made those civil-identity fields
  fully non-canonical on Patient, and `commitBatch` already dual-writes
  them correctly to `ParticipantIdentity` a few lines below. Fixed by
  dropping the two forbidden fields and adding `sex` (real, available,
  genuinely canonical) instead. Un-weakened the pinned unit test that
  asserted the buggy write. Merged `2146da0e`.
- **`#345`** — `Patient.js` had the same 26-field canonical allow-list
  hand-duplicated twice (`validate()`/`create()`), plus a third,
  independently-hand-copied superset in
  `paciente.controller.js#rejectCanonicalAliases`. Consolidated to one
  exported `PatientModel.CANONICAL_FIELDS`, with the controller building
  its list as that plus the already-existing
  `LEGACY_PATIENT_IDENTITY_FIELDS` constant — a new Patient-document
  field now only needs adding in one place. Added a regression test
  proving the two structurally can't drift again. Merged `91a2fbf3`.
- **`#570`** — investigated, **not fixed, left open**. The actual scope
  turned out much larger than the issue's title ("fix a `cpf` field")
  suggests: `import.controller.js#importFhirBundle` writes
  `participantId` as the Patient's Mongo `_id` (not the canonical string
  business ID), into `samples`/`consents`/`observations`/`conditions`
  collections that aren't even the app's canonical collection names, in
  a `Sample` shape structurally incompatible with `SampleModel`. This
  overlaps an existing, still-unresolved owner question in **`#336`**
  (is this whole endpoint superseded by the FHIR staging pipeline and
  should it be removed, vs. fixed in place) — fixing field-by-field now
  risks the effort being thrown away by whatever `#336` decides. Posted
  full findings as a comment on `#570` rather than guessing. **`#336`
  is the actual blocker for `#570` — needs Dennis's call.**

### Pack issues filed (workflow/hook friction, not product bugs)

Surfaced during this session's `wrap-up` audit — all about this pack's
own hook/skill mechanics, not BioAvanceD-v2 code, so filed against
`dyeallpies-skills-pack` rather than this repo:

- **pack `#309`** — record `import.controller.js#importFhirBundle` as a
  confirmed (but owner-decision-pending) legacy area in
  `bioavanced-v2-legacy`'s register (that skill file is gitignored/
  pack-deployed, not editable from this repo).
- **pack `#310`** — `docs-primacy-guard.cjs`'s `bashRead` detection regex
  doesn't match a Bash `grep` command when either the pattern or the
  path argument is quoted (the normal case) — costs an extra blocked
  round-trip nearly every time.
- **pack `#311`** — observed the Bash tool's cwd not reliably persisting
  past a `cd X && command` compound into the next call, contrary to the
  tool's own description. Not root-caused, just recorded for a pack
  session to investigate.
- **pack `#312`** — suggested a `bioavanced-v2-testing-conventions`
  addition: redirect multi-file `vitest run` output to a file rather
  than letting the app logger's expected-error-path INFO/WARN/ERROR
  noise stream into the conversation (mirrors `docker-workflow`'s
  existing build-log rule).

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed at `91a2fbf3`,
  working tree clean. All four fix branches (`fix/573-...`,
  `fix/571-...`, `fix/345-...`) merged with `--no-ff` and deleted, local
  and remote, after re-verifying targeted tests on the merged tree each
  time.
- Docker/CI gate **not** run this session (every fix was native-provable;
  Docker was never turned on — the prior handoff's `#579`, which
  genuinely needs the live stack to reproduce/fix, was deliberately
  *not* picked up this session for that reason). Still owed at ship time,
  per the end-loaded gate order.
- Issues this session: `#572` (closed, already-fixed), `#573` (closed),
  `#595` (opened, follow-up finding from `#573`, open), `#571` (closed),
  `#570` (open — investigated, deferred to `#336`), `#345` (closed).
  Pack: `#309`/`#310`/`#311`/`#312` (all open, workflow-mechanics
  findings).

## Recommended next steps

Dennis didn't name a specific next task before going AFK — **none
queued**. Candidates below are carried forward from backlog state, not
an instruction to pick any particular one.

- **`#336`** — needs Dennis's actual call (fix vs. retire
  `import.controller.js#importFhirBundle`); `#570`'s full technical
  findings are posted on its own thread and cross-referenced from
  `#336`. Not code-resolvable without that decision.
- **`#579`** (systemic `MongoTopologyClosedError` in the shared e2e Mongo
  singleton helpers, blocking `#331`'s close) — still open, still needs
  the live Docker stack to reproduce/root-cause; deliberately not
  started this session since Docker wasn't on.
- **`#331`** stays open pending `#579`.
- The prior session's **rabbit hole** (`#587` tracker, `rabbit-hole`
  skill, RF021 protocol/consent/study linkage) — untouched this
  session. Per the last handoff: `#591` (inactive-protocol enforcement
  in `sample.service.js`) is next inside it, `#592` (its e2e coverage)
  depends on `#591`. Re-derive `#587`'s current membership via
  `gh issue view 587` before resuming — don't trust any cached summary,
  this one included, since it's changed twice already across prior
  sessions.
- `deniseribeiro-beep/BioAvanceD-v2#585` — repo-owner call on reviving or
  retiring `playwright-runner`/`frontend-unit-runner`. Not
  code-resolvable.
- `deniseribeiro-beep/BioAvanceD-v2#586` — re-identification authorization
  follow-up for `toFhirPatient`, not urgent, no live caller yet.
- Skills-pack `#297` (no graceful loop exit) — still open, needs the
  harness team.
- Skills-pack `#294` (blocked-item-skip dogfood) — still open, still no
  organic case.
- pack-repo `#279`/`#280`/`#281`/`#283`/`#248`/`#270`/`#286`/`#301` —
  unchanged, not checked this session.
- pack-repo `#309`/`#310`/`#311`/`#312` — new this session, see above.
