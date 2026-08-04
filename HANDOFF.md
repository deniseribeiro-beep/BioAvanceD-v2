# HANDOFF

**Written:** 2026-08-04, after closing #398 (Specimen status-field
consolidation design decision) on `feature/docker-e2e-backend-integration`.

## What happened this session

Dennis said to pick up #398 directly ("pick #398, see if docs carry any
clear answer") and confirmed the repo should already be synced re: the
prior handoff's `install-assets.ps1`/pack-#199 staleness concern. **Not
independently reverified this session** — if any hook-staleness symptom
resurfaces (e.g. `edit-branch-guard.cjs` blocking a solo `HANDOFF.md` edit
on a protected branch again), that's the first thing to check, not a new
mystery. Invoked `resolve-issue` via the Skill tool explicitly before
acting, per the standing rule.

**#398 asked three design questions** about collapsing `Sample.js`'s
`lifecycleStatus`/`availabilityStatus`/`quarantineStatus`/`quarantineReason`
onto dict-02's canonical `Specimen.specimenStatus`. Per
`bioavanced-v2-conventions`' "docs/ may already answer a design question"
guidance, checked `dict-02_DICIONARIO.md` and (crucially, since dict-02
alone didn't fully settle it) `requisitos-index.md`'s RF006 before treating
any part of this as needing Dennis's judgment call — it resolved cleanly,
no owner input needed. Full reasoning traced against dict-02, RF006, and
every real read/write site in the codebase (not just the issue's own
narrower scoping pass) is now recorded in
`docs/architecture/canonical-data-contract-v1.md` (new paragraphs under
`### Specimen`, plus a new `### QuarantineAction` section) — that file is
the actual deliverable, this note only summarizes it:

- `lifecycleStatus` → `specimenStatus`, case-folded; `REGISTERED` folds into
  `available` (no dict-02 equivalent, never a distinct blockable state);
  `DISPOSED` needs a **documented local extension** to `specimenStatus`'s
  domain (dict-02's enum lacks it, but RF006 AC#4 requires it as a state
  distinct from `destroyed`) — a real gap between the two Fase-1-authoritative
  docs, not a naming quibble.
- `availabilityStatus` does not survive as its own field — traced every
  write site and confirmed it's always set in lockstep with
  `quarantineStatus`, never independently, so it's a redundant duplicate,
  not new information. (This corrects the issue's own claim that it was
  "never recomputed anywhere found" — it's actively used, just never
  independently of `quarantineStatus`.)
- `quarantineStatus`/`quarantineReason`: current-state folds into
  `specimenStatus`'s `quarantined` value; the event-history part (why,
  started/released timestamps, who authorized) maps to dict-02's separate
  `QuarantineAction` entity (P1X-0113–0119), following the
  `RcsAssessment`/`SpecimenPreanalytics` referenced-entity pattern from
  #383/#388. Gap acknowledged: dict-02's own `actionStatus` (P1X-0118)
  domain is under-specified relative to today's three-state
  `quarantineStatus` vocabulary — #399 will need its own local extension
  there too.
- `computeStatus()`'s sticky-quantity semantics carry over unchanged in
  shape — #399 renames the sticky list's contents, not the algorithm.

**Found and filed separately while researching (not part of #398's own
scope):**
[deniseribeiro-beep/BioAvanceD-v2#404](https://github.com/deniseribeiro-beep/BioAvanceD-v2/issues/404)
— `intakeWizard.routes.js`'s governance-block write path sets
`lifecycleStatus` to values (`'BLOCKED'`, `'QUARANTINE'`) that don't match
`sample.service.js`'s own blocking check (`'UNAVAILABLE'|'DESTROYED'|
'DISPOSED'|'QUARANTINED'`), and `equipment-sensor-quarantine.service.js`'s
cold-chain quarantine flow never sets `lifecycleStatus` at all (added as a
follow-up comment on the same issue, same root cause). Net effect: a
sample the intake wizard just blocked for revoked/pending consent, or that
a cold-chain sensor incident just quarantined, is **not actually blocked**
from withdrawal/return today — RF006 AC#4 silently doesn't fire for these
paths. Real bug, independent of #398's decision, but a concrete argument
for #399 landing soon (a single `specimenStatus` write eliminates this
whole class of drift). Left open, not fixed — deliberately out of scope
for a decision-doc issue, and picking a fix casually risks being obsoleted
by #399's own consolidation.

**No wrap-up friction this session** — clean run scope-wise (only the one
doc file touched, matching #398's own "decision doc, not code" scope) and
a clean confirmation of the existing "check docs first" convention: both
docs together resolved all three questions without needing to defer to
Dennis, including surfacing a genuine dict-02/RF006 mismatch neither doc
alone would have shown.

## Repo state

- **`feature/docker-e2e-backend-integration`**: #398's decision doc merged
  (`git merge --no-ff`, commit visible in the branch's history as "Merge
  test/398-specimen-status-decision"; the doc commit itself is
  `bc69a765`) and pushed to origin — this push also carried the prior
  session's already-committed-but-unpushed `953517da` (".claude: record
  deployed-assets manifest (pack #199)"), which had been sitting 1 commit
  ahead of origin since before this session started. Branch
  `test/398-specimen-status-decision` merged, closed out, deleted (local +
  remote, no classifier block).
- Issues: **#398 closed** (merge to main still pending — noted explicitly
  in the close comment, consistent with every prior rotation). **#399 now
  unblocked** — its only dependency was #398's decision, which is now
  recorded; ready to implement. **#404 opened this session** (governance
  lifecycleStatus-sync bug, see above) — open, unfixed. **#389** (parent
  tracking issue for the storage/custody series) still open, unchanged.
  **#401, #402** still open, unstarted, unchanged.
- No other branches created, merged, or deleted this session. Branch list
  otherwise unchanged from prior rotations (long-lived `test/*` branches
  from earlier sessions untouched — not re-audited this session beyond the
  standard pre-pickup hygiene check, which found no stale branch for
  #398).

## Blocking next step

None. Nothing queued as blocking.

No next issue queued explicitly by Dennis this session — he asked only to
pick up #398. Candidates:

- **#399** — **now unblocked**, and the most natural next pick given this
  session's decision: implement the `specimenStatus`/`QuarantineAction`
  consolidation exactly as recorded in
  `docs/architecture/canonical-data-contract-v1.md`, including the two
  documented local-extension gaps (`disposed` value, `actionStatus`
  domain). Per `divide-and-conquer`, #398's own issue text calls for this
  to land as one atomic change, not incrementally.
- **#404** — the governance lifecycleStatus-sync bug found this session;
  no dependency, but touches the same fields #399 is about to consolidate
  — consider sequencing after #399 or at least being aware #399 may
  obsolete whatever fix #404 would otherwise need.
- **#401** — no dependency, likely near-trivial (confirm ledger-backed
  quantity fields are already correct; probably naming-only or no-op).
- **#402** — no dependency, low priority (`StorageAssignment`
  placement-history feature gap, not cleanup).
- Older backlog, all unchanged from prior handoffs: **#384–#387** (four
  architecture-gap issues), `#371`/`#373`/`#374`/`#378`/`#379`.

## Which skills to use

- **Whichever of #399/#401/#402/#404 is picked up next: invoke
  `resolve-issue` (and `fix-bugs` if it's #404, since that one is a bug —
  build/design items like #399 skip `fix-bugs`) via the Skill tool
  explicitly before acting** — same rule as every prior handoff, still
  holding.
- **#399 specifically**: re-read #398's close comment and the
  `canonical-data-contract-v1.md` sections it added before touching code —
  the decision's reasoning (why `DISPOSED` and `actionStatus` need local
  extensions, why `availabilityStatus` drops entirely) matters for getting
  the migration right, not just the field-name mapping.
- **#390** (multi-consumer migration once RCS/SPREC/storage-custody
  entities land): still blocked on #399/#401 (no longer #398).
- Backlog unchanged otherwise from prior handoffs: **#384–#387**, older
  backlog (`#371`/`#373`/`#374`/`#378`/`#379`) — untouched this session.
