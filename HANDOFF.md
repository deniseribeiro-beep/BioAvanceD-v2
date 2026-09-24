# HANDOFF

**Written 2026-09-24, forty-ninth queue sitting. INTERIM: Dennis gave no end
signal, so treat the session as CONTINUING.** This is the sitting's second
rotation; the first went stale when #1186 and #1189 were worked after it.

The instruction was "read handoff, pick next group of issues, Docker is
on". The sitting took the organization-scope class, #1053, and followed it
through everything it turned up. Every fix is a scoped-caller authorization
narrowing; an Administrador (global scope) is unaffected throughout.

## Repo state

`feature/docker-e2e-backend-integration`, pushed. The last substantive commit
is `afac7f9e`.

## What shipped (all CLOSED, each with a close comment)

- **#1053**
  - `7a8a3d7e`, sample: refuses a PUT that re-parents `collectionSite`.
  - `28149fa7`, patient: refuses a PUT that re-parents `clinicalUnitId`,
    checked on the *resolved* unit.
- **#1182**, `e2d2058b`: `/api/assays` is scoped on `laboratoryId`, through
  the opt-in `scopeField` on `createMasterDataRouter`.
- **#1185**, one commit per gap:
  - `d59330fe`: sample create stamps the caller's org as `collectionSite`.
  - `f06a5e5e`: patient create stamps the caller's org as `clinicalUnitId`.
  - `372c34bb`: `find-for-edit` is scoped.
  - `164fde54`: `DELETE /api/reports/:id` is scoped.
- **#1187**, `1118c160`: `search/by-term` and `by-barcode/:barcode` are
  scoped.
- **#1188**, `e1eb284a`: the patient consent route. Its param had been
  `:patientId` since `e2549bee`, so the controller always got `undefined`.
  It is now `:participantId` and scoped.
- **#1186**, `8bb2787a`: report delete adds `requireRole(3, 4)`. The docs
  settled it: RF008's actor is the Coordenador, and the external actor only
  consults. A Tecnico loses report delete too.
- **#1183**
  - `3e75213c`: the re-parent helper fails closed on a missing scope.
  - `a7bce5b3`: the new `tests/architecture/org-scope-routes.arch.test.js`.
    Every route in a scoped route file carries the org gate, or has a
    reasoned EXEMPT entry.
- **#1189**, `afac7f9e`: the same file pins each update allowlist holding a
  scope field to its re-parent check: 4 declared pairs, plus 2 reasoned
  user-profile exemptions.

Every fix was proved at unit, route or architecture level, with a stash or
injection probe reding exactly the new cases. **No Docker or e2e run
happened this sitting.**

## Filed this sitting, and left open

- **#1184** is a decision record for the narrowings above. Its last comment
  cites RF008 AC#7, which requires them. The one call left for Dennis is
  whether `collectionSite`/`clinicalUnitId` should be split into "recorded
  site" and "owning organization". That is why a scoped create overwrites a
  typed site. It's a model change, not a gate change.
- Unchanged: #1181, #1180, #1174 (awaits Dennis's (a)/(b)), #1123.

## Docker and the machine

**The daemon is up, but the test stack is STOPPED.** All
`bioavanced-test-*` containers exited about 3 hours before this sitting
ended, and nothing restarted them. Its images were built from the
`ad543841` tree, so they predate every commit above. A real-backend gate
needs a rebuild of `backend-app-test` plus the reference-data bootstrap
chain.

## Things a next session must not undo

Earlier notes' items still hold. Plus:
- **Scoped creates stamp, scoped updates refuse.** A create by an
  organization-scoped caller takes the caller's org, whatever the body says
  (#1071's rule). An update that moves a record between orgs is a 403.
  Don't "fix" either into silently stripping the field. `[read it]` The
  rationale is in `5c776c4d`'s message.
- **Unit tests that call a scoped handler directly must give
  `req.organizationScope`.** The helper fails closed without one when the
  org field is being written. Use `{ scope: 'global', organizationIds: [] }`
  unless scope is the subject. `[ran it]`
- **`org-scope-routes.arch.test.js` gates new routes and new allowlists.**
  A route in a scoped file needs the gate or an EXEMPT entry. An update
  allowlist holding a scope-field name needs a `SCOPE_FIELD_GUARDS` pair or
  a reasoned exemption. `[ran it]` Injection probes red on each arm.
- **`filter-keys.arch.test.js`'s `RETIRED_KEY_EXEMPT` is line-keyed.**
  Adding lines above `sample.routes.js:691/768/861` or
  `result.routes.js:177/451/652` turns it red. Shift the entries with a
  note. `[ran it]`
- **`core.autocrlf=true` rewrites a stash-popped file to CRLF in the
  worktree while the blob stays LF.** Detect line endings per file and per
  read, and never reuse one file's answer for another. `[ran it]`

## Recommended next

**None queued by name.** Every issue this sitting filed is closed except
#1184, which waits on Dennis's one remaining call. The org-scope work has
not been through the Docker e2e gate yet, and that is the obvious gap to
close before shipping.
