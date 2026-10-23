# 2026-10-23: live registration carries its use context to the RCS assessment, and a sent context must name all five fields

Requirement RF018 AC2. Dictionary V2E-0439..0444 (qualificationContext and its five fields). Issue #1320. Extends item 7 of `2026-10-23-rcs-input-snapshot-write.md`.

## The question

RF018 AC2 asks that every RCSAssessment carry its use context (finalidade), analyte, assay family and protocol/version, and that the system require it ("exigir"). `evaluateQuality` already keeps a request's `qualificationContext`, but live `POST /api/samples` called `resolveMethodologicalQuality({ sprec })`, so a body's context never reached the assessment, and a partial context such as `{ targetAnalyte: 'DNA' }` was stored with four silent nulls and no signal to the caller. Does "exigir" refuse a registration that sends no context, or only one whose context is incomplete?

## Decided

`[inference]`, from the specification and the repo's pattern, by the coordinator for #1320, on 2026-10-23:

1. **"Exigir" applies to a context the request sends, not to its absence.** No client sends a context yet: the frontend has none, and neither do the CSV, LGPD and FHIR imports. Refusing an absent context would refuse every registration that works today. With none, `RCSAssessment.qualificationContext` stays null, as item 7 of the sibling record already decided.
2. **A sent context names all five fields, or the request gets 422, on every live registration route.** `qualificationContextErrors` gives `qualificationContext deve ser um objeto (RF018 AC2)` for a non-object `qualificationContext`, and `qualificationContext.<field> é obrigatório quando o contexto de uso é informado (RF018 AC2)` for each field `missingQualificationContextFields` names. `validateCreateSamplePayload` (`POST /api/samples`) adds these messages to its own, and `POST /api/users/register-sample`, which calls `createSample` without that validator, answers 422 with them before `createSample` runs. A `null` context counts as absent. Extra keys are not an error, since `readQualificationContext` already drops them.
3. **One rule reads a field as present.** `missingQualificationContextFields` and `readQualificationContext` share one predicate, a non-empty trimmed string or a plain object, so a field the validator accepts is never stored as null.
4. **Live registration passes the body's context on, and only when it is sent.** `createSample` calls `resolveMethodologicalQuality` with `qualificationContext` beside `sprec` only when the body carries the key; without one the call is `{ sprec }` as before. `certify` and `readInput` do not read the key, so no score, grade, penalty, route, `rcs_input` or `calculation_trace` changes, and `SampleModel.create` builds an explicit object, so the context lands on the evaluation and the assessment, never on the Sample.

The pattern this is read off: a 1..1 with no source is null and never fabricated (slice 1's item 4 in `2026-10-22-rcs-input-snapshot-structures.md`, RULE-011; item 7 of the sibling record), while an input that is silently dropped or nulled is the defect, and the validator rejects it with 422 (the non-canonical alias guard of #533 and #785 in `sample.routes.js`).

## Not decided here

- **Requiring a context at all**, on a registration that sends none.
- **The intake wizard and the CSV, LGPD and FHIR imports**, none of which sends a context yet.
- **The `/api/quality/preview` route**, which this slice does not validate.
