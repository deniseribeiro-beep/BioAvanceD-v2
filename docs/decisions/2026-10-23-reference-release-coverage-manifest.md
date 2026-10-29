# 2026-10-23: a full reference import writes a ReferenceCoverageManifest and a release DataQualityAssessment, and promotion refuses a release without passing ones

Requirements RF028 AC6, AC7 and RNF032 C7; dictionary V2E-0261..0269, V2E-0489; rule RULE-017; relationship REL-0179. Issue #1319.

## The question

RF028 asks to promote releases "preservando origem, licença, cobertura, qualidade e rollback", and RULE-017 says a promotion request without "License, checksum, parser, mapping and justified coverage" must "Block promotion". No full import wrote a ReferenceCoverageManifest (V2E-0261..0269) or a DataQualityAssessment of its release, the release had no V2E-0489 `coverageManifestId` (Reference(ReferenceCoverageManifest), 1..1, Core), and `promoteRelease` (`api/backend/src/services/referenceRelease.service.js`) promoted any `approved` release whose approved full run it found. What does a manifest count, how is a release's quality scored, when are both written, and what does promotion require of them?

## Decided

By the coordinator for #1319, on 2026-10-23:

1. **`api/backend/src/models/ReferenceCoverageManifest.js` models V2E-0261..0269.** `fieldsOf()` returns exactly the nine canonical fields, and the entity is registered in the canonical-catalog conformance guard with zero drift. `create()` computes `coverageResult` and `checksum` when absent and adds `datasetCode` and `referenceImportRunId`. `validate()` requires every 1..1 field, a non-empty `assets` of non-empty strings, non-negative integer counts, an `exclusions` array whose every entry has a `reason` and a `justification`, a `coverageResult` equal to the one the counts give, a valid `generatedAt` and a `checksum` of the form `sha256:<64 hex>`. The collection is `referenceCoverageManifests` (`COLL_REFERENCE_COVERAGE_MANIFESTS`).
2. **The checksum (V2E-0269) is the SHA-256 of the manifest's content:** `JSON.stringify` of `referenceDatasetReleaseId`, `assets`, `expectedCount`, `obtainedCount`, `exclusions` and `coverageResult`, in that order, prefixed `sha256:`. The id, `generatedAt` and the checksum itself are not in it.
3. **A full run writes one manifest and one assessment for its release before the release's status flip,** and the flip to `approved` or to `rejected` sets `coverageManifestId` and `dataQualityAssessmentId` in the same write as the status. The manifest is validated and the assessment inserted through `insertDataQualityAssessment` (`api/backend/src/ingestion/dataQualityAssessment.js`); an invalid one throws. The obtained count is read from staging, so a resumed run counts the same as a fresh one. A crash between the inserts and the flip leaves an unreferenced manifest and assessment; the resumed run writes fresh ones and the release names those. Nothing is deleted. The return value of `runImport` is unchanged.
4. **`promoteRelease` gates on both, after its approved-run check and before its staging read and claim,** so a refusal writes nothing, sets no `promotionClaimedAt` and logs no AuditEvent. It promotes only on positive evidence, and refuses with:
   - `coverage_manifest_missing`: the release names no manifest, or none is found by that id;
   - `coverage_manifest_invalid`: the manifest fails `validate()`, covers another release, or its checksum is not that of its content;
   - `coverage_incomplete`: its `coverageResult` is neither `complete` nor `justified`;
   - `quality_assessment_missing`: the release names no assessment, or the one found is not a `dataset_release` assessment of this release;
   - `quality_assessment_failed`: its `status` is not `passed`.
   The route answers each with 409.
5. **A release approved before this change names neither and is refused at promotion,** as RULE-017's "Block promotion" asks. No backfill is written.

`[inference]` `expectedCount` is the number of rows read from the preserved asset, and `obtainedCount` the number of concepts staged. The bundled samples carry no declared total, and the preserved asset is the bytes whose checksum was verified.

`[inference]` An exclusion is a row-level issue (`entityType` `TerminologyConcept`): each consumed a source row and staged nothing. It is recorded as `{ rowNumber, sourceRecordId, reason, justification }`, with the issue's `errorCode` as `reason` and its `errorMessage` as `justification`. Every row-level issue is an exclusion and the manifest refuses a blank `reason` or `justification`, so an issue with a blank or missing `errorCode` has `UNSPECIFIED_REJECTION` as `reason`, and one with a blank or missing `errorMessage` has its `reason` as `justification` (#1398). An `ORPHAN_RELATION` issue consumed no row and is not an exclusion.

`[inference]` `coverageResult` is `complete | justified | incomplete`; the dictionary's only example is `complete`. It is `complete` when every row read was staged, `justified` when the gap is exactly the exclusions, and `incomplete` otherwise: an unexplained gap (two rows sharing one code), more staged than read, or a non-integer count.

`[inference]` An `expectedCount` of 0 is `incomplete`, and its completeness 0: nothing read is never complete coverage.

`[inference]` The release's assessment (`scopeType` `dataset_release`, `entityType` `ReferenceDatasetRelease`, `assessmentVersion` 1.0.0, `createdBy` the run's `initiatedBy`) scores three of RNF011's dimensions. Completeness is (obtained + exclusions) / expected, minimum 1. Validity is 0 with a fatal issue, else 1 minus the run's rejection rate, minimum 1 minus the pipeline's `REJECTION_RATE_BLOCK_THRESHOLD` (0.5). Provenance is the share of `sourceId`, `datasetVersion`, `retrievalUri`, `license`, `sourceChecksum`, `parserVersion` and `mappingVersion` present on the release, minimum 1. It is `passed` only when every result is a number at or above its minimum. Consistency, uniqueness and timeliness are not scored: a release has no record-level model check, its concepts are keyed by code, and its asset has no retrieval date apart from the run's own.

`[inference]` The manifest and the assessment are written for an approved and a rejected release alike, so a rejected release records why. They are never written for a dry run or a checksum mismatch, which register no release, or for a release already `active` (a re-run of its content), which keeps its own.

`[inference]` `dataQualityAssessmentId` on the release is not a dictionary field. It names the release's own assessment, as `promotionClaimedAt` is a non-dictionary field the promotion needs.

`[inference]` `coverageManifestId` is 1..1 in V2E-0489 but is enforced by the promotion gate, not by `ReferenceDatasetReleaseModel.validate()`. A release is registered before its manifest exists, REL-0179 reads "Validated before promotion", and the e2e seed's active release, which `e2e-fixture-model-fidelity.arch.test.js` validates, has none. `validate()` requires each id, when present and non-null, to be a string.

## Not decided here

- **The essential-reference loader** `api/backend/scripts/load-essential-references.js`, whose manifest carries no license or retrieval URI.
- **Serving a manifest through an API.**
- **A backfill for a release approved before this change.** It is refused at promotion, and re-running its content does not repair it: `runImport` returns the earlier terminal run as idempotent and writes no manifest.
