# HANDOFF

**Written:** 2026-08-01, after closing #392 (dict-02: SpecimenPreanalytics
fuller canonical field set, `build-loop`, Docker on for the session but not
needed for this slice) on `feature/docker-e2e-backend-integration`.

## What happened this session

Continuation of the same day's prior sessions (which closed #393 and #369).
Dennis asked for a larger issue with Docker on; #389 (storage/custody
separation) was ruled out because it explicitly requires `divide-and-conquer`
scoping before any implementation, and #390 is blocked on #389 — #392 was
picked instead: self-contained, no dependency on #389/#390, sized for one
build-loop iteration.

**#392's ask:** dict-02 defines a fuller `SpecimenPreanalytics` field set
than #388 landed — `sprecCode`, `sprecVersion`, `sprecSpecimenType`,
`sprecPrimaryContainer`, `sprecCollectionType`, `warmIschemiaTime`,
`coldIschemiaTime`, `fixationStabilizationType`, `fixationTime`,
`sprecProfileId`, `profileStatus` — none parsed or computed anywhere.

**Key finding that resolved the scope ambiguity:** most of those fields
aren't new raw inputs. `frontend/src/constants/sprecDictionary.js`'s
`SPREC_FLUID_DICTIONARY`/`SPREC_SOLID_DICTIONARY` already encode that the
entity's existing axis-position slots (`matrixType`/`sampleType`/
`primaryContainer`/`preCentrifugation`/`centrifugation`/
`secondCentrifugation`/`postCentrifugationDelay`, landed in #388) mean
different dict-02 concepts depending on fluid vs. solid `matrixType` — e.g.
axis 2 is `sprecPrimaryContainer` for fluids but `sprecCollectionType` for
solids; axis 3-6 are the fluid centrifugation fields for fluids but
`warmIschemiaTime`/`coldIschemiaTime`/`fixationStabilizationType`/
`fixationTime` for solids. That dictionary was never wired to the backend
entity. Only `sprecCode`/`sprecVersion` were genuinely new pass-through
values needing new CSV columns (`sprec_code`/`sprec_version`).
`sprecProfileId` is generated per snapshot (`crypto.randomUUID()`, same
pattern as `PatientConsentModel`'s `consentId`); `profileStatus` defaults to
`draft`.

**Fix** (`test/392-specimen-preanalytics-canonical-fields`, merged into
`feature/docker-e2e-backend-integration` at `49cec506`, fix commit
`83ca3cb8`; doc cross-reference follow-up at `2037eba0`): derivation logic
added to `SpecimenPreanalyticsModel.fieldsOf()`
(`api/backend/src/models/SpecimenPreanalytics.js`); two new CSV column
aliases added to `import.service.js`'s `parseSampleCSV`. No change to how
the existing 8 fields are parsed. `docs/architecture/canonical-data-
contract-v1.md`'s `SpecimenPreanalytics` section updated with the full
field list and the derivation rationale.

**Verified:** wrote failing tests first (13 failing assertions across
`tests/unit/models/specimenPreanalytics.model.test.js` and
`tests/unit/import.service.sprec.test.js` — fluid/solid derivation, UUID
generation/uniqueness, defaults, sprecCode/sprecVersion passthrough),
confirmed red, implemented, confirmed green. Targeted run across
specimen-preanalytics/import/sample suites — 220 tests green on the fix
branch, re-confirmed on the merged integration tree. Wider net
(import.service.importLocationsTemperature/importPatients/importSamples/unit,
quality-domain.service.unit, rcs-certification.service, quality.preview.api)
— 143 more tests green. `npm run lint` clean (311 files). Docker was on for
the session (build-loop's default) but not invoked — per the BioAvanceD-v2
build-loop overlay, a backend-internal slice like this one (not the
milestone's own e2e Playwright spec) is proven at the native/mocked-
collection tier, which was already the strongest applicable proof.

**Issue #392 closed** (comment noting merge commit `49cec506`). Fix branch
deleted locally; **remote delete was denied by the auto-mode permission
classifier** (a documented `fix-bugs` step that the harness blocks — filed
as a pack issue, see below) — `test/392-specimen-preanalytics-canonical-
fields` still exists on `origin`, already merged, harmless, needs manual
cleanup or an explicit permission grant.

**One follow-on issue filed** while closing out #392 (wrap-up's shipping
addendum — the doc update named a real, undocumented gap that #392 itself
declined to touch):
- **#396**: dict-02's `preCentrifugationDelay` (ELM-0150) and
  `firstCentrifugation` (ELM-0151) — the fluid-axis canonical names for the
  entity's existing `preCentrifugation`/`centrifugation` slots — still
  aren't added under their canonical names (only `postCentrifugationDelay`/
  `secondCentrifugation`, ELM-0152/0153, already matched exactly and needed
  no follow-up). Likely resolution is the same derivation pattern #392 used
  for the solid axis, just for fluid. Not started.

**Three findings filed against `dyeallpies-skills-pack`** (Rule 0 — these
are pack-junction files, not editable from this repo):
- **pack#182**: `build-loop`'s BioAvanceD-v2 overlay should note to check
  `frontend/src/constants/` for an existing semantic dictionary before
  assuming a dict-02 "missing" field needs new raw CSV parsing (the #392
  key finding above, generalized for #389/#390/future dict-02 gaps).
- **pack#183**: `fix-bugs`' "Ending an iteration" documents remote
  branch-delete as normal; the auto-mode permission classifier denies it
  outright even for an already-merged branch. Suggested text to name this
  explicitly so a future session doesn't retry/work around it.
- **pack#184**: `Grep`'s content output mangled forward-slash paths
  (backslash conversion, dropped slashes) inside matched text under a wide
  `-A: 60` context call, reproduced twice on the same file/line — cost one
  failed `Edit` `old_string` match. Not reproduced with a narrow
  single-line pattern on identical underlying text.

## Repo state

- **`feature/docker-e2e-backend-integration`**: at `2037eba0`, **in sync
  with origin** (nothing outstanding to push). Working tree clean except
  the pre-existing `catalog.1.3.0.json` phantom line-ending diff (#391 —
  still open/unfixed, still a no-op, untouched again this session).
- Issues: **#392 closed** (`49cec506` / `83ca3cb8` noted in the close
  comment). **#396 newly opened** (enhancement-labeled, unstarted).
- `test/392-specimen-preanalytics-canonical-fields` (merged): deleted
  locally; **still on origin** — remote delete was denied by the
  permission classifier (see pack#183 above), needs manual cleanup.
- Untouched from before: **#389** (storage/custody separation, open, needs
  `divide-and-conquer` scoping first), **#390** (multi-consumer migration,
  open, depends on #383+#388+#389), **#391** (`.gitattributes` phantom-diff
  fix, open, small/mechanical), **#394** (audit_events historical gap,
  open, owner-judgment question), **#395** (intake-wizard mocked-auth
  flakiness, open, root cause unknown). Local branch hygiene unchanged
  otherwise: everything merged except `test/377-docs-on-main`, tracked by
  still-open **#379**.

## Blocking next step

None. Nothing queued as blocking.

No next issue queued explicitly by Dennis. Candidates, roughly by
size/readiness:
- **#396** (fluid-axis canonical field names): small, same pattern as
  #392's own fix, self-contained follow-up to this session's work.
- **#391** (`.gitattributes`): smallest, mechanical.
- **#395** (intake-wizard mocked-auth flakiness): needs investigation
  first — root cause genuinely unknown, no pinned test.
- **#394** (audit_events historical gap): an owner-judgment question
  more than a code fix — read it and decide whether backfill/monitoring
  work is wanted before treating it as a coding task.
- **#389**/**#390**: unchanged from prior handoffs, see below.

## Which skills to use

- **#396** (fluid-axis canonical names): `build-loop`, same shape as #392
  — derive `preCentrifugationDelay`/`firstCentrifugation` from the
  existing `preCentrifugation`/`centrifugation` slots when `matrixType`
  is `fluid`, mirroring `SpecimenPreanalyticsModel.fieldsOf()`'s solid
  branch already landed this session.
- **#391** (`.gitattributes`): small, mechanical `resolve-issue`.
- **#395** (intake-wizard flakiness): `fix-bugs`, budget time for
  investigation — likely a mocked-auth/`page.route` or client-side
  session-timing issue, not yet reproduced.
- **#394** (audit_events historical gap): not a `fix-bugs` candidate as
  filed — it's asking for an owner decision (backfill? louder failure
  mode?) before any code change. Surface it to Dennis rather than
  picking an implementation approach unprompted.
- **#389** (storage/custody entity): scope with `divide-and-conquer`
  first — don't attempt as one slice (28 files, already half-separated
  via `storageBoxes`). Check dict-02's "Entidade" column for the
  canonical name before naming anything (dyeallpies-skills-pack#179).
- **#390**: blocked on #389.
- Backlog unchanged otherwise from prior handoffs: **#384–#387** (four
  architecture-gap issues), older backlog (`#371`/`#373`/`#374`/`#378`/
  `#379`) — untouched this session.
