# HANDOFF

**Written:** 2026-08-18, continuation session (nineteenth update). User said
"continue with #616 + #617", then chose to continue the queue further —
**still inside the rabbit hole**, tracker **#618** ("organization-scope
enforcement + RBAC gaps"). Three items landed this sitting (#616, #617,
#619), plus a split that grew the tracker's queue. Budget is well spent;
this is a strong stopping point.

## Rabbit hole state

- **Tracker:** #618, open. Original working order: #340 → #341 → #616 →
  #617 → #602 (#340/#341 landed a prior sitting). #619 was picked up next
  per the user's continuation, then split when it turned out much bigger
  than expected.
- **Landed this sitting:** #616, #617, #619 (narrowed scope).
- **Still queued:** #602, #620, #621, #622, #623, #624, #625, #626 (the
  last four new, filed this sitting from #619's split).
- **Budget note:** #616+#617 were both medium (~2-3 points each). #619's
  slice alone was substantial (73 lines of route changes + 141 lines of
  test changes, plus discovering and filing 4 follow-up issues) — a
  "large, itself needed divide-and-conquer" item per the skill's own
  sizing table. Combined, this sitting has covered meaningfully more than
  the ~10-point advisory allowance. Recommend a fresh sitting's budget
  before picking up more.

## Issues closed this session

- **#616**: `changeUserRole` now preserves additive role assignments
  (e.g. `auditor`) when `accessType` changes, instead of revoking them.
  Merged `142f02628`, closed.
- **#617**: `organizationId` on user create/edit now validated against the
  `organizations` collection, mirroring `sample.service.js`'s
  `collectionSite` check. Merged `82986a0c` at `edb88624`, closed.
- **#619** (narrowed): `sample.routes.js`'s `GET /:id/label`, `/results`,
  `/movements`, `/rcs-assessments`, `/sprec-profiles`,
  `/quarantine-actions` now enforce organization scope
  (`requireOrganizationScope` + post-fetch `isRecordInOrganizationScope`
  check, 403 on mismatch), mirroring #340's `GET /:id` precedent exactly.
  Merged `4090c0be` at `00c0349e`, closed against the narrowed scope —
  see "Filed this session" for the 4 follow-ups covering the rest of
  #619's original scope.

## Filed this session

- **BioAvanceD-v2#622**: `rbac-assignment.service.js`'s grant functions
  still don't validate `organizationId` themselves (ops-script gap, low
  severity). Added to #618.
- **BioAvanceD-v2#623**: sample mutation routes (`withdraw`, `return`,
  `PUT`, `DELETE`) don't enforce org-scope — need a pre-mutation
  fetch+check, not just an added check. Added to #618.
- **BioAvanceD-v2#624**: sample `miabis-compliance`/`compliance-graph`
  routes don't enforce org-scope — need investigating whether their
  validators expose `collectionSite` or need their own `getSample` call.
  Added to #618.
- **BioAvanceD-v2#625**: `sample-file.controller.js`'s
  `/:specimenId/files/*` family (a separate controller, no
  `rbac-assignment.service.js` dependency at all currently) doesn't
  enforce org-scope. Added to #618.
- **BioAvanceD-v2#626**: the entire patient-side half of #619's original
  scope — `patient.routes.js`/`paciente.controller.js` sub-resource,
  mutation, and search routes. Added to #618.
- **dyeallpies-skills-pack#336** (not a BioAvanceD-v2 issue):
  `edit-branch-guard.cjs` fired correctly once this session but then
  silently let several Edit calls through on the protected branch later
  in the same session. **Heads up: don't rely solely on the hook —
  verify `git branch --show-current` before the first Edit of each new
  pick.**
- **dyeallpies-skills-pack#337** (not a BioAvanceD-v2 issue): a recurring
  reproduce-order slip in `fix-bugs` — writing the product fix before the
  failing test when the fix needs unfamiliar test-harness research first
  (happened twice this session, #617 and #619; both times caught and
  recovered before reporting done). Filed with a suggested wording fix.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed after #616, #617,
  and #619 all landed (`142f02628`, `edb88624`, `00c0349e`). Working tree
  clean except the gitignored/junctioned `.claude/skills/`. No stale
  local branches — all three fix/test branches deleted local + remote
  after merging.
- No Docker stack was brought up this session — all three fixes are
  backend-internal, proof bar was mocked-Mongo/mocked-Express tests per
  the fix-bugs/build-loop overlays, not literal Docker/live DB.
- `migrateRoleAssignmentScopes.js` (from #615) is still unrun against any
  real database — unrelated to this session's work, unchanged.

## Recommended next steps

Continuing the rabbit hole (tracker #618) — no single next pick named by
the user; recompute a fresh budget before picking up more, given this
sitting already ran long. Candidates, roughly in order of readiness:
1. **#623** — sample mutation routes org-scope (medium, fix shape already
   sketched in the issue).
2. **#624** — sample compliance/graph routes org-scope (small-medium,
   needs a quick investigation first).
3. **#625** — sample-file.controller.js org-scope (medium, needs a
   design call on which layer owns the check).
4. **#626** — patient-side org-scope (large — likely needs its own split
   like #619 did, given it bundles sub-resource + mutation + search
   routes across two files).
5. **#620** — dead-code withdrawal-history report type (small).
6. **#621** — non-sample-rooted org-scope gap (medium).
7. **#622** — rbac-assignment.service.js validation gap (small).
8. **#602** — needs Dennis's design call before a fix shape exists
   (unchanged from prior sittings).
