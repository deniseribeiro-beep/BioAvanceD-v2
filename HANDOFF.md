# HANDOFF

**Written:** 2026-08-01, after closing #396 (dict-02: SpecimenPreanalytics
fluid-axis canonical field names, `build-loop`) on
`feature/docker-e2e-backend-integration`.

## What happened this session

Continuation of the same day's prior sessions (which closed #393, #369,
and #392). Dennis said "Pick #396" directly — no scoping needed, #396 was
already fully specified as a follow-up filed while closing #392.

**#396's ask:** dict-02 names `preCentrifugationDelay` (ELM-0150) and
`firstCentrifugation` (ELM-0151) as the fluid-axis canonical names for the
entity's existing `preCentrifugation`/`centrifugation` slots (#388) — the
fluid-axis counterpart to the solid-axis derivation (`warmIschemiaTime`
etc.) #392 already landed. #392 explicitly declined to touch this because
its own scope was "add the fields explicitly missing," not "rename the
fluid axis to its canonical names."

**Fix** (`test/396-sprec-fluid-axis-canonical-names`, merged into
`feature/docker-e2e-backend-integration` at `3eb1ce9c`, fix commit
`f5c157e3`): same pattern as #392's solid branch, mirrored for fluid —
`SpecimenPreanalyticsModel.fieldsOf()`
(`api/backend/src/models/SpecimenPreanalytics.js`) now derives
`preCentrifugationDelay`/`firstCentrifugation` from
`preCentrifugation`/`centrifugation` when `matrixType` is `fluid`, else
`null`. No `import.service.js` change needed — those two source fields
were already parsed by #388. `docs/architecture/canonical-data-
contract-v1.md`'s `SpecimenPreanalytics` section updated: the two fields
added to the field list, and the "stays out of scope" note from #392's
landing paragraph replaced with a "Landed in #396" paragraph.

**Verified:** wrote 2 failing tests first
(`tests/unit/models/specimenPreanalytics.model.test.js` — fluid
derivation + solid/unknown-matrixType null cases), confirmed red (16
passed / 2 failed on the pre-existing suite), implemented, confirmed
green (18/18). Targeted run
(`specimenPreanalytics.model.test.js` + `import.service.sprec.test.js`,
26 tests) and a wider net matching #392's prior verification
(`import.service.importLocationsTemperature/importPatients/
importSamples`, `quality-domain.service.unit`,
`rcs-certification.service`, `quality.preview.api` — 116 more tests) all
green, both on the fix branch and re-confirmed on the merged integration
tree. `npm run lint` clean (311 files). No Docker: this is the same
backend-internal-only shape as #392 (no new e2e Playwright flow), proven
at the native/mocked-collection tier per the BioAvanceD-v2 build-loop
overlay precedent.

**Issue #396 closed** (comment noting merge commit `3eb1ce9c` / fix
commit `f5c157e3`). Fix branch deleted locally; **remote delete not
attempted** — already a known permission-classifier denial from the
#392 session (filed as dyeallpies-skills-pack#183), so
`test/396-sprec-fluid-axis-canonical-names` is expected to still exist
on `origin` (merged, harmless) pending manual cleanup or a permission
grant, same as `test/392-specimen-preanalytics-canonical-fields` before
it.

**No new follow-on issues filed.** #396 was a complete, self-contained
fix with no deferred sub-points — the SpecimenPreanalytics dict-02 field
set (both axes) is now fully landed.

**No workflow friction this session** (`wrap-up` core audit) — the
iteration reused #392's established pattern exactly (same model method,
same doc section, same test shape, same verification tier), no
deviations, denials, or judgment calls not already covered by precedent
or prior pack issues.

## Repo state

- **`feature/docker-e2e-backend-integration`**: at `3eb1ce9c`, **in sync
  with origin** (nothing outstanding to push). Working tree clean except
  the pre-existing `catalog.1.3.0.json` phantom line-ending diff (#391 —
  still open/unfixed, still a no-op, untouched again this session).
- Issues: **#396 closed** (`3eb1ce9c` / `f5c157e3` noted in the close
  comment). No new issues opened.
- `test/396-sprec-fluid-axis-canonical-names` (merged): deleted locally;
  **still on origin** — remote delete not attempted (known denial, see
  pack#183), needs manual cleanup alongside
  `test/392-specimen-preanalytics-canonical-fields` (same state, prior
  session).
- Untouched from before: **#389** (storage/custody separation, open,
  needs `divide-and-conquer` scoping first), **#390** (multi-consumer
  migration, open, depends on #383+#388+#389), **#391**
  (`.gitattributes` phantom-diff fix, open, small/mechanical), **#394**
  (audit_events historical gap, open, owner-judgment question), **#395**
  (intake-wizard mocked-auth flakiness, open, root cause unknown). Local
  branch hygiene unchanged otherwise: everything merged except
  `test/377-docs-on-main`, tracked by still-open **#379**.

## Blocking next step

None. Nothing queued as blocking.

No next issue queued explicitly by Dennis. Candidates, roughly by
size/readiness:
- **#391** (`.gitattributes`): smallest, mechanical.
- **#395** (intake-wizard mocked-auth flakiness): needs investigation
  first — root cause genuinely unknown, no pinned test.
- **#394** (audit_events historical gap): an owner-judgment question
  more than a code fix — read it and decide whether backfill/monitoring
  work is wanted before treating it as a coding task.
- **#389**/**#390**: unchanged from prior handoffs, see below.

## Which skills to use

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
