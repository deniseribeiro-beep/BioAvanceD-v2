# HANDOFF

**Written:** 2026-08-20, end of this sitting. Picked up right after the
prior rotation's close (RF025/RF026 landed, RF029 split into #668-674).
Dennis said "continue rabbit hole... free to divide and conquer" — no
mid-workflow prompts. This sitting landed **#669** and **#670** (RF029
slices 1/6 and 2/6), filed three follow-ups, and fixed a second stale
traceability-plan cell found along the way. Stopping here to report back
rather than starting a third large item unprompted — see "Recommended
next steps."

## What landed this sitting

- **#669 (RF029 slice 1/6: ingestion gateway foundation) — shipped,
  merge `0d421c05`.** The generic machinery #670-674 all depend on: a
  provenance envelope (field names reuse dict-02's `BaseRecord`
  vocabulary), a generalized canonical-contract + alias +
  reference-existence validator, an active-reference-code cross-check
  against `TerminologyConcept`/`ReferenceDatasetRelease`, an
  idempotency-key claim/replay mechanism, and a per-record quarantine
  model+lifecycle — composed into one `ingestRecord()` call. No entity
  is wired to it directly (proven via a NODE_ENV+shared-secret-gated
  test-support route, same shape as `iot.routes.js`'s telemetry-monitor
  routes). 62 unit tests + 1 architecture test + 3 real-backend e2e
  tests, all green; full native suite re-run clean (391/391 files,
  7340/7340 tests, up from 384/7282). Full writeup: #669's own closing
  comment and #668's "Slice 1/6 ... landed" comment.
- **#670 (RF029 slice 2/6: participants/consents/specimens/clinical
  data) — shipped, merge `5c92a08c`.** Scoped down mid-flight (see
  below) to: prove the gateway against real `canonical.v1` schemas +
  real reference data via the same test-support probe, rather than
  building new production ingestion routes. Extracted
  `canonical.v1.clinicalData` out of `intakeSchema`'s own inline
  `clinical` shape (behavior-preserving — 64/64 existing
  intakeWizard/contract tests unchanged) so it's independently
  referenceable. 6 new unit tests + 7 new real-backend e2e tests, all
  green; full `pipeline-continuity.spec.ts` re-run clean (33/33). Full
  writeup: #670's own closing comment and #668's "Slice 2/6 ... landed"
  comment (includes an open coordination question for #671-674: extend
  the probe-route proof pattern again, or is one of those the right
  place for a real production `/api/ingestion/*` surface? — not
  resolved, flagged for a deliberate choice each time).
- **Doc fix**: `E2E_TRACEABILITY_PLAN.md`'s RF005 row was stale (still
  read RED for "ParticipantIdentity segregation not implemented," which
  has actually been done since the #560-566/574/575 series) — found
  while scoping #670, corrected in its own small commit.

## Three follow-ups filed this sitting (all open, none blocking)

- **#675** — the new ingestion test-support route (#669) accepts a
  fully attacker-controlled body and persists it on the quarantine
  path — a strictly more sensitive shape than the existing
  `iot.routes.js` precedent (write primitive, not just a trigger). Not
  urgent (no production deployment exists yet) but flagged before one
  does.
- **#676** — `activeCodeValidator`'s unversioned-code lookup (the
  common case) silently picks newest-`validFrom` on a tie. Asks whether
  that's the right default before #670-674 (now #671-674) lean on it —
  #670 itself didn't hit this ambiguity in practice (its one
  active-code test used a real, unambiguous fixture) but the design
  question stands.
- **#677** — RF005 AC4-6 (structured clinical/diagnostic/phenotypic
  data — dict-02's 10-entity "Dados clínicos" domain: `Encounter`/
  `Condition`/`PhenotypeObservation`/etc.) has no models anywhere in
  the codebase. RF029 slice 2 (#670) deliberately did not build this —
  it's RF005's own scope, comparable in size to a full RF. Whoever
  picks this up: likely its own multi-slice build, similar shape to
  RF025/RF026.

Also filed **dyeallpies-skills-pack#354** (not this repo, per
skill-maintenance Rule 0) — a `build-loop` overlay addition: dict-02's
`BaseRecord` entity governs shared cross-cutting field vocabulary, not
just per-entity field names.

## Rabbit-hole state: still open, not exited

**#646 stays open** (RF029/#668 is the one Wave 3 RF not yet done) and
**so does #668** (4/6 RF029 slices remain: #671-674). Next concrete
pickup: **#671** (telemetry — described in #668's own design notes as a
thin wrap of the existing InfluxDB write path, RF009, through slice 1's
machinery). #674 stays blocked on RF027 (not yet scheduled). Both #646
and #668 carry full queue state; this file is a snapshot.

## Repo state

- On `feature/docker-e2e-backend-integration`, 10 commits ahead of
  `origin/feature/docker-e2e-backend-integration` — not yet pushed.
  Working tree clean except the gitignored/junctioned `.claude/skills/`
  and the pre-existing untracked `api/backend/storage/assays/` (neither
  this sitting's doing).
- No PR to `main` exists.
- **Docker**: test stack (`compose.test.yml`) was up the whole sitting
  (rebuilt twice — #669's new source, then #670's) — **being torn down
  now** (`compose down`, no `-v` — named volumes untouched, so fixtures/
  RBAC seed persist for the next bring-up).
- All 6 of this sitting's slice/doc-fix branches (`test/669-...` ×3,
  `test/677-rf005-traceability-staleness-fix`, `test/670-...` ×3) were
  merged and deleted locally; none were ever pushed remotely.
- The two pre-existing dangling local branches (`test/377-docs-on-main`,
  `test/human-showcase-video`) remain untouched, as before.
- **Full-suite cadence note**: `full-suite-guard.cjs` blocked a bare
  `npx vitest run` attempted twice late this sitting (once as a
  post-#670 regression re-check, once as an end-of-sitting reconcile) —
  its own message clarifies full-suite runs are reserved for the
  `ship-integration-branch` gate specifically, not every rabbit-hole
  checkpoint. The one full-suite run that *did* succeed earlier (after
  #669, 391/7340 green) stands as this sitting's regression baseline;
  #670's own targeted coverage (64/64 existing + 6/6 new unit + 33/33
  e2e) is the evidence for its own no-regression claim. Next session:
  don't re-attempt a bare full-suite run outside the actual ship gate.

## Recommended next steps

Dennis's "continue, free to divide and conquer" instruction still
stands — this sitting stopped after 2 slices (both larger than their
"thin"/"foundation" framing suggested, given the RF005 scope-discovery
detour on #670) as a reasonable checkpoint to report back, not because
anything blocked. Next session: pick up **#671** (telemetry), or address
one of #675/#676/#677, or continue toward #672-673 — all three sit ready
with accurate state either way.
