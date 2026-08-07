# HANDOFF

**Written:** 2026-08-07, end of session on `feature/docker-e2e-backend-integration`,
after closing #389.

## What happened this session

Dennis said "pick #390". Investigating #390 (migrate remaining
`Sample.js` consumers off embedded Specimen/SPREC/RCS/storage fields)
found it still genuinely blocked: it depends on #389 (storage/custody
entity separation), which was still open. Asked Dennis how to proceed;
chose to work #389 instead of #390 directly.

Reading #389 (routed via `work-issue`) showed it was a **tracking
issue**, already split via `divide-and-conquer` across two rounds of
follow-up issues — all of them closed:

- First round: #400, #398, #399, #401, #402
- Second round (re-split): #449, #450, #451

#389's own text says "closes once all three [second-round issues] land"
— they had. No code change was needed; this was pure issue-tracker
hygiene. Routed to `resolve-issue` (close-discipline case 3: confirmed
resolved, no change needed) and closed #389 with a comment listing all
eight completed sub-issues.

No branch created, no commits, no product code touched this session.

## Repo state

- **`feature/docker-e2e-backend-integration`**: at `1ba5a184`, pushed,
  clean — unchanged this session except for this HANDOFF.md rotation.
- No dangling branches from this session.
- Issues this session: **#389 closed** (tracking issue, all 8
  sub-issues already done, no code change).

## Which issue is next

**#390 is now unblocked** — its stated dependency (#389) is closed.
Dennis has not yet said to pick it up next session; per this skill's
"only if the user explicitly said so" rule, nothing is queued.

Candidates, in likely priority order:

1. **#390** — now unblocked (see above). Its own body warns it's large
   ("Likely needs its own `divide-and-conquer` pass per consumer group,"
   mirroring #368's approach) — scope it with `divide-and-conquer`
   before implementing, don't attempt as one slice. Known consumer
   groups from the issue body: `MerkleService.js`, the neo4j outbox
   projection, `frontend/src/config/constants/specimen.constants.d.ts`
   and its views, the live `POST /api/samples` registration path (needs
   a design decision on RCS computation), `import-lgpd.service.js`'s
   separate RCS-computing CSV logic, `import.service.js`'s JSON-import
   branch, and everything in `docs/architecture/canonical-data-contract-v1.md`'s
   "Known Residual Legacy Surfaces" section. **Re-audit the consumer
   list at pickup time** — #389's own scoping found the field list
   understated reality (three competing legacy schemes, not one), so
   #390's list should get the same skepticism.
2. **#489** — full-suite vitest flakiness (89/360 files fail on a bare
   `npx vitest run`, unrelated to any recent diff, broadened scope of
   closed #423). Carried forward from prior handoffs, not yet picked up.
3. Older backlog: `#371`/`#373`/`#374`/`#378`/`#379`, `user.accessType`
   grep sweep, dangling merged branches (`test/440-*`, `test/441-*`,
   `fix/444-retention-period-iso8601`, `fix/450-*`,
   `fix/476-quarantine-status-design-call`,
   `fix/485-sample-details-storage-migration`,
   `test/486-storage-move-sample`, `test/488-inline-storage-movement-e2e`
   — all safe to delete, low priority housekeeping, unchanged from prior
   handoffs).
4. **Next e2e slice** (per `E2E_TRACEABILITY_PLAN.md` and
   `playwright-specs`' spec inventory) — check issue #95's tracking
   thread once skills-pack#227 (filed last session) lands the new spec
   in the inventory.

## Dev stack state

Nothing started this session — pure `gh issue` read/close work, no
native or Docker processes.

## Which skills to use

- `work-issue` -> checked #390's stated dependency (#389) before
  routing, found it unmet, escalated to the user via `AskUserQuestion`
  rather than assuming — correct per this skill's "if the issue already
  carries ... a design/blocker claim, re-check before routing onward"
  spirit, applied here to a dependency claim instead.
- `work-issue` -> `resolve-issue` was the right route for #389 once its
  actual content turned out to be "tracking issue, all sub-issues
  closed" rather than a #390-style migration — worth checking a tracking
  issue's sub-issue states *before* assuming it needs the same route as
  its subject matter.
- No friction this session (see `wrap-up`'s audit, run immediately
  before this rotation) — nothing to file against the pack or the repo.
