# HANDOFF

**Written:** 2026-07-30, a `build-loop` session on
`feature/docker-e2e-backend-integration`, picking up #339 (institutional-
scope enforcement) per the prior session's HANDOFF.

## What happened this session

1. Sized #339 with an Explore agent (per `agent-delegation`): no
   institution-linkage field exists anywhere on Sample/Patient, `rbac.js`
   only allow/denies by role (no query-filtering mechanism at all), and
   Reports has no institution concept either. No docs specified
   enforcement — #339 itself was the spec. Confirmed too big for one
   iteration.
2. Per Dennis's go, split via `divide-and-conquer`: filed #340
   (sample/patient enforcement) and #341 (reports/dashboards) as
   dependents, planned to build a schema-only foundational slice
   (`institution: String` on Sample/Patient) under #339 itself.
3. Built and branch-tested (`test/339-institution-scope-schema`) that
   plain string field end-to-end against the real Docker backend
   (`compose:up`'s dev stack) — proved it persists on both Sample and
   Patient via a real-backend Playwright spec added to
   `specimen-quality-inventory.spec.ts`, confirmed the test genuinely
   fails without the model changes.
4. Before merging, checked `docs/docs-7-27-2026/extracted/dict-02_
   DICIONARIO.md` (confirmed higher-authority than `docs/architecture/`
   per #128) — it models institutional linkage as `Reference(Organization)`
   (`Specimen.collectionSite`, `ParticipantIdentity.clinicalUnitId`,
   `UserAccount.organizationId`), explicitly flags `User.institution` as
   legacy, and no `Organization` entity exists anywhere in the codebase.
   Asked Dennis: keep the simple string field (already built+proven) or
   align to the dictionary. He chose the dictionary.
5. Discarded the string-field implementation (`git checkout --` on all
   four touched files, confirmed clean) rather than merge a design that
   contradicts the canonical spec. Deleted the now-empty
   `test/339-institution-scope-schema` branch.
6. Re-split per `divide-and-conquer`'s "issue's subject doesn't exist
   yet" playbook: documented the real foundational requirement as
   **#343** (build a canonical `Organization` entity + `Reference`
   wiring, per ELM-0024..0031 — bigger than #339's original framing,
   since it also means migrating `User.institution`/`institutionalScope`
   off free text). Corrected #340/#341 to depend on #343 instead of
   #339 directly. Closed #339 against this documented-requirement
   deliverable (no product code shipped from this session — the closing
   comment says so explicitly).
7. Filed 4 more findings hit along the way: #342 (`compose:up --wait`
   fails — backend service has no healthcheck configured, container
   itself is fine), #344 (a fresh `compose:up` dev stack has no
   admin-bootstrap path, so any real-backend login-based e2e spec 401s
   until `createFirstAdmin.js` is run manually), #345 (Patient's
   canonical-field allow-list is duplicated three ways across
   `Patient.js`/`paciente.controller.js` and can drift), and a
   documentation-gap issue on the skills-pack repo itself
   (`DyeAllPies/dyeallpies-skills-pack#150`, since `bioavanced-v2-
   testing-conventions` doesn't mention the admin-bootstrap step —
   deferred writing the actual wording until #344 picks a fix).

## Repo state

- `feature/docker-e2e-backend-integration` unchanged from the prior
  session (`b132411e`) — this session shipped no commits, only issue
  triage/re-scoping. Nothing to push.
- The Docker dev stack (`compose:up`, mongodb/neo4j/redis/influxdb/tsa/
  witness/backend/worker/neo4j-projection-worker/frontend) is currently
  **running** from this session (started to prove the schema-slice test
  against the real backend). A manually-bootstrapped `admin`/`Admin@123`
  account now exists in that stack's Mongo (`bioavanced_dev` db) from
  the workaround in #344 — not present before this session, in-memory/
  volume-only, not a code change. Left running; bring down with
  `npm run compose:down` when done, or leave up if continuing #343 next.
- `test/e2e-real-backend-foundation` — still not deleted (from two
  sessions ago); Dennis hasn't confirmed yet, still safe to delete
  (fully merged forward).
- **#339 closed** this session (against the documented-requirement
  deliverable, not code). **#343 open** — the real foundational issue,
  supersedes #339's original framing. **#340, #341 open**, corrected to
  depend on #343. **#342, #344, #345 open** (new findings, all
  `test-branch`-labeled, none blocking). **#336** (FHIR legacy
  reconciliation) still open, unrelated, non-blocking.

## Recommended next steps

None queued by Dennis explicitly. For continuity: #343 (Organization
entity) is the actual next foundational piece for institutional-scope
work, but its own scope note says it likely needs another
`divide-and-conquer` pass and a fresh product call with Dennis (migration
path for existing `User.institution`/`institutionalScope` values) before
a build-loop iteration can start on it — don't treat it as ready-to-pick-up
without that conversation first.

## Which skills to use

`divide-and-conquer` again for #343 once Dennis has made the migration
product call — the entity-design + User-migration + reference-wiring +
enforcement pieces are independently sized already, per #343's own body.
`ship-integration-branch` only once Wave 2 is fully landed and Dennis
explicitly asks to graduate to `main`.
