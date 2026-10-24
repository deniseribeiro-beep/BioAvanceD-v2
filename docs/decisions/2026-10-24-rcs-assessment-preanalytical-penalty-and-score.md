# 2026-10-24: an RCSAssessment records its result's own P_bio as preanalyticalPenalty and its 100 - P_bio score as score

Requirement RF018. Dictionary V2E-0539 (RCSAssessment.preanalyticalPenalty, decimal, 0..1, Conditional) and V2E-0540 (RCSAssessment.score, decimal, 0..1, Conditional). Issue #1320. Sequel to `2026-10-24-rcs-assessment-sprec-version.md`, whose form it follows.

## The question

The catalog rows are `V2E-0539 | RCSAssessment | preanalyticalPenalty | decimal | 0..1 | Conditional` and `V2E-0540 | RCSAssessment | score | decimal | 0..1 | Conditional`, both "Obrigatório quando o gate permite pontuação", vocabulary `0..100`; V2E-0540 is "RCS calculado como 100 menos P_bio", added in v2.0.0. `RcsAssessmentModel.fieldsOf` emitted neither, and the conformance test carried both as known drift. `certify()` already writes `p_bio` and `rcs_score` on the score route, and `null` for both on a governance failure; the assessment already stores `rcs_score` as `rcsScore` (ELM-0159). Where do the two values come from, when are they null, and how does `score` stand beside `rcsScore`, without changing a score, grade, route, penalty, `certify()` or `calculation_trace`?

## Decided

`[inference]`, from the dictionary rows, the result `certify()` writes and the repo's pattern (a value named only on positive evidence from the result, else null; a pre-existing field kept beside a new canonical one, as `finalGrade` stands beside the absent `rcsGrade`), by the coordinator for #1320, on 2026-10-24:

1. **The source is the result's `p_bio` and `rcs_score`.** `RcsAssessmentModel.fromCertificationResult` maps `result.p_bio` onto `preanalyticalPenalty` and `result.rcs_score` onto `score`, as result-derived keys that override any `refs.preanalyticalPenalty` or `refs.score`. The service passes nothing new.
2. **Null on a governance failure or absence, never computed.** A governance-failure result carries `p_bio: null` and `rcs_score: null`, so both fields are null, as the rows' "when the gate allows scoring" condition reads. A result with no `p_bio` or `rcs_score` key carries null. Neither value is ever computed from `axis_penalties`, `calculation_trace` or `100 - x`, nor taken from the running service. A present value passes through `?? null` unchanged, with no type check or rounding, so a penalty of 0 stays 0.
3. **Not gated on reproduction.** `rulePackageVersion` and `rulePackageChecksum` are kept only when the running package reproduces the stored result. `p_bio` and `rcs_score` are `certify()`'s own output, the same the assessment already stores as `rcsScore`, so a result that is not reproduced, or has no `rcs_input`, still carries its own values.
4. **`score` duplicates `rcsScore`, and both are kept.** By the dictionary's own rows, `score` (V2E-0540) is the same value as the maintained `rcsScore` (ELM-0159): both read `result.rcs_score`, so `assessment.score === assessment.rcsScore` for every result. `rcsScore` is neither renamed nor removed.
5. **Nothing else changes.** `certify()`, `calculation_trace`, the Merkle seal hash (`rcsFieldsFromAssessment` reads only `rcsScore`, `finalGrade`, `calculationTrace` and `axisPenalties`) and the RCS collections' append-only writes are unchanged; stored assessments are not backfilled. The V2E-0539 and V2E-0540 entries leave the conformance test's `RCSAssessment` known drift; `biologicalPenalty` (P1X-0064) stays there as absent.

## Not decided here

- **`biologicalPenalty` (P1X-0064)** and whether it names the same value as `preanalyticalPenalty`.
- **Retiring `rcsScore`** in favour of `score`, which would change the Merkle seal hash's input.
