# 2026-10-23: DiagnosticReport is built as a full entity, and the three references to it are checked

Dictionary P1X-0168..P1X-0174 (`DiagnosticReport`), ELM-0209 (`Condition.diagnosisEvidence`), ELM-0218 (`PhenotypeObservation.phenotypeEvidence`) and ELM-0232 (`ClinicalObservation.diagnosticReportId`). Issue #695.

## The question

`DiagnosticReport` had no model, service or collection, so the three fields that reference it were stored unchecked, each with a comment saying no DiagnosticReport entity existed. The issue held off because the v1.3.0 dictionary (`docs/docs-7-27-2026/extracted/dict-02_DICIONARIO.md`) marked all 7 rows "P1-Stub". Should the entity be built now, with what rules, and how should each of the three references be checked?

## Decided

By the coordinator for #695, on 2026-10-23:

1. **`DiagnosticReportModel`** (`api/backend/src/models/DiagnosticReport.js`) emits exactly the 7 canonical fields: `diagnosticReportId` (a generated UUID when absent), `participantId`, `encounterId`, `reportStatus`, `issuedDateTime`, `resultIds` and `documentUri`. `create` requires `participantId` and `reportStatus`, and names every missing field in one error.
2. **Collection key `diagnosticReports`,** overridable with `COLL_DIAGNOSTIC_REPORTS`, as its clinical siblings are.
3. **`createDiagnosticReport`** (`api/backend/src/services/diagnostic-report.service.js`) refuses a report whose `resultIds` entry names no `observationId` in `clinicalObservations`, and inserts nothing. `participantId` and `encounterId` are not checked.
4. **`ClinicalObservation.diagnosticReportId`** must resolve to a real report: `DiagnosticReport/<id>` and a bare `<id>` both look up `<id>`, and any other value fails the lookup.
5. **`Condition.diagnosisEvidence` and `PhenotypeObservation.phenotypeEvidence`** check only an entry that begins with exactly `DiagnosticReport/`; any other entry is stored unchecked, as before. The type is read from that prefix only, never guessed from free text.
6. **A reference whose id comes out empty** (`DiagnosticReport/`, or whitespace where every value is checked) is refused as `Referência malformada`, since the existence check skips an empty value.
7. No HTTP route and no FHIR mapping of the entity (MAP-V2-005) are added here.

`[inference]` The approved v2.0.0 rows supersede the v1.3.0 "P1-Stub" mark: in `docs/extracted-v2.0.0/dict-DICIONARIO.md` all 7 rows are `maintained`, Phase 1, and the release `docs/RELEASE_MANIFEST.json` names is the authority for the data model.

`[inference]` `reportStatus` (FHIR DiagnosticReportStatus) is required and stored as given, not enumerated, as `ClinicalObservation.observationStatus` (ELM-0228) is in `api/backend/src/models/ClinicalObservation.js`.

`[inference]` `participantId` and `encounterId` stay unenforced, as `encounterId` is on `PhenotypeObservation` and `ClinicalObservation`, and no service in this domain checks `participantId`. `resultIds` is hard-checked, as `specimenId` and `deviceId` are in `api/backend/src/services/clinical-observation.service.js` (#691).

`[inference]` The evidence arrays check only `DiagnosticReport/`-typed entries because their definitions admit more than reports: ELM-0209 "Exames, laudos, critérios ou profissionais", ELM-0218 "laudos, imagens, exames ou notas". `diagnosticReportId` checks every value because ELM-0232 is "Relatório diagnóstico que agrupa o resultado", a single report.

## Not decided here

- **A route, a screen or a FHIR mapping for DiagnosticReport.**
- **Whether `participantId` and `encounterId` are enforced** across the clinical domain; that is one question for every entity in it, not for this one alone.
