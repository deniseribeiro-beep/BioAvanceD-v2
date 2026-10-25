# 2026-10-25: an RCSAssessment records its context's intended use and target analyte top-level, beside the nested qualificationContext

Requirement RF018 AC2. Dictionary V2E-0440 (RCSAssessment.intendedUseCode, CodeableConcept, 1..1, Core) and V2E-0441 (RCSAssessment.targetAnalyte, CodeableConcept, 1..1, Core). Issue #1320. Extends `2026-10-24-rcs-assessment-assay-family-and-workflow-protocol.md` and item 7 of `2026-10-23-rcs-input-snapshot-write.md`.

## The question

The catalog names `intendedUseCode` and `targetAnalyte` as their own RCSAssessment rows. After V2E-0442..0444 became top-level fields, `RcsAssessmentModel.fieldsOf` still did not emit these two, so they were held only nested under `qualificationContext`, and the conformance test carried both as known drift. Where do the top-level fields come from, when are they null, and what happens to the nested context, without changing a score, grade, route, `certify()` or `calculation_trace`?

## Decided

`[inference]`, from the catalog rows and the repo's pattern (the 2026-10-24 record for V2E-0442..0444 emits a catalog field from the result's own record on positive evidence, else null, and keeps the pre-existing nested field beside it), by the coordinator for #1320, on 2026-10-25:

1. **The source is the result's own `qualification_context`.** `RcsAssessmentModel.fromCertificationResult` maps `qualification_context?.intendedUseCode` and `?.targetAnalyte` onto the two top-level fields, as result-derived keys placed after the spread `refs`, so a `refs.intendedUseCode` never wins, as `assayFamily` does. `fieldsOf` emits each as `data.<field> ?? null`. The service passes nothing new.
2. **The value passes through unchanged.** A string or a plain object, the same reference the nested context holds, with no type check, trim or normalisation, so `assessment.intendedUseCode === (assessment.qualificationContext?.intendedUseCode ?? null)` for every result, and likewise for `targetAnalyte`. `readQualificationContext` in `quality-domain.service.js` already keeps each field as a non-empty trimmed string or a plain object, else null.
3. **Null without positive evidence; never computed or defaulted.** A result with no `qualification_context`, a null one, or one whose field is null gives null. The value is never taken from the running service, `calculation_trace` or `rcs_input`.
4. **Nothing else changes.** `certify()`, `calculation_trace`, the shape of `qualificationContext`, the service, the Merkle seal hash input and the RCS collections' append-only writes are unchanged. Stored assessments are not backfilled. The V2E-0440 and V2E-0441 entries leave the conformance test's `RCSAssessment` known drift.

The nested context is kept and the top-level copies are added beside it, so this extends the 2026-10-24 record and item 7 of `2026-10-23-rcs-input-snapshot-write.md`, and reverses nothing.

## Not decided here

- **The `rcsRulePackages` collection and its writer.**
- **The validation evidence (RCSValidationStudy).**
- **A SemVer version for the running rules.**
- **Requiring a context on a registration that sends none.**
