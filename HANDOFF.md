# HANDOFF

**Written 2026-09-24, forty-ninth queue sitting. INTERIM: Dennis gave no end
signal, so treat the session as CONTINUING.** The instruction was "read
handoff, pick next group of issues, Docker is on". The sitting took the
organization-scope class, #1053, and followed it through everything it
turned up. Every fix is a scoped-caller authorization narrowing; an
Administrador (global scope) is unaffected throughout.

## Repo state

`feature/docker-e2e-backend-integration`, pushed. The last substantive commit
is `a7bce5b3`.

## What shipped (all CLOSED, each with a close comment)

- **#1053**
  - `7a8a3d7e`, sample: refuses a PUT that re-parents `collectionSite`.
  - `28149fa7`, patient: refuses a PUT that re-parents `clinicalUnitId`. The
    destination is checked on the *resolved* unit, so a `clinicalUnit` name
    can't slip past.
- **#1182**, `e2d2058b`: `/api/assays` is now scoped on `laboratoryId`. This
  is the opt-in `scopeField` on `createMasterDataRouter`; Assay is the only
  one of its 14 models with an org field. `[ran it]`
- **#1185**, one commit per gap:
  - `d59330fe`: sample create stamps the caller's org as `collectionSite`.
  - `f06a5e5e`: patient create stamps the caller's org as `clinicalUnitId`.
  - `372c34bb`: `find-for-edit` is scoped.
  - `164fde54`: `DELETE /api/reports/:id` is scoped.
- **#1187**, `1118c160`: `search/by-term` and `by-barcode/:barcode` are
  scoped.
- **#1188**, `e1eb284a`: `GET /api/patients/:participantId/consent`. The
  route param had been `:patientId` since `e2549bee`, so the controller
  always got `undefined` and returned the same arbitrary consent for every
  patient. The route is now scoped too.
- **#1183**
  - `3e75213c`: `assertOrganizationFieldNotReparented` fails closed on a
    missing scope.
  - `a7bce5b3`: the new `tests/architecture/org-scope-routes.arch.test.js`.
    Every route in a scoped route file must carry the org gate, or have a
    reasoned EXEMPT entry keyed by file, verb and path.

Every fix was proved at unit and route level, with a stash probe reding
exactly the new cases. **No Docker or e2e run happened this sitting.**

## Filed this sitting, and left open

- **#1189** (enhancement): the allowlist arm of the invariant, which
  #1183's test cannot see. It needs a guard that each update allowlist
  holding its module's scope field is paired with the destination check.
  The four pairs are enforced by hand today, and the issue has the table.
  This is the one issue this sitting filed and did not work.
- **#1184** is a decision record for the narrowings above. The trade worth
  Dennis's look is that the create stamp overwrites a caller-typed
  `collectionSite`/`clinicalUnitId`, which are data as well as tenancy keys.
  The addendum comment covers #1185's four.
- **#1186** (question): `viewReports` carries DELETE and CREATE, and it is
  UsuarioExterno's whole permission set.
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
  (#1071's rule, now on samples and patients too). An update that moves a
  record between orgs is a 403. Don't "fix" either into silently stripping
  the field. `[read it]` The rationale is in `5c776c4d`'s message.
- **Unit tests that call a scoped handler directly must give
  `req.organizationScope`.** The helper now fails closed without one when
  the org field is being written. Use `{ scope: 'global', organizationIds:
  [] }` unless scope is the subject. `[ran it]` One sensor test and two
  patient tests needed exactly this.
- **`filter-keys.arch.test.js`'s `RETIRED_KEY_EXEMPT` is line-keyed.**
  Adding lines above `sample.routes.js:691/768/861` or
  `result.routes.js:177/451/652` turns it red. Shift the entries with a
  note. `[ran it]`
- **A new route in a file that uses org scope must carry the gate or get an
  EXEMPT entry** in `org-scope-routes.arch.test.js`.
- **`core.autocrlf=true` rewrites a stash-popped file to CRLF in the
  worktree while the blob stays LF.** Detect line endings per file and per
  read. Don't reuse one file's answer for another. `[ran it]`

## Recommended next

**None queued by name.** #1189 is the natural follow-on to this group, and
it is the only issue this sitting filed and did not work.
