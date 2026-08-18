# HANDOFF

**Written:** 2026-08-18, continuation session (twenty-fourth update).
Exceptionally long sitting: user continued past the advisory budget five
times (confirmed via explicit choices each time via `AskUserQuestion`, not
silent overrun). **Still inside the rabbit hole**, tracker **#618**
("organization-scope enforcement + RBAC gaps"). Eight items landed this
sitting (#616, #617, #619, #620, #622, #623, #624, #627); #621 surfaced
and explicitly deferred (still open) pending Dennis's design input.

## Rabbit hole state

- **Tracker:** #618, open. Original working order: #340 → #341 → #616 →
  #617 → #602 (#340/#341 landed a prior sitting).
- **Landed this sitting:** #616, #617, #619 (narrowed scope), #620, #622,
  #623, #624, #627.
- **Deferred this sitting (still open, not a fix):** #621 — surfaced via
  AskUserQuestion, confirmed it genuinely needs Dennis's design call (no
  organization reference exists anywhere for Result/Sensor/Equipment/
  Temperature or the saved-Report document itself), user chose to skip it
  for now. Comment posted on #621 documenting the two design options
  surfaced (join Result via its Sample's collectionSite vs. a broader
  per-entity Organization-reference design).
- **Still queued:** #602, #621 (deferred), #625, #626.
- **Budget note:** this sitting ran far past the ~10-point advisory
  allowance — 8 landed items across an exceptionally long session, with
  the stopping point surfaced to the user five times via AskUserQuestion
  and explicitly overridden every time. The mechanism worked as designed
  (advisory, user retains control) — not a process failure, just an
  unusually productive/long sitting. Strongly recommend a fresh sitting's
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
  at `e9c08479`. `migrateRoleAssignmentScopes.js` remained uncovered (raw
  Mongo writes) — filed as #627, now also closed (see below).
- **#623**: sample mutation routes (withdraw, return, PUT, DELETE) now
  enforce organization scope. Merged `1c168230` at `21220f10`.
- **#624**: sample `miabis-compliance`/`compliance-graph` routes now
  enforce organization scope. Merged `5b0ea923` at `e1f63a19`.
- **#627**: `migrateRoleAssignmentScopes.js` now validates `organizationId`
  against the `organizations` collection before writing `scopeId` — inlined
  the check directly in the script (raw Mongo, no
  `rbac-assignment.service.js` dependency), falling back to `scopeId: null`
  on a mismatch and counting it separately
  (`assignmentsWithInvalidOrganizationId`). Merged `b041a066` at
  `05c73cf5`.

## Filed this session

- **BioAvanceD-v2#623-#627**: all now closed (see above) except #625/#626,
  still open. Split off #619/#622 — see the #618 tracker's comment thread
  for full descriptions. #625 = sample-file.controller.js's file family;
  #626 = the entire patient-side half of #619's original scope.
- **dyeallpies-skills-pack#336** (not a BioAvanceD-v2 issue):
  `edit-branch-guard.cjs` fired correctly once this session but then
  silently let several Edit calls through on the protected branch later
  in the same session. **Heads up: verify `git branch --show-current`
  before the first Edit of each new pick, don't rely solely on the
  hook.**
- **dyeallpies-skills-pack#337** (not a BioAvanceD-v2 issue): a recurring
  reproduce-order slip in `fix-bugs` (product fix written before the
  failing test) — happened for #617 and #619, did NOT happen for #620,
  #622, #623, #624, or #627 (five in a row correctly reproduce-first once
  the pattern was internalized). Filed with a suggested wording fix.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed after every item
  this session landed (`142f02628`, `edb88624`, `00c0349e`, `3cd82baf`,
  `e9c08479`, `21220f10`, `e1f63a19`, `05c73cf5`). Working tree clean
  except the gitignored/junctioned `.claude/skills/`. No stale local
  branches — every fix/test branch this session deleted local + remote
  after merging.
- No Docker stack was brought up this session — all fixes are
  backend-internal, proof bar was mocked-Mongo/mocked-Express tests.

## Recommended next steps

No single next pick named by the user for a future sitting — recompute
budget fresh (from zero — this session's spend doesn't carry over).
Candidates, roughly in order of readiness:
1. **#625** — sample-file.controller.js org-scope (medium, needs a design
   call on which layer owns the check — the controller has no
   rbac-assignment.service.js dependency at all currently).
2. **#626** — patient-side org-scope (large — likely needs its own split
   like #619 did, given it bundles sub-resource + mutation + search
   routes across two files).
3. **#602** — needs Dennis's design call before a fix shape exists.
4. **#621** — needs Dennis's design call (deferred this session, two
   options already surfaced in its comment thread).
