# 2026-10-24: an RCSAssessment records its context's assay family and workflow protocol top-level, beside the nested qualificationContext

Requirement RF018 AC2. Dictionary V2E-0442 (RCSAssessment.assayFamily, CodeableConcept, 1..1, Core), V2E-0443 (RCSAssessment.workflowProtocolId, Reference(Protocol), 1..1, Core) and V2E-0444 (RCSAssessment.workflowProtocolVersion, string, 1..1, Core). Issue #1320. Extends item 7 of `2026-10-23-rcs-input-snapshot-write.md` and follows `2026-10-23-rcs-use-context-required.md`.

## The question

The catalog names each of V2E-0439..0444 as its own RCSAssessment row: `qualificationContext` and the five fields it holds. `RcsAssessmentModel.fieldsOf` emitted only `qualificationContext`, so `assayFamily`, `workflowProtocolId` and `workflowProtocolVersion` were held only nested under it, and the conformance test carried all three as known drift. Where do the top-level fields come from, when are they null, and what happens to the nested context, without changing a score, grade, route, `certify()` or `calculation_trace`?

## Decided

`[inference]`, from the catalog rows and the repo's pattern (the 2026-10-24 records for `sprecVersion` and for `preanalyticalPenalty` and `score` emit a catalog field from the result's own record on positive evidence, else null, and keep the pre-existing field beside it: `score` beside `rcsScore`, `assessment.sprecVersion === snapshot.sprecVersion`), by the coordinator for #1320, on 2026-10-24:

1. **The source is the result's own `qualification_context`.** `RcsAssessmentModel.fromCertificationResult` maps `qualification_context?.assayFamily`, `?.workflowProtocolId` and `?.workflowProtocolVersion` onto the three top-level fields, as result-derived keys placed after the spread `refs`, so a `refs.assayFamily` never wins, as `sprecVersion` does. `fieldsOf` emits each as `data.<field> ?? null`. The service passes nothing new.
2. **The value passes through unchanged.** A string or a plain object, the same reference the nested context holds, with no type check, trim or normalisation, so `assessment.assayFamily === (assessment.qualificationContext?.assayFamily ?? null)` for every result, and likewise for the other two. `readQualificationContext` in `quality-domain.service.js` already keeps each field as a non-empty trimmed string or a plain object, else null.
3. **Null without positive evidence; never computed or defaulted.** A result with no `qualification_context`, a null one, or one whose field is null gives null. The value is never taken from the running service, `calculation_trace` or `rcs_input`.
4. **Nothing else changes.** `certify()`, `calculation_trace`, the shape of `qualificationContext`, the service, the Merkle seal hash input and the RCS collections' append-only writes are unchanged. Stored assessments are not backfilled. The V2E-0442, V2E-0443 and V2E-0444 entries leave the conformance test's `RCSAssessment` known drift.

Item 7 of `2026-10-23-rcs-input-snapshot-write.md` (the five fields "held nested, as the v2.0.0 synthetic example nests them") still holds: the nested context is kept and the top-level copies are added beside it, so this extends item 7 and reverses nothing.

## Not decided here

- **V2E-0440 `intendedUseCode` and V2E-0441 `targetAnalyte` top-level**: they stay nested only, and in the conformance test's known drift.
- **Requiring a context on a registration that sends none.**
- **The intake wizard and the CSV, LGPD and FHIR imports**, which send no context.
