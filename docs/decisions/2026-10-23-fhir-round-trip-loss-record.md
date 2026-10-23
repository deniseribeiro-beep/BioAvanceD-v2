# 2026-10-23: FHIR staging records its round-trip loss, per record and per batch, as paths

Requirement RF011 AC6, RNF024 C6. Issue #1322.

## The question

RF011 AC6 asks the import to "Registrar campos não mapeados e limitações de round-trip sem forçar equivalência", and RNF024 C6 to "Registrar roundTripLossReport e preservar extensões nacionais no modelo canônico". The FHIR Bundle staging path (`stageBundle` in `api/backend/src/services/fhir-import-staging.service.js`) maps Patient, Specimen, Consent, Condition and Observation onto a staged record's `normalized` fields, and recorded nowhere which FHIR elements, or which whole resources, no canonical field carries. What is recorded, where, and in what shape?

## Decided

`[inference]`, from the specification and the repo's pattern, by the coordinator for #1322, on 2026-10-23:

1. **The shape parallels the MIABIS export.** `miabisExport.service.js` already reports what it drops as `roundTripLoss: { droppedFieldCount, dropped }`; the staging loss is read off that pattern. A pure module, `api/backend/src/resources/fhir/round-trip-loss.js`, builds it without touching a database (RF011 AC7).
2. **It is recorded at staging, per record and per batch.** Each staged record carries `roundTripLoss: { unmappedCount, unmapped: [{ source, path }], truncated, limitations }`, where `source` is `patient`, `specimen`, `consents[i]`, `conditions[i]` or `observations[i]` and `path` names a leaf such as `Patient.name[1].given[0]`; a key that is not an identifier is quoted, `Patient["name[0]"].text`, so it never matches a mapped path. The batch carries `roundTripLoss: { unattachedResourceCount, unattached: [{ resourceIndex, resourceType }] }`: each Bundle resource no record attaches (an Organization, a Patient with no Specimen, an unlinked Observation).
3. **The stored list is capped at 50 paths.** `unmappedCount` counts every unmapped leaf; `unmapped` keeps the first 50 after sorting by source then path (one numeric `Intl.Collator`), and `truncated` says whether it was cut. A Bundle with thousands of Observations would otherwise grow each staged document by megabytes, toward MongoDB's 16 MB document limit, and block staging for seconds. The paths of an Observation, Condition or Consent several records attach are computed once per Bundle.
4. **Paths, never values.** The report carries no value, id or extension url from a resource. A staged record's `fhir` and `normalized` are sealed at rest (#1191); `roundTripLoss` is not added to the sealed fields, so it must hold nothing they protect.
5. **Limitations are declared prose, not forced equivalence.** What a path list cannot show (a first-non-empty chain keeps one value, only the first `Patient.name` is read, a repeated extension after the first match is ignored, an Observation linked by patient and specimen is listed twice, the Patient identifier's system is not kept, a Condition's `diseaseName` keeps only the first non-empty of `code.text` and the CID, Orpha and OMIM displays, no coding `system` is kept, the list is capped, the Bundle's own elements are not kept) is stated in `ROUND_TRIP_LIMITATIONS`, a frozen list of short Portuguese sentences on every record.
6. **"Mapped" is measured against the staging `normalized` fields.** A leaf counts as mapped only when `normalizeSpecimen` and its helpers read it into `normalized`; the module mirrors those reads, `extractIdentifier`'s fallback included, and changes with them. A matched coding's `system` is not stored, so it is reported.

## Known further loss

`commitBatch` carries on a subset of `normalized`: it keeps the raw Specimen in `Sample.fhir`, but commits no `barcode`, `storageTemperature`, `diseases`, `biomarkers` or `phenotypes`. That loss, between staging and the committed records, is not in this report.

## Not decided here

- **The InteroperabilityMappingRelease `roundTripLossReportUri`**: no mapping release is stored in Phase 1.
- **The export direction** (canonical to FHIR).
- **The frontend** display of the report.
