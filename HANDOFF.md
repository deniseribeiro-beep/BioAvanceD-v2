# HANDOFF

**Written:** 2026-08-18, continuation session (twenty-third update). Very
long sitting: user continued past the advisory budget four times
(confirmed via explicit choices each time, not silent overrun). **Still
inside the rabbit hole**, tracker **#618** ("organization-scope enforcement
+ RBAC gaps"). Seven items landed this sitting (#616, #617, #619, #620,
#622, #623, #624); #621 surfaced and explicitly deferred (still open)
pending Dennis's design input.

## Rabbit hole state

- **Tracker:** #618, open. Original working order: #340 → #341 → #616 →
  #617 → #602 (#340/#341 landed a prior sitting).
- **Landed this sitting:** #616, #617, #619 (narrowed scope), #620, #622,
  #623, #624.
- **Deferred this sitting (still open, not a fix):** #621 — surfaced via
  AskUserQuestion, confirmed it genuinely needs Dennis's design call (no
  organization reference exists anywhere for Result/Sensor/Equipment/
  Temperature or the saved-Report document itself), user chose to skip it
  for now. Comment posted on #621 documenting the two design options
  surfaced (join Result via its Sample's collectionSite vs. a broader
  per-entity Organization-reference design).
- **Still queued:** #602, #621 (deferred), #625, #626, #627.
- **Budget note:** this sitting ran far past the ~10-point advisory
  allowance — 7 landed items across a very long session, with the
  stopping point surfaced to the user four times via AskUserQuestion and
  explicitly overridden every time. Strongly recommend a fresh sitting's
  budget before picking up more; if resuming immediately, at minimum
  re-confirm with the user rather than assuming continued appetite.

## Issues closed this session

- **#616**: `changeUserRole` preserves additive role assignments (e.g.
  `auditor`) when `accessType` changes. Merged `142f02628`.
- **#617**: `organizationId` on user create/edit validated against the
  `organizations` collection. Merged `82986a0c` at `edb88624`.
- **#619** (narrowed): sample sub-resource read routes enforce
  organization scope. Merged `4090c0be` at `00c0349e`. Split into 4
  follow-ups (#623-#626).
- **#620**: `withdrawalhistory` report type now reads the real sample
  movement ledger instead of a dead collection. Merged `bdb285dd` at
  `3cd82baf`.
- **#622**: `organizationId` now validated inside
  `rbac-assignment.service.js` itself (`validateOrganizationId`, used by
  `resolveScopeForRole` + `updateAssignmentScope`), closing the gap for
  `createFirstAdmin.js`/`backfillUserRoleAssignments`. Merged `c1efb700`
  at `e9c08479`. `migrateRoleAssignmentScopes.js` remains uncovered (raw
  Mongo writes) — filed as #627.
- **#623**: sample mutation routes (withdraw, return, PUT, DELETE) now
  enforce organization scope — fetch the sample via `sampleService.getSample`
  before the mutation runs, 403 on out-of-scope. Merged `1c168230` at
  `21220f10`.
- **#624**: sample `miabis-compliance`/`compliance-graph` routes now
  enforce organization scope — each makes its own separate `getSample`
  call purely for the 403 check, since neither validator exposes the raw
  sample document. Merged `5b0ea923` at `e1f63a19`.

## Filed this session

- **BioAvanceD-v2#623-#626**: split off #619 — see the #618 tracker's
  comment thread for full descriptions. #623 and #624 are now closed (see
  above); #625 (sample-file.controller.js's file family) and #626
  (the entire patient-side half) remain open.
- **BioAvanceD-v2#627**: `migrateRoleAssignmentScopes.js` bypasses
  `rbac-assignment.service.js` entirely (raw Mongo writes), so #622's new
  validation doesn't cover it. Low severity — script is one-time and
  still unrun. Added to #618.
- **dyeallpies-skills-pack#336** (not a BioAvanceD-v2 issue):
  `edit-branch-guard.cjs` fired correctly once this session but then
  silently let several Edit calls through on the protected branch later
  in the same session. **Heads up: verify `git branch --show-current`
  before the first Edit of each new pick, don't rely solely on the
  hook.**
- **dyeallpies-skills-pack#337** (not a BioAvanceD-v2 issue): a recurring
  reproduce-order slip in `fix-bugs` (product fix written before the
  failing test) — happened for #617 and #619, did NOT happen for #620,
  #622, #623, or #624 (all four correctly reproduce-first after the
  pattern was internalized). Filed with a suggested wording fix.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed after every item
  this session landed (`142f02628`, `edb88624`, `00c0349e`, `3cd82baf`,
  `e9c08479`, `21220f10`, `e1f63a19`). Working tree clean except the
  gitignored/junctioned `.claude/skills/`. No stale local branches — every
  fix/test branch this session deleted local + remote after merging.
- No Docker stack was brought up this session — all fixes are
  backend-internal, proof bar was mocked-Mongo/mocked-Express tests.
- `migrateRoleAssignmentScopes.js` (from #615) is still unrun against any
  real database — now also tracked as having a validation gap (#627).

## Recommended next steps

No single next pick named by the user for a future sitting — recompute
budget fresh. Candidates, roughly in order of readiness:
1. **#627** — migrateRoleAssignmentScopes.js validation gap (small, script
   is one-time/unrun so not urgent).
2. **#625** — sample-file.controller.js org-scope (medium, needs a design
   call on which layer owns the check — the controller has no
   rbac-assignment.service.js dependency at all currently).
3. **#626** — patient-side org-scope (large — likely needs its own split
   like #619 did, given it bundles sub-resource + mutation + search
   routes across two files).
4. **#602** — needs Dennis's design call before a fix shape exists.
5. **#621** — needs Dennis's design call (deferred this session, two
   options already surfaced in its comment thread).
