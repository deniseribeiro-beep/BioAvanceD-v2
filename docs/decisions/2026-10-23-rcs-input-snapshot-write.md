# 2026-10-23: the RCS assessment write freezes the input it was computed from, with no score change

Requirement RF018 AC2/AC3. Dictionary V2E-0497..0512 (RCSInputSnapshot), V2E-0439..0444 (qualificationContext and its five fields), V2E-0447 (inputSnapshotUri), V2E-0538 (inputSnapshotId), P1X-0060 (rcsAssessmentId), P1X-0069 (inputSnapshotHash). Issue #1320. Sequel to `2026-10-22-rcs-input-snapshot-structures.md`.

## The question

RF018 AC3 asks for exactly one immutable, resolvable RCSInputSnapshot per RCS assessment, with id, URI, hash, schemaVersion, sources and instant, and AC2 asks that the assessment carry its use context. `recordAssessment` stored only the result, and the slice-1 snapshot model's strict `create()` needs references no source can supply yet: no SPRECMappingRelease exists, no write site carries an event id, and no axis-input or governance-evidence records are written. What does the assessment write freeze now, and how, without changing a score, grade, penalty, route or `calculation_trace` (which `MerkleService.js` hashes)?

## Decided

`[inference]`, from the specification and the repo's pattern, by the coordinator for #1320, on 2026-10-23:

1. **The snapshot captures the read set `certify` consumes, proven by recalculation.** `rcsCertificationService.readInput(payload)` keeps exactly the payload keys `certify` reads (matrix, SPREC, governance flags, workflow context and the per-axis workflow rules), as a JSON-safe deep copy, and no other key: no personal field is frozen. Its contract is `certify(readInput(p))` deep-equals `certify(p)`. The pattern is RF018's requirement text ("integralmente recalculável") and the manuscript (`docs/research/cmpb-submission/manuscript/00_Manuscript.tex`): a deterministic, auditable pipeline with a non-compensable gate (eq:governance_product) and a grade derived from the score and the gate only (eq:final_grade_rcs), so the inputs that function reads are the whole input. The snapshot holds the JSON form of that input, so recalculation from it is exact for a JSON request body, which every route sends; a value JSON cannot carry (NaN, a Date) reaches it as null or a string.
2. **A reference no release or event backs is null or empty, never fabricated.** `RcsInputSnapshot.capture` sets `materialTypeCode`, `matrixMappingReleaseId`, `governanceEvidenceId` and `sprecMappingReleaseId` to null and `sourceEventIds` and `preanalyticalAxes` to `[]`, so a captured snapshot does not pass `validate()` until a later slice writes them; `validate` and `create` stay strict. The pattern is slice 1's item 4, where RULE-011 outranks a 1..1 rather than writing a false value.
3. **`inputs` sits outside `fieldsOf`.** The frozen read set is one key beside the catalog fields, as `assessedAt` sits outside `RcsAssessment.fieldsOf`, so RCSInputSnapshot keeps zero catalog drift.
4. **The URI and hash follow ReadinessReport and ConfigurationValidationRun.** `snapshotHash` is `sha256:` plus the SHA-256 of `canonicalJson` (from `ConfigurationRelease.js`) over the document without the hash and the URI, `inputs` included, and `snapshotUri` is `urn:bioavanced:rcs-input-snapshot:<id>#sha256=<hex>`, resolved by `rcsAssessmentService.getInputSnapshotById`. A changed document no longer matches its own URI.
5. **`schemaVersion` 1.0.0 names this capture's own serialization**, the fieldsOf keys plus `inputs`, not the canonical model's release version.
6. **Snapshot before assessment, with compensation on failure.** `recordAssessment` takes the `rcsAssessmentId` first and builds both documents before writing either, so a build failure (an empty `specimenId`, normalised the same way for both) writes nothing. It then writes the frozen snapshot to `rcsInputSnapshots` (a shallow copy, since the driver writes `_id` onto what it is given), then the assessment with `inputSnapshotId`, `inputSnapshotUri` and `inputSnapshotHash`. If the assessment insert fails, the snapshot is deleted and the insert error rethrown (a failed delete is logged, never thrown in its place), so no snapshot is left without its assessment. A result with no `rcs_input` (a FHIR record staged before this change) writes no snapshot and carries null references.
7. **Use context only when the request carries it (AC2).** `evaluateQuality` adds `qualification_context` only for a plain-object `qualificationContext` on the payload or its `sample`, keeping exactly `intendedUseCode`, `targetAnalyte`, `assayFamily`, `workflowProtocolId` and `workflowProtocolVersion`, each a non-empty string or plain object, else null. With none, `RCSAssessment.qualificationContext` is null, never `{}`; its five fields are held nested, as the v2.0.0 synthetic example (`biobankExample.rcsAssessments[0]`) nests them.

## Not decided here

- **SPRECMappingRelease and RCSRulePackage** (the matrix, SPREC and severity mapping releases, the rule package version and checksum).
- **The axis-input and governance-evidence records** the snapshot's `preanalyticalAxes` and `governanceEvidenceId` reference, and the snapshot's `sourceEventIds`.
- **routeReasons** (RF018 AC8).
- **The AC11 statement** that the RCS is not clinical validity, assay quality or a universal measure.
- **The `detectMatrixType` inference** from sample text and SPREC axes, which AC4 forbids as an unversioned rule.
- **The Foundation `rcs` readiness gate**, which stays deferred.
