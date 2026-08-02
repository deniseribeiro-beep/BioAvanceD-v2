# HANDOFF

**Written:** 2026-08-02, after scoping #389 (storage/custody separation off
`Sample.js`) on `feature/docker-e2e-backend-integration`. No code changed
this session — pure scoping/tracker work.

## What happened this session

Dennis picked "#389" directly from the prior handoff's candidate list.
Invoked `resolve-issue` then `divide-and-conquer` explicitly via the
Skill tool before acting — #389's own body said to scope it with
`divide-and-conquer` before implementing (28 files, the largest of the
three entity-separation issues).

The scoping audit found more than the issue's own text anticipated: not
one legacy path duplicating the already-clean `storageBoxes` layer, but
**three competing legacy physical-location schemes** writing to
`Sample.js` (`/api/locations`'s numeric `locationID` catalog,
`sample.service.js`'s inline `location: {freezer,rack,box,position,status}`,
and a third shape written by `StorageAllocationService.ts` — confirmed
**dead code**, unwired anywhere, with a live undefined-variable bug),
plus a genuine design decision (`lifecycleStatus`/`availabilityStatus`/
`quarantineStatus` should collapse to dict-02's single `Specimen.
specimenStatus` enum, but that's a design call, not a mechanical rename).
Cross-checked field names against `dict-02_DICIONARIO.md`'s "Entidade"
column per this repo's naming convention (confirmed again on #383/#388,
dyeallpies-skills-pack#179) rather than trusting the issue's own informal
"storage/custody" wording.

Split into five tracked issues (all referencing #389 as originating
issue), confirmed with Dennis via AskUserQuestion before filing:

- **#400** — sever `sample.service.js`'s legacy `location`/`locationId`
  writes onto the existing `storageLocation`/`storageBoxes` path; delete
  dead `StorageAllocationService.ts`. No dependency — the mechanical,
  load-bearing chunk.
- **#398** — design decision: collapse `lifecycleStatus`/
  `availabilityStatus`/`quarantineStatus`/`quarantineReason` into
  `Specimen.specimenStatus`. No dependency; a decision doc, not code.
- **#399** — implement #398's decision. **Depends on #398.**
- **#401** — confirm `availableQuantity`/`originalQuantity`/
  `totalWithdrawn`/`totalReturned` are already correctly ledger-backed
  (they are — atomic with the hash-chained `SampleMovement` ledger under
  RF006 AC#6); likely resolves as naming-only or no-op.
- **#402** — dict-02's `StorageAssignment` placement history
  (`placedAt`/`removedAt`) isn't tracked anywhere; a feature gap, not
  part of the duplication-cleanup series. Filed after a `wrap-up` audit
  caught it sitting as an unlinked "flagged for awareness, not filed"
  mention in #400's body and the #389 tracking comment — corrected with
  a follow-up comment on #389 pointing to #402.

#389 left open as the tracking issue, with a comment listing the
breakdown (plus the #402 correction as a second comment).

**Workflow friction this session:** one real finding, self-corrected —
see #402's filing above. Otherwise clean: no scope creep, no lazy
fixes, no edits outside the scoping task. (Two non-findings, both
already covered by existing skills-pack issues, not re-filed: Windows
skill-junction traversal limits on `local-env` lookups — #157/#168 — and
a ripgrep lookaround-syntax error immediately retried around.)

## Repo state

- **`feature/docker-e2e-backend-integration`**: unchanged this session
  until this HANDOFF rotation, which landed on a fresh
  `test/389-handoff-rotation` branch (per branch-guard: no direct edits
  on `feature/docker-e2e-backend-integration`). Should be merged in and
  the branch deleted once this commit lands, same as prior handoff
  rotations.
- Issues: **#389 open** (tracking issue, not resolved — five follow-ups
  filed against it, none started). **#398, #399, #400, #401, #402 all
  open, all unstarted.**
- No other branches created, merged, or deleted this session.
- Untouched from before: `test/392-specimen-preanalytics-canonical-fields`
  (merged, from an earlier session) — still presumed on origin per the
  last check, carried forward across multiple handoffs now, not
  re-checked this session. Older backlog (`#371`/`#373`/`#374`/`#378`/
  `#379`, `#384`-`#387`) also untouched. Local branch hygiene otherwise
  unchanged: everything merged except `test/377-docs-on-main`, tracked
  by still-open **#379**.

## Blocking next step

None. Nothing queued as blocking.

No next issue queued explicitly by Dennis this session — he asked only
to scope #389, not to continue into implementation. Candidates, with
the dependency structure from this session's scoping:

- **#400** — no dependency, the load-bearing chunk of the #389 series;
  natural first pick if continuing this series.
- **#398** — no dependency, but is itself a blocker for #399 (design
  decision before implementation).
- **#401** — no dependency, likely near-trivial (confirm + maybe rename).
- **#402** — no dependency, low priority (feature gap, not cleanup).
- **#399** — **blocked on #398** until that decision is recorded.
- Older backlog, all unchanged from prior handoffs: **#384–#387** (four
  architecture-gap issues), `#371`/`#373`/`#374`/`#378`/`#379`.

## Which skills to use

- **Whichever of #398/#399/#400/#401/#402 is picked up next: invoke
  `resolve-issue` via the Skill tool explicitly before acting** — same
  rule as every prior handoff, still holding.
- **#390** (multi-consumer migration once RCS/SPREC/storage-custody
  entities land): still blocked on #389's series landing, i.e. now on
  #398/#399/#400/#401 specifically, not #389 itself (#389 stays open as
  a tracking issue but its actual work moved to the five split issues).
- Backlog unchanged otherwise from prior handoffs: **#384–#387**, older
  backlog (`#371`/`#373`/`#374`/`#378`/`#379`) — untouched this session.
