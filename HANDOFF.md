# HANDOFF

**Written:** 2026-07-30, a same-day continuation session on
`feature/docker-e2e-backend-integration`. Ran `build-loop` on **#356**
(second link in the #355→#356→#357→#358 chain split from #354) and
closed it.

## What happened this session

1. Read #356's scope: update `paciente.controller.js`'s
   `clinicalUnitId`/`clinicalUnit`/`unitAcronym` allowlist/normalization
   to match whatever shape #355 settled the service's `clinicalUnit`
   search/filter paths into.
2. Traced the full path: `sanitizePatientPayload` → `patientService
   .createPatient`/`updatePatient` → `resolveClinicalUnitSnapshot`
   (Organization-based resolution, landed `fd6f5e84`). Found the
   allowlist already forwards `clinicalUnitId` as an opaque
   `organizationId` reference **unmangled** — critically, unlike
   `clinicalUnit`/`unitAcronym`, it is never case-folded, so it survives
   `resolveClinicalUnitSnapshot`'s exact `organizationId` lookup.
3. Decision (same shape as #355): **stays as-is, no code change
   needed.**
4. Implemented on `test/clinical-unit-controller-allowlist-decision`:
   - Added
     `api/backend/tests/unit/paciente.controller.clinicalUnitAllowlist.unit.test.js`
     — 5 regression tests: allowlist still accepts all three fields
     together; `clinicalUnitId` isn't case-folded; a controller-sanitized
     `clinicalUnitId` resolves correctly against a real (in-memory,
     real-query-semantics) Organization lookup; `cadastrar()`/
     `atualizar()` both forward the sanitized `clinicalUnitId` to the
     service unchanged.
   - Updated `docs/architecture/canonical-data-contract-v1.md`'s
     `clinicalUnitId` entry to record the #356 decision and narrow the
     "remain" list to just #357.
5. Verified: targeted run green (5/5), no full-suite run this iteration
   per the end-loaded gate order. Used the strongest **native-only**
   proof (real-query-semantics in-memory mocks) per
   `build-loop`'s BioAvanceD-v2 overlay — even though Dennis said Docker
   was on for the session, the overlay reserves literal Docker for the
   RF-milestone's own e2e specs and the ship gate, not backend-internal
   slices like this one (issue #151 tracks this ambiguity already).
6. Committed on `test/clinical-unit-controller-allowlist-decision`,
   merged into `feature/docker-e2e-backend-integration` (`b5f6dad6`),
   deleted the merged branch. Closed **#356**.

## Repo state

- `feature/docker-e2e-backend-integration` has one new merge commit
  (this session's `test/clinical-unit-controller-allowlist-decision`)
  on top of prior HEAD (`85496ca1`... now at `b5f6dad6`), not yet
  pushed — ahead of `origin/feature/docker-e2e-backend-integration` by
  several local commits (nothing pushed this session).
- Docker dev stack: **down**, unchanged for several sessions running
  now — this iteration used native-only proof per the overlay (see
  above), so Docker being "on" this session was never actually
  exercised. A future session bringing it up fresh still hits #344 (no
  admin user), #342 (`--wait` healthcheck), and the frontend-container
  manual-start quirk.
- `test/e2e-real-backend-foundation` — still not deleted, still safe to
  delete (fully merged forward), Dennis hasn't confirmed.
- **#356 closed** (decision: no code change needed, regression-tested).
  **#354 open**, tracking issue for the #353 remainder, chain now at
  **#357, #358** — #357 (`clinical-unit.routes.js` CRUD/search surface,
  proxy-or-retire decision) is next, unblocked by #356's close. **#340,
  #341 open**, still blocked (transitively on #358). **#342, #344, #345
  open** (infra findings, `test-branch`-labeled, non-blocking,
  unchanged). **#349, #350 open** (from the #347 session, unrelated).
  **#336** (FHIR legacy reconciliation) still open, unrelated,
  non-blocking.
- Skills-pack: **#151 open** (documentation), build-loop real-backend
  proof-bar ambiguity for this repo — not blocking, informational; this
  session leaned on it directly (see above).

## Recommended next steps

None queued explicitly by Dennis. **#357**
(`clinical-unit.routes.js`'s CRUD/search surface — proxy to
`organizations` or retire outright) is the natural next `build-loop`
iteration — it's now unblocked. Note #357 is a real proxy-or-retire
*design* decision, unlike #355/#356 which turned out to be "already
correct" confirmations — it likely needs an actual code change or
removal, not just a regression test.

## Which skills to use

`build-loop` for #357 if picked up next — read its BioAvanceD-v2
overlay for the "real backend" proof-bar nuance (native-only mocks
suffice for a backend-internal slice; literal Docker is reserved for
the RF milestone's own e2e specs and `ship-integration-branch`).
`ship-integration-branch` only once the full #346→#347→#348/#351/#352/
#353→(#355→#356→#357→#358) wave is landed and Dennis explicitly asks to
graduate to `main`.
