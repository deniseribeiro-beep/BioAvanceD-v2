# E2E Traceability Plan — docs → Playwright milestone

**Written:** 2026-07-27, in response to the new doc drop in
`docs/docs-7-27-2026/` (Requisitos v3.0.0, Plano Integrado do Foundation
Data Pipeline v2.1.0, Dicionário Consolidado v1.3.0, `DENISE_VALIDATION_STATUS.md`,
5 architecture/use-case diagrams). Machine-readable extractions of all of
those live in `docs/docs-7-27-2026/extracted/` — this plan is built on
top of them, not on the raw `.docx`/`.xlsx` files.

**Amended 2026-07-31** (issue #377): Requisitos bumped to v3.0.1, Plano
Integrado to v2.1.1 — see `docs/docs-7-31-2026/CHANGELOG-2026-07-31.md`
and the "Doc defect" note below, now marked resolved. The dictionary
itself (v1.3.0) is unchanged; this plan's RF/RNF matrix required no
edits.

## The new milestone

Alongside the existing coverage milestone (90% statements/branches/
functions/lines on the backend unit/integration suite — see `HANDOFF.md`),
BioAvanceD-v2 now has a second, independent milestone:

> **Translate every testable requirement in the v3.0.0 requirements doc
> into a Playwright e2e test that proves it, not just documents it.**

These are different axes on purpose. Backend coverage % proves a line of
code *ran*; it does not prove a *use case* (RF-something) actually works
end-to-end through the real UI/API/persistence stack. `DENISE_VALIDATION_STATUS.md`
item 2 already flagged this gap directly: e2e specs today mostly run
against a *mocked* backend, and the one real-backend spec
(`tests/e2e/backend-integration.spec.ts`) is skipped unless someone
explicitly runs the Docker gate. This milestone is how that item closes
for good, and how it scales past the 12 items Denise originally asked
about to the full 29 RF + 32 RNF in the new doc.

> **Doc defect found during extraction (RESOLVED 2026-07-31):** the
> requirements doc's own intro paragraph ("RF029 e RF030 foram
> adicionados...") and its "Matriz de coerência do pipeline" (section 4,
> Fase 3 row: "RF030 e requisitos de domínio RF001-RF028 aplicáveis")
> both reference an **RF030 that does not exist** — the actual
> requirements table (verified directly against the source `.docx`, not
> just the pandoc conversion) stops at **RF029**. This is the same
> one-revision-behind pattern found in the Lucidchart diagrams (see
> `diagrams-index.md`'s caveat): RF030 was apparently the old ID for
> what the table now calls RF029 ("Ingestão operacional e científica"),
> and the prose/matrix sections never got updated when the table was
> renumbered. Flagging for Denise rather than guessing at a fix — this
> plan treats **RF001-RF029 (29 items)** as the real, defined set.
>
> Fixed upstream in Requisitos **v3.0.1** and Plano Integrado **v2.1.1**
> (both dated 2026-07-31, see `docs/docs-7-31-2026/CHANGELOG-2026-07-31.md`)
> — the corrected prose now matches what the table rows always said:
> RF022 = Foundation Data Pipeline, RF023 = outbox/Neo4j projection,
> RF028 = reference-data import, RF029 = operational/scientific
> ingestion, RF030 confirmed not to exist. **No change to this plan's
> matrix was needed** — the RF row content itself never changed, and
> `docs/docs-7-27-2026/extracted/requisitos-index.md` was already built
> from the table rows, not the buggy prose, so it was already correct.
> The 2026-07-31 drop also added 3 new gates to the Foundation Data
> Pipeline plan, cross-checked against test coverage 2026-08-17 (#378):
>
> - **`F3-G10`** (specimen custody allocate/move/release must run in a
>   real MongoDB replica-set transaction, proven atomicity/rollback) —
>   **SATISFIED.** `compose.test.yml`'s `mongodb-test` has run a
>   single-node replica set since #297 (RF006 AC#6), and
>   `AllocateSampleUseCase`/`MoveSampleUseCase`/`ReleaseSampleUseCase`
>   all route their state+audit writes through
>   `MongoStorageRepository.withTransaction`. Provably exercised
>   end-to-end against the real stack by `tests/e2e/sample-storage-
>   lifecycle.spec.ts` (#321) — no spec drove any of the three use
>   cases' `execute()` path before that.
> - **`F2-G09`** (multi-endpoint/asset/partition sources need a
>   coverage manifest — expected/obtained counts, justified exclusions,
>   block promotion on unjustified partial coverage) — **real gap, but
>   not currently triggered by any of the 16 operational Fase 2
>   sources** (`api/backend/src/reference-data/reference-imports/`):
>   each is a single canonical-file download, not multi-endpoint. The
>   one live multi-endpoint import path in the repo,
>   `terminologySync.service.js#syncFromOrphadata` (3 Orphadata
>   endpoints, still wired to `terminologies.routes.js`), already has
>   this exact silent-partial-coverage problem — tracked since before
>   this gate existed as **#115** (narrower framing: "report which
>   endpoint(s) were consulted," not the full manifest+block-on-
>   unjustified-partial requirement). Left #115 open as the tracking
>   issue rather than filing a duplicate; commented on it linking F2-G09.
> - **`F3-G09`** (reports/exports must derive org scope from active
>   assignments, applied to detail rows/indicators/aggregations/exports
>   alike) — **real, currently-unmet gap.** `reports.routes.js` and
>   `Dashboard.tsx` have zero organizational-scope filtering today.
>   Already fully tracked: **#340** (foundation — scope-filter helper +
>   sample/patient list+detail enforcement, unblocked now that its own
>   dependency #348 closed) and **#341** (this gate's actual surface —
>   reports+dashboards — explicitly depends on #340 landing first).
>
> Tracked as **#378**, closed 2026-08-17 against this note.

**Gate / definition of done for this milestone** (mirrors the RF012
audit-first pattern found in the use-case diagrams — see
`docs/docs-7-27-2026/extracted/diagrams-index.md`): a requirement counts
as "proven" when there is a Playwright spec that (a) exercises the
happy path AND at least one rejection/edge case from that RF's
"Critérios de aceitação", (b) runs against the real backend at least
once (via `test:e2e:docker`, even if the fast mocked version also
exists for per-iteration use), and (c) asserts the AuditEvent side
effect where the RF's criteria call for one. A spec that only smoke-
tests that a page renders does not meet the gate — see
`bioavanced-v2-testing-conventions`'s "Tests are honest or they're
worthless."

## Ground truth hierarchy (inherited from the docs themselves)

Doc 3 section 4 ("Autoridade documental") sets this order, and this
plan follows it for any conflict:

1. `docs/docs-7-27-2026/extracted/dict-02_DICIONARIO.md` (the 929-field
   dictionary) — normative for field names/cardinality/entities.
2. The Foundation Data Pipeline plan (doc 3) — normative for phase
   sequencing (Fase 1/2/3) and pipeline gates.
3. `docs/docs-7-27-2026/extracted/requisitos-index.md` (doc 1, RF/RNF) —
   normative for acceptance criteria. **This plan's traceability matrix
   is keyed on this doc's IDs.**
4. The 5 Lucidchart/use-case diagrams — useful for actor/grouping
   structure only; their RF numbering runs ~1 behind doc 1 starting at
   RF014 (see the caveat at the top of `diagrams-index.md`). Never cite
   a diagram's own RF label without translating it.
5. Code/schemas/tests — must converge to the above, never redefine them.
   `docs/docs-7-27-2026/extracted/dict-07_ALINHAMENTO_CODIGO.md` and
   `dict-08_MAIN_GAPS.md` are the current best record of where `main`
   still diverges from this target model — read those before assuming a
   spec should currently pass.

## Current state (baseline, before this milestone starts)

Only 4 spec files exist today, all thin:

| File | Test cases | Backend | RF/RNF touched (partial only) |
|---|---|---|---|
| `cadastro-amostra.spec.ts` | 2 (render table, client-side filter) | mocked | RF004, RF006 (UI only, no persistence assertion) |
| `intake-wizard.spec.ts` | 2 (render step, required-field validation) | mocked | RF004, RF005 (UI only) |
| `tcle-dinamico.spec.ts` | 2 (render builder, submit metadata) | mocked | RF010 (UI only) |
| `backend-integration.spec.ts` | 2 (health check, login+list) | **real**, but `test.skip`ped by default | RF001 (partial) |

That's 8 test cases against 29 RF + 32 RNF = 61 requirement items. None
of the mocked specs assert an AuditEvent was written, a Neo4j projection
happened, or that rejected/invalid input actually gets HTTP 422 — they
check that the page renders and a mocked API call fires. This is the
concrete evidence behind this milestone, not an assumption.

## Grouping strategy: 6 proposed spec files

The three use-case diagrams already group all 29 RF into 6 coherent
packages by actor/journey (with shared cross-cutting "controles
incluídos"). Reusing that grouping — rather than inventing a new one —
means the spec structure stays traceable back to the diagrams Denise
already approved. Proposed file names follow the existing
`kebab-case.spec.ts` convention at repo root `tests/e2e/`:

| Proposed spec file | Diagram package | RFs covered |
|---|---|---|
| `auth-access-security.spec.ts` | Acesso e segurança | RF001, RF002, RF003, RF014 |
| *(no shared file — see note)* | Participante, consentimento e estudos | RF004, RF005, RF010, RF020, RF021 |
| `specimen-quality-inventory.spec.ts` | Espécime/qualidade/inventário | RF004(shared), RF006, RF016, RF017, RF018, RF019, RF025, RF026 |
| `interop-monitoring.spec.ts` | Interoperabilidade e monitoramento | RF009, RF011, RF015 |
| `scientific-data-access.spec.ts` | Dados científicos e acesso | RF007, RF008, RF024, RF027 |
| `pipeline-continuity.spec.ts` | Pipelines, continuidade e proteções | RF013, RF022, RF023, RF028, RF029 |

`RF012` (AuditEvent + crypto integrity) is not its own file — per the
diagrams it's the one use case every other group `«include»`s, so it's
a **shared assertion helper** (`tests/e2e/helpers/assertAuditEvent.ts`,
to be built) called from every spec above, not a standalone journey.

**`participant-consent-studies.spec.ts` (proposed above for RF004,
RF005, RF010, RF020, RF021) was never created — coverage for that group
landed in topic-specific files instead** (#577): RF005 →
`tests/e2e/intake-wizard.spec.ts`, RF010 →
`tests/e2e/tcle-dinamico.spec.ts`, RF020/RF021 →
`tests/e2e/study-protocol-collection-crud.spec.ts`. See the per-RF
matrix below for each RF's current status and actual file.

## Full RF traceability matrix

Status legend: **RED** = code doesn't implement the target model yet per
`dict-07_ALINHAMENTO_CODIGO.md`/`dict-08_MAIN_GAPS.md` (write the test
anyway, expect it to fail, file an issue linking the failing test — that
*is* the proof of the gap); **PARTIAL** = existing mocked spec touches
this but doesn't meet the gate; **MISSING** = zero e2e coverage today;
**Wave** = suggested sequencing (1 = start now, higher = later; matches
the "Sequencing (waves)" section below exactly — if the two ever
disagree, that section is the one to trust and this table has drifted).

**On the Priority column:** the RF table itself has no priority field —
only RNF has one. "Priority (doc)" below is *derived*, not quoted: where
`dict-04_PRIORIZACAO.md`'s P-items map cleanly onto an RF's domain, that
P-item's Prioridade is used (cited inline); where nothing maps cleanly,
it's "—". Treat every non-cited value here as a judgment call, not a
fact from the source.

| RF | Módulo | Proposed spec | Status today | Priority (doc) | Wave |
|---|---|---|---|---|---|
| RF001 | Segurança e autenticação | auth-access-security | PARTIAL (backend-integration, skipped) | Crítica (P-033) | 1 |
| RF002 | Dashboard e autorização | auth-access-security | DONE (2026-07-28) — admin's positive path (GET /api/users, `/system-management`) + backend-side negative paths (no token → 401; a fresh non-admin's setup-only tempToken → 401). A genuine non-admin *session* hitting RBAC couldn't be exercised: any first-time non-admin login is gated behind RF001's mandatory MFA setup (TOTP), which this iteration didn't implement a test-side generator for — `rbac.test.js`'s unit coverage of `requirePermission` is the fallback proof for that half. Found and fixed a real gap while writing this: `GET /api/users` had no RBAC middleware at all (any authenticated user, any role, could list every user) — added `requirePermission('createUser')`, matching the existing PUT/DELETE on the same resource. **Update 2026-07-30 (#293):** a test-side TOTP generator now exists (`tests/e2e/helpers/totp.ts` + `completeFirstLoginMfa.ts`, proven by `first-login-mfa-helper.spec.ts`) — a genuine non-admin session hitting RBAC (real 403, not the tempToken's 401) is now provable end-to-end. **Update 2026-07-30 (#335):** retrofitted into this spec's own RF002 case — the Técnico fixture now completes first-login MFA and a real 403 from `requirePermission` is asserted alongside the tempToken's 401. | Crítica (P-033, RBAC-enforcement) | 1 |
| RF003 | Gestão de usuários | auth-access-security | COVERED (2026-07-30, #322 through #337) — happy path (admin creates a user via the real API, audited) + AC#1 rejection (duplicate email and duplicate username each 400) + RNF008 cross-cutting check (a fresh non-admin's setup-only tempToken is refused, 401, on the user-creation endpoint too — same session-gate pattern as RF002's tempToken check). **Update 2026-07-30 (#335):** the RNF008 cross-cutting check now also asserts a genuine non-admin session gets a real 403 from `createUser`'s RBAC gate, not just the tempToken's 401. **Update 2026-07-30 (#333):** AC#2 (password complexity/history) now covered — a Técnico fixture with a real (MFA-completed) session calls `PUT /api/user/security/password`; proves the complexity rejection (`PasswordValidator`, min 12 chars + upper/lower/special), the happy-path change (audited), and the reuse rejection (last-5 password history). **Update 2026-07-30 (#333):** AC#4 (inactivate without deleting history) and AC#5 (revoke sessions, controlled MFA reset) now covered — AC#4 via `PUT /:id` with `status: 'inactive'` (not `DELETE /:id`, which is a hard delete); AC#5 via a self-service session revoke that genuinely invalidates the token, plus an admin-only `reset-mfa` check (403 for a non-admin, real MFA-clearing effect for an admin). Found and filed #338 along the way: same-second logins produce byte-identical JWTs (no `jti`, second-granularity `iat`), so session storage keyed on token hash can conflate two independent sessions. **Update 2026-07-30 (#337, build-loop):** AC#3 (role assignment with vigência/institutional scope) built and covered — `User.js` gained `roleValidFrom`/`roleValidUntil`/`institutionalScope`, `PUT /:id` accepts and normalizes them, and `authenticate` middleware now refuses (403) any authenticated call once a user's `roleValidUntil` has passed, re-checking the live DB document (not just the JWT) on every request; the spec proves assignment, persistence, expiry enforcement, and recovery once validity is extended. All six RF003 acceptance criteria are now proven against the real backend. | Crítica (P-033) | 2 |
| RF004 | Cadastro integrado do biobanco | participant-consent-studies + specimen-quality-inventory | PARTIAL (2026-07-28) — `specimen-quality-inventory.spec.ts` now covers AC#1/AC#4 (negative paths, #287) plus AC#2 (specimenId uniqueness), AC#5 (SPREC recording), AC#6 (consent-state blocking, both the blocked and unblocked sides) against the real backend (#294). #294's fixture helper (`tests/e2e/helpers/seedParticipant.ts`) seeds a consent template + real participant + operational location/sensor directly via Mongo (no API seed path exists for any of these). Building the happy-path fixture surfaced two pre-existing backend defects, fixed alongside: `SampleMovement.generateMovementID` always returned 1 (stale `mongodb` driver v4-era `.value` unwrap, so every 2nd+ sample ever created collided on `movementId`), and `getSample`/`withdrawSample`/`returnSample` looked up samples by `{specimenId: ObjectId(...)}` — a field that's a separate server-generated string, so the URL's Mongo `_id` never matched (GET /api/samples/:id and POST .../withdraw could never succeed for any real sample). AC#3 (Study/Protocol/Collection linkage) remains unmet — those entities don't exist as real models yet (`Sample.js` has only loosely-typed placeholder fields); still flagged, not yet its own issue. | Crítica | 1 |
| RF005 | Participante e dados clínicos | participant-consent-studies | PARTIAL — status updated 2026-08-21 (#677's 5-slice breakdown: #689-#693, tracker for the RF029 rabbit-hole's #646). AC#1-3 (participantId generation, civil data confined to `ParticipantIdentity`, no civil identifiers to Neo4j) **DONE** per the #363/#560-566/#574/#575 series (`Patient.js`'s own header: "patientName/birthDate/identityDocument are civil [...] fields"). AC#4-6 (structured clinical/diagnostic/phenotypic coding via HPO/ORPHA/CID/MONDO/OMIM against an active ReferenceDatasetRelease): dict-02's 10-entity "Dados clínicos" domain (`Encounter`/`Condition`/`PhenotypeObservation`/`ClinicalObservation`/`ClinicalOutcome`/`DerivedScore`/`AllergyIntolerance`/`FamilyHistory`/`MedicationExposure`/`Procedure`) is now fully modeled (#689-#692), and `intakeWizard.js` additively creates real `Encounter`/`Condition`/`PhenotypeObservation`/`MedicationExposure` documents from already-collected intake data (#693) — RF005 AC#4's active-release gate (`activeCodeValidator`, reused from RF029/#669) is enforced on every coded field. Proven so far by native-only tests only (`tests/unit/intakeWizard.clinicalEntities.test.js`, real-semantics in-memory fakes) — **the literal real-backend Playwright e2e proof #693's own scope called for is tracked separately as #696**, now built (`tests/e2e/intake-wizard.spec.ts`'s "Clinical-entity wiring" describe block). **Update 2026-08-21 (#708, tracker #707):** #697 (the "remaining 6 entities, no UI" marker) was superseded by #707's concrete 6-slice plan — `AllergyIntolerance` is now wired too (dict-02 ELM-0246..0248, DCB-coded manual-entry field, same #696 spec extended). **Update 2026-08-21 (#709):** `FamilyHistory` is now wired too (dict-02 ELM-0249..0251, ORPHA-coded family-condition field, relationship select, same #696 spec extended again). **Update 2026-08-21 (#710):** `Procedure` is now wired too (dict-02 ELM-0242..0245, locally-coded procedureCoding + required performed date + free-text bodySite, same #696 spec extended a third time). **Update 2026-08-21 (#711):** `ClinicalObservation` is now wired too (dict-02 ELM-0219..0232, real LOINC-coded observationCoding + value/unit + required effective date, same #696 spec extended a fourth time) — leaving `ClinicalOutcome`/`DerivedScore` as #707's 2 remaining open sub-issues (#712-713). This row stays PARTIAL until all 6 land. | Crítica | 2 |
| RF006 | Rastreabilidade e cadeia de custódia | specimen-quality-inventory | DONE (2026-07-28, #288) — `specimen-quality-inventory.spec.ts` covers AC#1 (origin/destination/responsible/purpose/quantity recorded on a movement, plus the audit-trail assertion), AC#2/AC#3 (PARTIAL/DEPLETED lifecycle transitions), AC#4 (blocks withdraw/return against a specimen in a blocked lifecycle status), AC#5 (no route accepts an update/delete of a movement — verified as a 404, plus a before/after equality check). AC#6 (quantity updates go through a controlled transaction) is not literally atomic (ledger append then a separate `updateOne`, no Mongo session) — flagged, not blocking, since no crash-mid-transaction scenario is exercised. Building this exposed that the AC#4 guard in `withdrawSample` checked a field (`currentStatus`) and vocabulary that don't exist on `Sample.js`'s real schema (`lifecycleStatus`, enum incl. UNAVAILABLE/DESTROYED/DISPOSED/QUARANTINED) — dead code, fixed alongside since it directly blocked proving the criterion; `returnSample` had no such guard at all, added. Also fixed: `Sample.computeStatus` didn't treat DESTROYED/DISPOSED/QUARANTINED as sticky (only UNAVAILABLE), so setting one via `updateSample` got silently overwritten by the next quantity-derived status; `updateSample` had the same `_id`/`specimenId` mismatch bug #294 found elsewhere (`PUT /api/samples/:id` could never match a sample); `getSampleMovements` queried by the raw route param instead of resolving to the sample's real `specimenId` field first, so `GET /api/samples/:id/movements` returned nothing for the id the create response itself returns. | Crítica | 1 |
| RF007 | Arquivos científicos e dados brutos | scientific-data-access | PARTIAL (2026-07-30, #323) — new `scientific-data-access.spec.ts` covers AC#1 (format rejection), AC#2 (size-limit rejection), AC#3 (SHA-256 checksum), AC#4 (Object Storage — a stable `objstore://` URI, still backed by local disk since no S3/MinIO infra exists in this repo), AC#5 (URI/format/size/encryption/access-restrictions recorded), AC#6 (linked to specimenId), AC#7 (upload+access audited), plus RNF029 (checksum/URI/encryption asserted, proven via an upload→download round-trip that decrypts the at-rest ciphertext back to the exact original bytes). Building this fixture surfaced that the entire `sample-file.controller.js` upload/list/download/delete/export subsystem had never worked end-to-end: the route defined `:sampleID` while the controller destructured `req.params.specimenId` (always `undefined`), and the lookup queried a nonexistent `amostras` collection instead of the canonical `samples` — both fixed alongside, plus a third bug where `SampleFileModel.create()` never carried `specimenId` through into the persisted record, so `downloadFile`/`deleteFile`'s ownership check always failed. Also added: files are now encrypted at rest (AES-256-GCM via the existing `keyRegistry`/`fieldEncryption.js` pattern) and a route-scoped multer-error handler, since no global Express error handler exists anywhere in the app — an invalid-format/oversized upload previously crashed to a raw 500 instead of AC#1/AC#2's intended clean rejection. AssayId/datasetId linkage (no Assay/Dataset model exists yet) and "substituição" (file-replace) audit are not covered — no dedicated tracking issue filed yet, flag before closing #323 fully. | Alta | 2 |
| RF008 | Relatórios | scientific-data-access | DONE (2026-08-25, #723 Wave 4, rabbit-hole #725) — `scientific-data-access.spec.ts`'s "Reports (RF008)" block proves every criterion against the real backend: AC#1 (the `status` filter narrows the specimens behind `samples_by_patient` both ways — **only `estado` of the six named dimensions is wired; period/collection/type/origin/location are silently ignored, #739**; the empty-match quirk in `handleSamplesByPatient` is #741), AC#2 (401 without a session; a real Técnico session with no organization gets #340's hard 403 on scoped report types and the saved-reports listing, and 403 from the `manageReportTemplates` gate), AC#3/RNF007 (patient-rooted previews carry `participantId`, never `patientName`/`birthDate`/`identityDocument`), AC#4/AC#5 (CSV + PDF exports return real rows, an unlisted format is a 404, both exports land on the audit trail — via the global `auditRequest` middleware, not `reports.routes.js` itself), AC#6 (a template created via `POST /api/report-templates` is immediately usable for preview/generate/export under its own code), plus a UI leg (`/reports` → card → `/reports/query/samplesByPatient` → Exportar → real CSV download). Starting this spec surfaced **#737** (fixed alongside, `fad97da3`): `seedReportTemplates` never ran on any live stack, so post-#726 every report type returned the no-preview fallback — RF008 was functionally dead on every Docker stack until then. | — | 4 |
| RF009 | Telemetria e monitoramento ambiental | interop-monitoring | PARTIAL (2026-07-28, #289) — new `interop-monitoring.spec.ts` covers AC#1/AC#2 (a reading POSTed to `/api/iot/telemetry` is persisted as a real InfluxDB point, queried back and value-matched), AC#3-partial (the point carries a `sensorId` tag resolvable to a seeded `SensorMetadata` doc — no first-class `Device`/storage-location reference exists yet, see #298), AC#4-invalid (missing sensorId / non-numeric temperature reject with 400) and AC#4-out-of-range plus AC#6-partial (an out-of-range reading opens a real `TemperatureIncident` via the existing policy-lookup + quarantine-evaluation path; an in-range reading opens none). Building this fixture surfaced a real bug, fixed alongside: `TemperaturePolicy.schema.js` was never `require`d anywhere on the app's boot path, so mongoose never registered that model — every `SensorMetadata.findOne(...).populate('temperaturePolicy')` in `resolveTemperaturePolicy` (`iot.controller.js`) silently threw "Schema hasn't been registered for model \"TemperaturePolicy\"", caught and logged as a warning, meaning **no real sensor's out-of-range reading ever triggered an incident/alert/quarantine before this fix** — only the `NODE_ENV=test`-only hardcoded `'sensor-1'` shortcut worked. AC#5/AC#7 are now DONE (2026-07-28, #298) — a real `EnvironmentalExcursion` model (`api/backend/src/models/EnvironmentalExcursion.js`, dict-02 ELM-0366–0376) and a real `Device` model (`Device.schema.js`, ELM-0305–0315, distinct from lab-equipment `Equipment.schema.js`) now exist; `SensorMetadata` gained a `device` ref alongside its existing `equipment` ref, and `iot.controller.js`'s out-of-range path opens/widens an `EnvironmentalExcursion` (`equipmentId` → the sensor's `Device`, `originalReading`/`triggeringPolicyId` preserving AC#7's "leitura original e regra utilizada") alongside the existing `TemperatureIncident`. Fixing this required changing `resolveTemperaturePolicy`'s two chained `.populate('temperaturePolicy').populate('device')` calls into a single `.populate([...])` call — the two-call chain isn't how Mongoose's query builder composes multiple populates and also silently broke the existing mocked unit tests, since the mock only stubbed one `.populate()` hop. Not yet wired: closing an excursion (`endDateTime`/`excursionStatus: resolved`) when `incident.controller.js`'s manual `resolveIncident` closes the paired `TemperatureIncident` — `endDateTime` is optional in the dictionary (0..1) and no AC required it this slice, but it's a real gap for anyone tracking excursion duration. AC#4's missing-reading detection plus AC#6's full alert/quarantine evaluation (`TelemetryMonitor`'s `findCriticalFreezers`/`propagateCompromise` are still no-op stubs) remain in follow-up #299. | Crítica | 1 |
| RF010 | Consentimento eletrônico e dinâmico | participant-consent-studies | PARTIAL (tcle-dinamico; UI only); **RED** — ConsentTemplate/Consent split partial (dict-07 row 3) | Crítica | **2, red-first** |
| RF011 | Interoperabilidade HL7 FHIR R4 | interop-monitoring | PARTIAL (2026-07-30, #324) — the FHIR bundle staging pipeline (`fhir-import-staging.service.js`, `POST /api/import/fhir/stage`→`/commit`) already existed; new `interop-monitoring.spec.ts` cases prove it end-to-end against the real backend: AC#1 (structural validation — a non-Bundle payload rejected 400), AC#2 (Patient→Participant mapping), AC#3 (Specimen/Consent/Observation mapping), AC#4 (a Specimen missing a canonical required field — `sampleType` — stays ERROR/quarantined and is never committed), AC#5/AC#6 (staging+quarantine workflow, provenance via `importBatchId`/`importedBy`/`importedAt` and an `audit_logs` `FHIR_IMPORT_RECORD_COMMITTED` entry). AC#7 (no direct Mongo/Neo4j write from the FHIR boundary itself) is enforced separately by the existing `fhir-boundary.arch.test.js`, not re-asserted here. Building the happy-path fixture surfaced a real bug, fixed alongside: `commitBatch`'s `samples.updateOne` upsert set `consentStatus`/`quarantineStatus`/`quarantineReason`/`availabilityStatus`/`importBatchId`/`importedAt`/`importedBy`/`releaseStatus` in both `$setOnInsert` and `$set` — an illegal Mongo conflict that made every first-time commit of a FHIR-staged specimen fail with a 500. The legacy synchronous `POST /api/import/fhir` (`import.controller.js#importFhirBundle`, writing straight into `patients`/`samples` with a raw `fhir` subdocument, kept only "para compatibilidade") has since been removed (#336/#570, 2026-08-17) — no live caller was found and it directly violated AC#7; the staging pipeline above is now the only FHIR import path. | Alta | 2 |
| RF012 | Auditoria e integridade criptográfica | shared helper, all specs | MISSING as e2e (unit coverage exists per `DENISE_VALIDATION_STATUS.md` item 7) | Crítica | 1 (build the helper first) |
| RF013 | Backup e restauração | pipeline-continuity | DONE (2026-08-25, #723 Wave 4, rabbit-hole #725) — `pipeline-continuity.spec.ts`'s "Backup and restore (RF013)" block, against the real stack: AC#1/AC#2/AC#3 (an authorized manual `POST /api/backup/perform` returns a sha256 checksum, and `GET /list` carries the persisted run status + that same checksum for the new entry; the run is audited), AC#4 (`POST /restore-test/:fileName` restores into a `<db>_restoretest_<ts>` scratch database that is gone afterwards per a direct Mongo `listDatabases`, a document written to the live db *after* the backup survives, and `checksumVerified` is `true` — **it was structurally always `false` until #742** (the manifest checksum excluded `manifest.json` while verification recomputed with it included; found red-first by this spec, fixed alongside), AC#2 "autorizada"/AC#5 (a real Técnico session is 403'd on perform/list/restore/restore-test and on `GET`/`PUT /api/backup-policy`), AC#5/AC#6 (a policy `PUT` is validated — retention < 30 days is 422 per RNF010 AC#4 — persisted, and adds ≥ 2 audit leaves: the request log plus the service's own explicit UPDATE record; AC#6's retention/cron *application* is only unit-proven, #728), plus a UI leg (`/backup` → Criar Backup → success banner + the run in the table → edit retention → Salvar Política). Caveats filed: the containerized backend ships no mongodump/mongorestore so every run takes the lossy JSON fallback (#738); the table doesn't render status/checksum (#740). | — | 4 |
| RF014 | Políticas de segurança | auth-access-security | DONE (2026-08-20, #646 Wave 3, merge `30295d40`) — 6/8 criteria already existed in `security.service.js`/`security.routes.js`; e2e proof added. AC#4 (forced password reset) now built and proven — the existing `forceReset` flag (previously only set at admin-bootstrap time, never enforced or admin-triggerable) got an admin endpoint plus a login-flow gate (#648). AC#8 (revoke sessions on policy change) still absent — needs a design call (which policy changes require revocation), #649 | — | 3 |
| RF015 | Alertas e notificações | interop-monitoring | DONE (2026-08-20, #646 Wave 3, merge `c8aab8e0`) — new `NotificationRule`/notification-dispatch engine (no prior rule-driven engine existed), wired to the environmental-excursion trigger; other 4 domains RF015 names (security/telemetry/consent/quality/governance) are a natural but not-yet-built follow-up | Alta | 3 |
| RF016 | Etiquetagem | specimen-quality-inventory | DONE (2026-08-20, #646 Wave 3, merge `c332f5dd`) — QR symbology, batch generation, audit/reprint tracking all new. **Caveat (#655):** landed on `sample.routes.js`'s label endpoints, which have no frontend caller — the reachable `SampleLabelPage.tsx` still only hits the separate, capability-poorer `label.routes.js` | — | 3 |
| RF017 | Equipamentos e armazenamento | specimen-quality-inventory | DONE (2026-08-20, #646 Wave 3, merge `d5beca6c`) — AC#7 (block unavailable/interdicted/out-of-condition location) was the only genuinely unbuilt criterion; ancestor-container blocking scope note in #654 | Crítica (P-009 "Inventário físico" overlaps — equipment/rack/box/position) | 3 |
| RF018 | Qualidade de biospecímenes — SPREC/RCS | specimen-quality-inventory | MISSING as e2e (unit coverage confirmed: `rcs-certification.service.test.js` + 2 more, per `DENISE_VALIDATION_STATUS.md` item 10) | Crítica | 1 |
| RF019 | Quarentena lógica | specimen-quality-inventory | MISSING (unit coverage exists per `DENISE_VALIDATION_STATUS.md` item 9) | Crítica | 1 |
| RF020 | Metadados institucionais e MIABIS | participant-consent-studies | MISSING | Crítica | 2 |
| RF021 | Estudos, protocolos e ética | study-protocol-collection-crud + specimen-quality-inventory | DONE (2026-08-14, #578 → #587 rabbit-hole tracker → #588/#589/#590/#591/#592/#593/#594/#596) — CAAE (`Study.ethicsApprovalId`) and validity-period (`Protocol.effectivePeriod`) fields covered by `study-protocol-collection-crud.spec.ts`'s generic CRUD loop (#588); protocolVersion/approvalStatus round-trip and the versioning-mechanism design decision (a flat controlled string, not a supersession chain) also there (#589). Study/consent/participant linkage (#590 → #593/#594) covered: Sample↔Study/Protocol/Collection in `specimen-quality-inventory.spec.ts` (pre-existing, #295), PatientConsent↔Study and Patient↔Study new in `study-protocol-collection-crud.spec.ts`'s "Consent/patient study linkage" block. Inactive/incompatible-protocol rejection (AC#5, #591/#596) covered for all three linkage points (Sample/Consent/Patient) — study-inactive and protocol-unapproved each reject, active/approved each succeed. Building this surfaced and fixed a real bug (not previously provable — this file's own create-path tests, and the whole real-backend happy path, silently never worked against real Mongo): `MongoStorageRepository.allocateSamplePosition`/`autoAssignSamplePosition` `$set` a dotted `storageLocation.boxId`/`.position` path, but `Sample.js` defaults `storageLocation` to a literal `null` — real MongoDB rejects a dotted-path `$set` into a null parent ("Cannot create field... in element {storageLocation: null}"), so *every* real specimen creation failed post-#474 until fixed to `$set` the whole object. Also repaired `specimen-quality-inventory.spec.ts`'s fixtures, stale since #462 (`locationID` → `boxId`/`positionCode`; a new `seedStorageBoxLocation()` helper replaces `seedOperationalLocation()`) and two other pre-existing assertion bugs (uppercase `DESTROYED`/`QUARANTINED` regexes against the now-lowercase-canonical `specimenStatus`, per #408/#540). `scientific-data-access.spec.ts` has the same stale-`locationID` fixture bug, out of scope here — see #597. | Crítica | 2 |
| RF022 | Foundation Data Pipeline | pipeline-continuity | **DONE** (was RED as of 2026-07-27, filed per #329/#330 — status stale here since; fixed 2026-08-20, #646 rabbit-hole recon) — dedicated `FoundationDataRun` model + one-shot idempotent bootstrap (#366/#370/#381), wired into both dev and test compose stacks, proven by real-backend e2e in `pipeline-continuity.spec.ts` | Crítica | 2 |
| RF023 | Outbox e projeção Neo4j | pipeline-continuity | PARTIAL (unit coverage strong per `DENISE_VALIDATION_STATUS.md` item 3; no e2e) | Crítica | 1 |
| RF024 | Solicitações de acesso e distribuição | scientific-data-access | DONE (2026-08-20, #646 Wave 3, merge `7ca99900`/`adbc1bd9`) — new `AccessRequest` entity, all 5 criteria proven; access-policy leg proxied via `Study.studyStatus` (no dedicated `AccessPolicy` engine, #663) | Alta | 3 |
| RF025 | Ensaios, reagentes e não conformidades | specimen-quality-inventory | DONE (2026-08-20, #646 Wave 3, merge `1d8221b9`) — new `ReagentLot`/`Nonconformance` entities, `Assay` extended with reagent/equipment/controls linkage; follow-ups #664/#665/#666 | Alta | 3 |
| RF026 | Retenção e destinação | specimen-quality-inventory | DONE (2026-08-20, #646 Wave 3, merge `365808f4`) — new `LegalHold`/`DispositionAction` entities; `RetentionPolicy` (RF014) reused as-is. Follow-up #667 (entity-type scope limited to AuditEvent/Log) | Alta | 3 |
| RF027 | Workflows e dados ômicos | scientific-data-access | **DONE** (2026-08-21, #716, merge `e77f2024`) — `WorkflowRun` (AC#1/2/4, `/api/workflow-runs`), input/output file linkage (AC#3, `/api/workflow-runs/:workflowRunId/files`), `OmicsQualification` (AC#6, `/api/omics-qualifications`), and a single modality-discriminated `OmicsRun` (AC#5, `/api/omics-runs`, covering genomics/transcriptomics/proteomics/metabolomics/microbiome) all new — proven by a new "Workflows and omics data (RF027)" block in `scientific-data-access.spec.ts`. Imaging (`ImagingStudy`/`ImagingDerivedData`, dict-02 ELM-0353..0356) structurally out of `OmicsRun`'s scope, carved out to #721 | Alta | 4 |
| RF028 | Importação de dados de referência | pipeline-continuity | **DONE** (was RED as of 2026-07-27, filed per #330 — status stale here since; fixed 2026-08-20, #646 rabbit-hole recon) — all 16 Fase 2 sources live-verified (#557), checkpoint/resume/quarantine/rollback (#551), Neo4j outbox projection (#552), CI wiring (#374), all proven by real-backend e2e in `pipeline-continuity.spec.ts` | Crítica | 2 |
| RF029 | Ingestão operacional e científica | pipeline-continuity | **DONE** (2026-08-21, all 6/6 slices landed) — split into 6 dependency-ordered slices 2026-08-20 (#646 rabbit-hole → #668 tracking issue → #669-#674), all proven through slice 1's gateway via the same probe-only pattern against real Mongo. **1/6 (#669, foundation) merge `0d421c05`** — ingestion gateway (provenance envelope, generalized canonical-contract+alias+reference-existence validation, active-reference-code cross-check, idempotency-key claim/replay, per-record quarantine) proven via a test-support route. **2/6 (#670, participants/consents/specimens/clinical data) merge `5c92a08c`** — full clinical-data entity modeling scoped out to RF005 (#677). **3/6 (#671, telemetry) merge `6ca21758`** — wraps RF009's existing InfluxDB path. **4/6 (#672, files) merge `8bdd98d3`** — wraps RF007's existing `objstore://` path. **5/6 (#673, datasets/assays) merge `f25efb46`** — extends the existing `Assay`/`Dataset` master-data routes; #664 (Assay's own link fields are format-only) was out of this slice's own scope, since fixed and closed separately (2026-08-20, `4eb2cc8e`). **6/6 (#674, workflows/omics data) merge `74f42d4d`** — wired RF027's (#716) `WorkflowRun`/`OmicsQualification`/`OmicsRun` in once RF027 itself was pulled forward off Wave 4; `OmicsQualification.targetAssay` is the slice's one FK-checked reference (against `assays`), Workflow/OmicsRun's file-linkage fields stay unreferenced for the same cross-collection-resolution reason #672's own `canonical.v1.file` does. | — | 3, #668 closed, all 6/6 slices done |
| RF-FUT-001 | Assistente inteligente | — | **Out of scope by design** — doc 1 explicitly forbids using this as evidence of Fase 1-3 functionality | — | never |

## RNF classification

RNFs mostly aren't 1:1 journeys — folding all 32 into the matrix above
as if they were RFs would misrepresent what a Playwright spec can prove.
Split into three buckets instead:

**A. Assert inside an existing RF spec (no new file needed).** The RNF
is a property of a journey that's already being tested, so it's one more
`expect(...)` in that spec, not a separate one:
RNF001 (response time — wrap key actions in `page.waitForResponse` +
duration assert), RNF007 (identity segregation — assert
`patientName`/`birthDate` never appear in any Neo4j-facing payload or
frontend network response outside the identity screen), RNF008 (RBAC —
assert 403 on cross-role actions in `auth-access-security`), RNF009
(audit — this **is** the RF012 shared helper), RNF011 (schema
rejection — assert 422 on malformed payloads in every intake spec;
**AC#4 (staging/quarentena) is separate and is now covered on both
import paths** — the FHIR one by `interop-monitoring.spec.ts` per RF011's
row above, and the LGPD sample import by
`lgpd-sample-import.spec.ts`'s RNF011 AC#4 cases as of #787, which
read the quarantined batch and row back out of Mongo rather than
trusting the response. The criterion's second half — "**sem correção
silenciosa**", i.e. the operator can actually see what was rejected — is
covered as of #794 slice 1 by
`GET /api/import-lgpd/batches/:batchId` and the three further cases in
that same spec, which read the batch back through the API rather than
through Mongo. Note the mount: LGPD routes are under `/api/import-lgpd`
(`app.js:350`), not `/api/import/lgpd`. The operator-facing half is
covered as of **#794 item 2**: `GET /api/import-lgpd/batches` lists the
quarantine batches and `/import/quarantine` (`ImportQuarantinePage`,
linked from the sidebar) shows each batch's rejected rows, their error
messages and the retained original row. The list route exists because
`stagingBatchId` never reaches a UI — the LGPD import has no frontend
caller at all (#808) — so a batch-by-id page alone would have been
unreachable. Retaining the uploaded source file landed with **#792**
(`uploads/quarantine/<batchId>`, recorded as `sourceFile` on the batch;
the page shows retido/não retido per batch). Still open on this
criterion: correct-and-resubmit (#794 item 3), the source file on a
*thrown* import (#806), retention duration for both the rows and the
files (#793), and whether either should be encrypted at rest (#807)),
RNF018 (multi-layer validation — same), RNF019 (outbox durability —
assert in `pipeline-continuity`), RNF021 (session lifecycle — assert in
`auth-access-security`), RNF024 (FHIR boundary side-effect-free —
assert in `interop-monitoring`).

**B. Needs dedicated non-functional tooling, not a functional Playwright
spec — explicitly out of this milestone's scope, flag separately.**
RNF002 (latency at 100k+ records — needs a seeded load-test dataset and
a perf harness), RNF003 (99.5% monthly availability — needs uptime
monitoring, not a test run), RNF005 (4-hour training curve — needs a
usability study with real users), RNF010 (backup RPO/RTO — needs an
infra drill), RNF014 (container reproducibility — CI/build concern),
RNF016 (scalability — needs a capacity test), RNF026 (2-minute alert
p95 — needs timing infra beyond Playwright's page timeouts), RNF027
(accessibility AA — needs axe-core or similar, a different tool
category worth its own small milestone), RNF015 (app/infra/queue
monitoring — Prometheus/Grafana-shaped observability across the whole
stack including `FoundationDataRun`/`ReferenceImportRun` metrics, not a
single journey any one spec owns).

**C. Infra/process only — not testable via e2e at all.** RNF006
(documentation exists), RNF012/RNF013 (ISO 20387 / ISO 27001 alignment
— audit/process, not code), RNF017's automation-gate *requirement*
itself (that's this whole milestone, not a thing the milestone tests),
RNF020 (secrets management — a deployment-config review), RNF022
(retention/disposition policy — a data-governance decision, though its
*enforcement* partly falls under bucket A once RF026 lands), RNF023
(schema versioning discipline — a code-review practice, not a runtime
assertion), RNF028 (architectural modularity — covered by existing
arch tests, not e2e), RNF030 (workflow provenance — folds into RF027's
spec once that RF is built, bucket A at that point but not before).

Four more need a judgment call tied to a specific not-yet-built spec
rather than a guess now: **RNF004** (telemetry buffering during
connectivity loss) attaches to `interop-monitoring.spec.ts` once RF009
lands (Wave 1, so this is close); **RNF025** (timestamp consistency
across consent/custody/audit/telemetry/processing events) is
cross-cutting rather than single-journey — add one assertion per spec
that touches those timestamps rather than waiting for one RF to "own"
it; **RNF029** (Object Storage integrity — checksum, URI, encryption)
attaches to `scientific-data-access.spec.ts` once **RF007** (arquivos
científicos, not RF028 — RF028 is reference-data import, a different
domain) is built; **RNF031/RNF032** (the expanded pipeline-specific
RNFs) attach to `pipeline-continuity.spec.ts` once **RF022**
(Foundation Data Pipeline) and **RF028** (reference-data import)
respectively clear their red-first gate — both RNFs' own criteria
assume the Fase 1/Fase 2 gate they describe already passes, so writing
them earlier would just restate the RF's own red test.

## Cross-cutting rules for every new spec

1. **Assert the audit trail, not just the primary outcome.** Every
   diagram package `«include»`s RF012 — a spec that checks "specimen
   created" without also checking "AuditEvent appended" only proves
   half the use case. Use the shared helper once it exists.
2. **Real backend at least once.** A spec that only ever runs against
   the mocked backend cannot prove RF022/RF023/RF028/RF029 (pipeline,
   outbox, Fase 2 import) — those are meaningless without real
   Mongo/Neo4j/Redis. Follow the existing `test:e2e` (mocked, per-
   iteration) vs `test:e2e:docker` (real, end-of-loop gate) split from
   `bioavanced-v2-testing-conventions`; don't invent a third mode.
3. **RED tests are legitimate deliverables, not failures to hide.**
   Where `dict-07_ALINHAMENTO_CODIGO.md`/`dict-08_MAIN_GAPS.md` already
   flag a gap (RF005 identity segregation, RF010 consent split, RF022
   Foundation Pipeline, RF028 Fase 2 importers), the first honest e2e
   test for that RF will fail against current `main`. Per
   `bioavanced-v2-conventions`, file the gap as a GitHub issue the
   moment the red test proves it, linking the test — don't write around
   it, don't weaken the assertion, don't skip it silently.
4. **Priority from the docs, not gut feel.** Wave assignment above
   pulls from `dict-04_PRIORIZACAO.md`'s Prioridade column (Crítica
   items first) crossed with `dict-07`/`dict-08`'s gap severity — a
   Crítica item with a real code gap needs the issue filed and the
   fix scoped before more tests pile up on top of a broken foundation,
   so it's marked "red-first" rather than "wave 1."

## Sequencing (waves)

- **Wave 1 (start now — Crítica, code exists, just untested e2e):**
  RF001, RF002, RF004, RF006, RF009, RF012 (helper), RF018, RF019,
  RF023.
- **Wave 2 (Crítica, needs new spec + likely new UI/API surface):**
  RF003, RF007, RF011, RF020, RF021 — plus red-first issue filing for
  RF005 (ParticipantIdentity segregation), RF010 (ConsentTemplate/Consent
  split), RF022, and RF028 before their specs go further than the first
  failing test. These four are the ones `dict-07_ALINHAMENTO_CODIGO.md`
  already flags as "Parcial"/"Gap crítico" against `main` — writing past
  the first red test on any of them without an issue filed is exactly
  the "write around a known gap" anti-pattern `bioavanced-v2-conventions`
  warns about.
- **Wave 3 (Alta, after Wave 1/2 land):** RF014, RF015, RF016, RF017,
  RF024, RF025, RF026, RF029.
- **Wave 4 (remaining Alta/Média, lowest urgency):** RF008, RF013,
  RF027.
- **Never:** RF-FUT-001 (explicitly out of scope by the doc itself).

## Tracking this milestone as it progresses

`DENISE_VALIDATION_STATUS.md` stays as the answer to Denise's original
12-item question — don't fold it into this file, it has its own
audience and history. This plan's matrix is the new living tracker for
the full 30-RF scope: update the **Status today** column in the same
commit as the spec that changes it, same discipline as
`api/backend/COVERAGE_NOTES.md`. When a RED test flips to green because
the underlying gap got fixed, update both this file and close the
linked issue in the same PR.

### Carried coverage items (not yet specs, not lost)

Items that came out of a closed issue and would otherwise only exist in that
issue's comments, where no backlog scan reaches them.

- **#889 Part B — a spec that pins the `importJobID` *writer*, not just the
  reader.** #889 Part A shipped and is green (`results-import-job-view.spec.ts`,
  full gate 2026-08-29), but its fixture writes `importJobID` itself, so it
  pins the reader and the "Ver" button only. **It would not have caught #861**,
  which was a missing writer — the spec header says so deliberately. The real
  version runs a results import through the async importer, waits for the job
  to reach `completed`, and asserts the rows come back tagged with the job's
  own id.

  It was blocked on #828 (no shared upload volume between the API and worker
  containers). **That blocker is gone** — #828 landed in `9ce27678` and its own
  e2e proof is green — so this is now merely unwritten, not blocked. It needs
  the worker container live, which the test stack now provides.

## Docs/skills that need a second look because of the new docs

Found while cross-checking the new dictionary against what
`bioavanced-v2-conventions` currently points to as ground truth —
flagged, not silently fixed, since it's a design document Denise/Dennis
own:

- **`docs/architecture/canonical-data-contract-v1.md` is stale against
  the v1.3.0 dictionary.** It still lists `patientName`/`birthDate` as
  direct fields on `Participant`, but the new dictionary (and RF005/
  RNF007) require a segregated `ParticipantIdentity` entity — which
  `dict-07_ALINHAMENTO_CODIGO.md` itself lists as "Parcial" against
  `main`. Whoever picks up RF005's red test first will hit this
  directly; worth a deliberate update to `canonical-data-contract-v1.md`
  (or a `v2`) as part of that slice, not a surprise mid-fix.
  **2026-07-31 update:** a strong source for that fix now exists —
  `docs/docs-7-31-2026/manuscript/2.2-Additional_file_2_Polyglot_Persistence_Data_Model.docx`
  (v1.0.1) maps all 26 domains/79 entities with a normalized persistence
  matrix and architecture views. Not applied here — still deliberately
  deferred to the RF005 slice — but read that file first instead of
  starting the rewrite from scratch.
- **`bioavanced-v2-conventions`'s quality-scoring ground-truth pointer**
  (`docs/research/cmpb-submission/manuscript/00_Manuscript.tex`) is
  still correct and doesn't conflict with the new docs — RF018/RNF the
  new dictionary's RCS treatment matches the manuscript's model. No
  change needed there.
- The `docs/` top-level files (`BioAvanceD_Dicionario_Dados_Consolidado_v1.0.xlsx`,
  `BioAvanceD_Modelo_Unificado_Fase_{1,2,3}_v1.x.docx`) are now
  superseded by `docs/docs-7-27-2026/2 - Dicionario_Dados_Consolidado_v1.3.0.xlsx`
  and the new requirements/plan docs per those docs' own changelog
  (`dict-09_CHANGELOG.md`). Left in place for history — not deleting
  anything without Dennis's go — but any future read should prefer the
  v1.3.0 set.
