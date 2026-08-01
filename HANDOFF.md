# HANDOFF

**Written:** 2026-08-01, after closing #388 (SpecimenPreanalytics entity
slice, `build-loop`) on `feature/docker-e2e-backend-integration`.

## What happened this session

Continued the dict-07/dict-08 Specimen entity-separation series (started
last session with #383/RCS). Picked up **#388**: `sprec` on `Sample.js`
is still a single `Schema.Types.Mixed` field; dict-07 row 38 groups SPREC
with RCS under the same "usar referências e snapshots versionados"
directive, resolving #388's own open question (versioned history vs. a
single current record) in favor of the RCS pattern rather than asking
Dennis separately.

**Naming call:** the issue (and dict-07/dict-08) only ever say "SPREC" as
shorthand. `dict-02_DICIONARIO.md`'s "Entidade" column names the actual
canonical entity `SpecimenPreanalytics` (ELM-0145–ELM-0166, P1X-0057–
P1X-0059) — the same substitution #383 made for "RCS" → `RcsAssessment`.
Used that name for the model/collection/service, not the issue's own
shorthand. This is the second time this exact resolution pattern has
come up, so filed a skills-pack issue (dyeallpies-skills-pack#179) to
codify "check dict-02 for the canonical entity name before naming a new
build-loop entity" rather than re-deriving it a third time for #389.

**Landed** (`test/sprec-referenced-entity`, merged into
`feature/docker-e2e-backend-integration` at `a4a375dc`, doc follow-up at
`9ac0ff6a`):

- `api/backend/src/models/SpecimenPreanalytics.js` + `specimenPreanalytics`
  collection (registered in `config/collections.js`), referenced by
  `specimenId`, one document per import — versioned snapshots, mirroring
  `RcsAssessment`. Field set deliberately limited to what
  `import.service.js` already parses (`matrixType`/`sampleType`/
  `primaryContainer`/`preCentrifugation`/`centrifugation`/
  `secondCentrifugation`/`postCentrifugationDelay`/`longTermStorage`) —
  not dict-02's fuller field list, same scope discipline #383 used.
- `api/backend/src/services/specimen-preanalytics.service.js`:
  `recordProfile`/`getProfilesForSpecimen`.
- `import.service.js`'s CSV/XLSX sample-import branch now records a
  snapshot alongside every SPREC profile it already parses (wrapped in
  try/catch — non-fatal if it fails, `Sample` keeps its own embedded
  copy either way, same pattern as the RCS wiring right above it).
- `GET /api/samples/:id/sprec-profiles` resolves the versioned history,
  mirroring `GET /:id/rcs-assessments`.
- `docs/architecture/canonical-data-contract-v1.md`: new
  `### SpecimenPreanalytics` section with "Landed in #388" / "Not yet
  landed" split; updated `### Specimen`'s note to reflect both RCS and
  SPREC as landed, storage/custody still outstanding.
- Tests (all native, no Docker — backend-internal slice):
  `tests/unit/models/specimenPreanalytics.model.test.js`,
  `tests/unit/services/specimen-preanalytics.service.test.js` (real
  query-matching fake collection), plus extensions to
  `import.service.sprec.test.js`, `sample.service.test.js`,
  `sample.routes.test.js` proving the write→read round trip.

`Sample.js`'s own embedded `sprec` field is untouched — additive, not a
migration. 299 targeted + broader sample/import tests all green; full
native suite not re-run this session (end-of-loop gate, this was one
slice).

**Follow-ups filed this session:**
- **#392** (BioAvanceD-v2) — dict-02's fuller `SpecimenPreanalytics`
  field set (`sprecCode`, `sprecVersion`, `sprecProfileId`,
  `profileStatus`, `warmIschemiaTime`, `coldIschemiaTime`,
  `fixationStabilizationType`, `fixationTime`, the solid/fluid axis
  element codes) isn't parsed or computed anywhere in the codebase —
  notably `sprecProfileId`/`profileStatus` are dict-02 `1..1 Core` and
  the current entity has neither.
- **dyeallpies-skills-pack#179** — codify the "check dict-02 for the
  canonical entity name" naming lesson (see above) into
  `bioavanced-v2-conventions` or `build-loop`'s overlay.

## Repo state

- **`feature/docker-e2e-backend-integration`**: at `9ac0ff6a`, working
  tree clean except the pre-existing `catalog.1.3.0.json` phantom
  line-ending diff (#391 — safe to ignore, confirmed no-op again this
  session). **Not yet pushed to origin** — branch is 3 commits ahead of
  `origin/feature/docker-e2e-backend-integration` (the #383 merge from
  last session was already pushed; this session's #388 merge + doc
  follow-up are not).
- Issues: **#388 closed** (`a4a375dc` noted in the close comment, #392
  follow-up named explicitly). **#392 opened** (BioAvanceD-v2, open).
  **dyeallpies-skills-pack#179 opened** (skills-pack repo, open — not a
  BioAvanceD-v2 issue, don't look for it in this repo's tracker).
- `test/sprec-referenced-entity` (merged) deleted locally — no remote
  copy was ever pushed.
- Untouched from before: **#389** (storage/custody separation, open),
  **#390** (multi-consumer migration, open, depends on #383+#388+#389),
  **#391** (`.gitattributes` phantom-diff fix, open, small/mechanical).

## Blocking next step

None. Nothing queued as blocking.

No next issue queued explicitly by Dennis — #389/#390/#391/#392 are the
natural continuation of this thread if picked up next, but that's an
inference from this session's own work, not something Dennis said.

## Which skills to use

- **#389** (storage/custody entity): scope with `divide-and-conquer`
  first — don't attempt as one slice, it's the largest of the three
  (28 files, already half-separated via the existing `storageBoxes`
  infrastructure). When naming the entity/collection, check dict-02's
  "Entidade" column first per the #179 lesson above — dict-07/dict-08
  only say "storage/custody" as shorthand, dict-02 likely has its own
  name for it.
- **#390** (multi-consumer migration): blocked on #389 landing; when
  picked up, likely its own `divide-and-conquer` pass per consumer group
  (mirrors how #368 approached the analogous Participant migration).
  Re-audit needed at pickup time — its known-consumers list predates
  #388, so it doesn't yet enumerate SPREC-specific consumers the way it
  does for RCS.
- **#391** (`.gitattributes`): small, mechanical `resolve-issue` — add a
  line-ending rule, renormalize, done in one sitting.
- **#392** (dict-02's fuller SpecimenPreanalytics fields): `build-loop`,
  same shape as #383/#388 but needs new parsing logic (nothing today
  computes `sprecCode`/`sprecProfileId`/`profileStatus`/ischemia-time
  fields), not just a referenced-entity wrapper around existing data —
  scope accordingly, may not be a single-sitting slice.
- Backlog unchanged otherwise from the prior handoff: **#384–#387** (four
  remaining architecture-gap issues — eConsent legacy route, Neo4j
  outbox keys, RBAC normalization, AuditEvent contract — each likely
  `divide-and-conquer` or `build-loop` sized individually, needs its own
  scoping pass). Older backlog from prior handoffs (`#371`/`#373`/
  `#374`/`#375`/`#376`/`#378`/`#379`) is unchanged — still open, not
  touched this session.
