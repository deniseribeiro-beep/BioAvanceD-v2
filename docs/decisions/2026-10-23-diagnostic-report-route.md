# 2026-10-23: DiagnosticReport gets a create, read and per-participant list route

Dictionary P1X-0168..P1X-0174 (`DiagnosticReport`). Issue #695, slice 2.

## The question

Slice 1 (`docs/decisions/2026-10-23-diagnostic-report-entity.md`) stored the entity and checked the three references to it, but left "a route" undecided, so nothing outside the service layer could create the report a `Condition`, `PhenotypeObservation` or `ClinicalObservation` reference must resolve to. Which routes, behind which gates, and what does each return?

## Decided

By the coordinator for #695, on 2026-10-23:

1. **`/api/diagnostic-reports`** (`api/backend/src/interface/routes/diagnostic-report.routes.js`) serves `POST /`, `GET /:diagnosticReportId` and `GET /?participantId=<id>`. No PUT or DELETE.
2. **`POST /` needs `createPatient`;** both GETs need a session and organization scope only.
3. **`POST /` reads only `participantId`, `encounterId`, `reportStatus`, `issuedDateTime`, `resultIds` and `documentUri` from the body,** so `diagnosticReportId` is always assigned by the model, and writes through `createDiagnosticReport`, so the `resultIds` check always runs. Its refusals answer 422 with a `details` list (RNF018, #1299).
4. **A participant whose patient record belongs to another organization is refused with 403** on all three routes, before any write: the #626 check `isRecordInOrganizationScope(patient, scope, 'clinicalUnitId')`. A participant with no patient record is not refused, as `participantId` stays unenforced (slice 1, item 3).
5. **`GET /` without a `participantId` answers 400,** so no call lists every participant's reports.
6. **`POST /` refuses a malformed field with 422 instead of storing its coercion,** every failure in one `details` list: a non-list `resultIds` (the model would store it as `[]`, skipping its check), a non-text `reportStatus` and an `issuedDateTime` that parses to no date.
7. **Audit entity `DiagnosticReport`** for the `diagnostic-reports` path in `ENTITY_MAP`.

`[inference]` The write gate is `createPatient` and the reads need a session plus organization scope only, read off `/api/patients/:id/observations` (`api/backend/src/interface/routes/patient.routes.js` lines 36-37), the one participant-linked clinical record the API already creates and lists.

`[inference]` The report id is server-assigned and the body's is dropped, as `createBiomarkerObservation` (`api/backend/src/controllers/paciente.controller.js`) builds its payload from an allowlist.

`[inference]` The full record is returned to every scoped reader, since a report carries references and a status, not the measured values `listBiomarkerObservations` masks from a reader without `createPatient`.

## Not decided here

- **Updating or deleting a report,** a screen for it, and its FHIR mapping (MAP-V2-005).
