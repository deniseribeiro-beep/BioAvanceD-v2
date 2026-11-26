# Canonical Active Surface

Superseded on 2026-11-17 by legacy-surface-inventory.md; kept as the 2026-07-08 record.

Branch: `refactor/canonical-data-contracts`
Date: `2026-07-08`

## Scope

This inventory covers runtime code that is currently mounted or imported by the active backend and frontend entrypoints.

Classification:

- `A` active and must be canonicalized
- `B` dead / not imported and should be deleted
- `C` permitted negative test
- `D` historical documentation
- `E` operational script and should be canonicalized
- `F` legacy script and should be removed or moved outside runtime

## Backend active surface

### Entrypoints and mounted routes

- `api/backend/app.js` - active backend entrypoint.
- `api/backend/src/interface/routes/auth.routes.js` - mounted at `/api/auth`.
- `api/backend/src/interface/routes/orphanet.routes.js` - mounted at `/api/orphanet`.
- `api/backend/src/interface/routes/hpo.routes.js` - mounted at `/api/hpo`.
- `api/backend/src/interface/routes/patient.routes.js` - mounted at `/api/patients` and `/api/v1/patients`.
- `api/backend/src/interface/routes/sample.routes.js` - mounted at `/api/samples`.
- `api/backend/src/interface/routes/label.routes.js` - mounted at `/api/labels`.
- `api/backend/src/interface/routes/quality.routes.js` - mounted at `/api/quality`.
- `api/backend/src/interface/routes/import.routes.js` - mounted at `/api/import`.
- `api/backend/src/interface/routes/result.routes.js` - mounted at `/api/results`.
- `api/backend/src/interface/routes/reports.routes.js` - mounted at `/api/reports`.
- `api/backend/src/interface/routes/logs.routes.js` - mounted at `/api/logs`.
- `api/backend/src/interface/routes/audit.routes.js` - mounted at `/api/audit`.
- `api/backend/src/interface/routes/analysis-file.routes.js` - mounted at `/api/analysis-files`.
- `api/backend/src/interface/routes/analysis-type.routes.js` - mounted at `/api/analysis-types`.
- `api/backend/src/interface/routes/master-data.routes.js` - route factory used for several mounted master-data endpoints.
- `api/backend/src/interface/routes/equipment.routes.js` - mounted at `/api/equipment`.
- `api/backend/src/interface/routes/location.routes.js` - mounted at `/api/locations`.
- `api/backend/src/interface/routes/clinical-unit.routes.js` - mounted at `/api/clinical-units`.
- `api/backend/src/interface/routes/storage.routes.js` - mounted at `/api/storage`.
- `api/backend/src/interface/routes/policy.routes.js` - mounted at `/api/policies`.
- `api/backend/src/interface/routes/sensor.routes.js` - mounted at `/api/sensors`.
- `api/backend/src/interface/routes/iot.routes.js` - mounted at `/api/iot`.
- `api/backend/src/interface/routes/temperature.routes.js` - mounted at `/api/temperature`.
- `api/backend/src/interface/routes/incident.routes.js` - mounted at `/api/incidents`.
- `api/backend/src/routes/eConsent.js` - mounted at `/api/e-consent`.
- `api/backend/src/interface/routes/intakeWizard.routes.js` - mounted at `/api/intake-wizard`.
- `api/backend/src/interface/routes/terminologies.routes.js` - mounted at `/api/terminologies`.
- `api/backend/src/interface/routes/user.routes.js` - mounted at `/api/users`.
- `api/backend/src/interface/routes/access.routes.js` - mounted at `/api/access`.
- `api/backend/src/interface/routes/security.routes.js` - mounted at `/api/security`.
- `api/backend/src/interface/routes/user-security.routes.js` - mounted at `/api/user/security`.
- `api/backend/src/interface/routes/backup.routes.js` - mounted at `/api/backup`.
- `api/backend/src/interface/routes/import-lgpd.routes.js` - mounted at `/api/import-lgpd`.
- `api/backend/src/interface/routes/compliance.routes.js` - mounted at `/api/compliance`.
- `api/backend/src/interface/routes/cid.routes.js` - mounted at `/api/cids`.
- `api/backend/src/interface/routes/phone-codes.routes.js` - mounted at `/api/phone-codes`.
- `api/backend/src/interface/routes/dictionary.routes.js` - mounted at `/api/dictionary`.

### Active controllers/services/core/infrastructure

- `api/backend/src/controllers/import.controller.js` - active and high-risk.
- `api/backend/src/controllers/import-lgpd.controller.js` - active and high-risk.
- `api/backend/src/controllers/paciente.controller.js` - active by patient routes.
- `api/backend/src/services/consent.validator.js` - active.
- `api/backend/src/services/SampleGraphValidator.js` - active.
- `api/backend/src/services/batch-validation-engine.service.js` - active.
- `api/backend/src/services/analysisValidation.service.js` - active.
- `api/backend/src/services/storageService.js` - active.
- `api/backend/src/services/hl7.service.js` - active.
- `api/backend/src/services/securityAlerts.service.js` - active.
- `api/backend/src/services/temperature.service.js` - active.
- `api/backend/src/services/sampleComplianceSync.service.js` - active.
- `api/backend/src/services/sample.service.js` - active.
- `api/backend/src/services/neo4jOutbox.service.js` - active.
- `api/backend/src/services/neo4jCanonicalProjection.service.js` - active.
- `api/backend/src/services/merkle-envelope.service.js` - active.
- `api/backend/src/infrastructure/database/neo4j/LineageRepository.js` - active.
- `api/backend/src/infrastructure/persistence/mongo/MongoStorageRepository.js` - active.
- `api/backend/src/infrastructure/persistence/mongo/MongoStorageTopologyReadRepository.js` - active.
- `api/backend/src/infrastructure/persistence/mongo/MongoPatientConsentReadRepository.js` - active.
- `api/backend/src/infrastructure/persistence/mongo/MongoAuditRepository.js` - active.
- `api/backend/src/infrastructure/queue/Neo4jQuarantineService.js` - active.
- `api/backend/src/infrastructure/queue/TopologicalQuarantine.js` - active.
- `api/backend/src/workers/worker.js` and `api/backend/src/workers/workers/*.js` - active worker entrypoints.
- `api/backend/scripts/neo4j-canonical-rebuild.js` - operational script and active.
- `api/backend/scripts/lint.js` - operational script and active.
- `api/backend/scripts/audit-verify.js` and companion audit scripts - operational.
- `api/backend/scripts/seed-essential-reference-data.js` - one-shot bootstrap on compose.dev.yml's `foundation-bootstrap` service (#366); compose.test.yml/CI still only exec it manually or via --dry-run until #371 lands.
- `api/backend/scripts/validate-essential-reference-data.js` - structural validation only.
- `api/backend/scripts/reference-imports/import-large-reference-dataset.js` - scaffold only.

### Backend legacy / cleanup candidates

- `api/backend/src/services/fhir-import-staging.service.js` - active boundary helper, but keep as narrow boundary only.
- `api/backend/src/services/quality-compatibility.service.js` - likely compatibility surface; review for runtime use.
- `api/backend/src/controllers/import-async.controller.js` - verify active imports.
- `api/backend/src/controllers/import-batch.controller.js` - verify active imports.
- `api/backend/src/controllers/fhir-import-staging.controller.js` - verify active imports.
- `api/backend/scripts/migrate-patients-to-modular.js` - likely legacy operational script candidate.

## Frontend active surface

### Entrypoints and routed pages

- `frontend/src/main.tsx` - active frontend entrypoint.
- `frontend/src/App.tsx` - active router.
- `frontend/src/components/Layout/Layout` - active layout shell.
- `frontend/src/components/ProtectedRoute` - active route guard.
- `frontend/src/pages/patient/EConsentPage.tsx` - active.
- `frontend/src/pages/patient/EConsentImportPage.tsx` - active.
- `frontend/src/pages/patient/EConsentLinkPanel.tsx` - active.
- `frontend/src/pages/v2/intake/IntakeWizardPage` - active intake route target.
- `frontend/src/foundation/FoundationApp.tsx` - active `/next/*` surface.
- `frontend/src/views/LoginPage.tsx` - active.
- `frontend/src/views/Dashboard.tsx` - active.
- `frontend/src/views/PatientsPage.tsx` - active.
- `frontend/src/views/FhirImportPage.tsx` - active.
- `frontend/src/views/SampleDetailsPage.tsx` - active and high-risk.
- `frontend/src/views/ResultsPage.tsx` - active.
- `frontend/src/views/NewUserPage.tsx` - active.
- `frontend/src/views/NewUserSuccessPage.tsx` - active.
- `frontend/src/views/LogsPage.tsx` - active.
- `frontend/src/views/LogDetailPage.tsx` - active.
- `frontend/src/views/SampleLabelPage.tsx` - active.
- `frontend/src/views/SampleChainPage.tsx` - active.
- `frontend/src/views/SampleMovementsPage.tsx` - active.
- `frontend/src/views/SampleWithdrawalReturnPage.tsx` - active.
- `frontend/src/views/SampleCustodyReportsPage.tsx` - active.
- `frontend/src/views/FacilityManagementPage.tsx` - active.
- `frontend/src/views/SystemManagementPage.tsx` - active.
- `frontend/src/views/ReportsPage.tsx` - active.
- `frontend/src/views/ReportViewPage.tsx` - active.
- `frontend/src/views/ReportQueryPage.tsx` - active.
- `frontend/src/views/QualityDescriptionPage.tsx` - active.
- `frontend/src/views/BackupPage.tsx` - active.
- `frontend/src/views/UserSecurityPage.tsx` - active.
- `frontend/src/views/MFASetupPage.tsx` - active.
- `frontend/src/views/ResetPasswordPage.tsx` - active.
- `frontend/src/views/SettingsParametersPage.tsx` - active.
- `frontend/src/views/DataDictionaryPage.tsx` - active.
- `frontend/src/views/TcleBuilderPage.tsx` - active.
- `frontend/src/components/v2/ImportForm` - active.

### Frontend legacy / cleanup candidates

- `frontend/src/components/v2/intake/ClinicalIntakeWizard.jsx` - legacy intake candidate; likely replace or delete after confirming current imports.
- `frontend/src/views/SampleDetailsPage.tsx` - active and semantic hotspot.
- `frontend/src/components/v2/*` legacy surfaces that are not imported by `App.tsx` should be deleted rather than normalized in place.

## Classification snapshot for alias-heavy active files

### A - active and canonicalize

- `api/backend/src/routes/intakeWizard.js`
- `api/backend/src/interface/routes/intakeWizard.routes.js`
- `api/backend/src/controllers/import-lgpd.controller.js`
- `api/backend/src/controllers/import.controller.js`
- `api/backend/src/controllers/paciente.controller.js`
- `api/backend/src/services/consent.validator.js`
- `api/backend/src/services/SampleGraphValidator.js`
- `api/backend/src/services/batch-validation-engine.service.js`
- `api/backend/src/services/analysisValidation.service.js`
- `api/backend/src/services/storageService.js`
- `api/backend/src/services/hl7.service.js`
- `api/backend/src/services/securityAlerts.service.js`
- `api/backend/src/services/temperature.service.js`
- `api/backend/src/services/sampleComplianceSync.service.js`
- `api/backend/src/scripts/neo4j-canonical-rebuild.js`
- `frontend/src/components/v2/intake/ClinicalIntakeWizard.jsx` if still imported by active intake pages
- `frontend/src/views/SampleDetailsPage.tsx`

### B - dead / delete after import verification

- `api/backend/src/controllers/import-async.controller.js`
- `api/backend/src/controllers/import-batch.controller.js`
- `api/backend/src/controllers/fhir-import-staging.controller.js`

### C - negative tests allowed

- Architecture tests under `api/backend/tests/architecture`

### D - documentation historical

- `docs/architecture/canonical-data-cleanup.md`
- this inventory file

### E - operational scripts

- `api/backend/scripts/neo4j-canonical-rebuild.js`
- `api/backend/scripts/lint.js`
- audit verification scripts under `api/backend/scripts`
- `api/backend/scripts/seed-essential-reference-data.js`
- `api/backend/scripts/validate-essential-reference-data.js`
- `api/backend/scripts/reference-imports/import-large-reference-dataset.js`

### F - legacy scripts to remove or archive outside src

- `api/backend/scripts/migrate-patients-to-modular.js`
- any script under `api/backend/scripts` that only supports retired FHIR-first or legacy alias contracts

## Notes

- `tmp/` is not ignored in the current `.gitignore`, so this inventory is kept under `docs/architecture/`.
- The current intake route still contains alias-heavy payload assembly and legacy compatibility fields; that file is a semantic hotspot rather than a pure boundary.
- `App.tsx` is the source of truth for active frontend views and route targets.
- Runtime grep still reports residual aliases by design; this document classifies them rather than claiming zero.
- Essential reference seed remains manual and idempotent; it is not mounted by application startup.

## Known Residual Legacy Surfaces

- `api/backend/src/interface/routes/sample.routes.js`
- `api/backend/src/interface/routes/reports.routes.js`
- `api/backend/src/routes/intakeWizard.js`
- `frontend/src/views/SampleDetailsPage.tsx`
- `frontend/src/components/v2/intake/ClinicalIntakeWizard.jsx`
- `api/backend/src/services/analysisValidation.service.js`
- `api/backend/src/services/consent.validator.js`
- `api/backend/src/services/hl7.service.js`
- `api/backend/src/services/sampleComplianceSync.service.js`
- `api/backend/src/services/storageService.js`
- `api/backend/src/services/batch-validation-engine.service.js`
- `api/backend/src/services/import.service.js`
- `api/backend/src/services/import-lgpd.service.js`
- `api/backend/src/services/quality-compatibility.service.js`
- `api/backend/src/core/use-cases/*`

## Deferred Cleanup Plan

- PR 100 - Canonicalize participant flow
- PR 101 - Canonicalize specimen, custody and storage flow
- PR 102 - Canonicalize frontend intake and active views
- PR 103 - Remove inactive legacy runtime files
- PR 104 - Build aggregate/domain matrix

## PR 100 - Participant flow canonicalization

- Files treated: `api/backend/src/models/Patient.js`, `api/backend/src/services/patient.service.js`, `api/backend/src/services/PatientIdentityService.js`, `api/backend/src/utils/patientAnonymization.js`, `api/backend/src/controllers/paciente.controller.js`, `frontend/src/hooks/usePatients.ts`, `frontend/src/views/PatientsPage.tsx`, `frontend/src/components/UI/PatientSearchInput.tsx`, `frontend/src/services/api.ts`.
- Aliases removed from participant runtime: `patientID`, `patientId`, `pseudoId`, `cpf`, `representativeCpf`.
- Aliases remaining outside scope: specimen/sample/report/intake and historical docs still contain legacy participant vocabulary.
- Route decisions: patient routes keep historical names, but request payloads are canonical and alias payloads return 422 `NON_CANONICAL_FIELD`.
- Tests added: participant architecture gate and canonical alias rejection unit tests.
- Risks: sample-boundary adapters, consent boundary helpers, and legacy import paths still carry participant vocabulary outside the participant runtime slice.
