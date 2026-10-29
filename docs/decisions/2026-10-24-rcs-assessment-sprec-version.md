# 2026-10-24: an RCSAssessment records the SPREC version its result was computed with, taken from the result's own trace

Requirement RF018 AC1. Dictionary V2E-0448 (RCSAssessment.sprecVersion, string, 1..1, Core). Issue #1320. Sequel to `2026-10-24-rcs-rule-package-model.md`, whose "Not decided here" list named `sprecVersion` on the assessment (V2E-0448), as `2026-10-23-rcs-rule-package-and-scope.md` did before it.

## The question

The catalog row is `V2E-0448 | RCSAssessment | sprecVersion | string | 1..1 | Core`, "Versão SPREC usada", example `2.0`. `RcsAssessmentModel.fieldsOf` did not emit it, and the conformance test carried it as known drift. The RCSInputSnapshot already records it: `rcs-assessment.service.js` writes `sprecVersion: certificationResult.calculation_trace?.sprec_version ?? null` onto the snapshot. Where does the assessment's value come from, when is it null, and in what form is it stored, without changing a score, grade, route, penalty, `certify()` or `calculation_trace`?

## Decided

`[inference]`, from the dictionary row, the input snapshot's own source for this field and the repo's pattern (a value named only on positive evidence, else null), by the coordinator for #1320, on 2026-10-24:

1. **The source is `calculation_trace.sprec_version`.** `RcsAssessmentModel.fromCertificationResult` maps the result's `calculation_trace?.sprec_version` onto `sprecVersion`, as a result-derived key that overrides any `refs.sprecVersion`. It is the input snapshot's own source, so for every assessment that has a snapshot, `assessment.sprecVersion === snapshot.sprecVersion`. The service passes nothing new.
2. **It is not gated on reproduction.** `rulePackageVersion` and `rulePackageChecksum` are kept only when the running package reproduces the stored result, because reproduction is what shows a release's tables gave that result. The trace is `certify()`'s own record of the SPREC version it ran with, so it is positive evidence already, and a result that is not reproduced, or has no `rcs_input`, still carries the version its trace names.
3. **Never taken from the running service; null when the trace has none.** The value is never filled from the running service's `data.sprec_version`, which would give a stale result a version it was not computed with. A result with no `calculation_trace`, or a trace with no `sprec_version`, carries `null`, as `2026-10-23-rcs-rule-package-and-scope.md` item 3 and `2026-10-23-rcs-sprec-mapping-release.md` name a value only on positive evidence. A present value passes through `?? null` unchanged, exactly as the snapshot stores it, with no type check that would make the two disagree.
4. **The value is kept as the seed names it.** `certify()` writes `SPREC-2.0` from the running seed, and the assessment stores `SPREC-2.0`, not normalised to the dictionary example's `2.0`, as `rulePackageVersion` keeps the model code `RCS-GOV-1.0` as the seed names it.
5. **Nothing else changes.** `certify()`, `calculation_trace`, the Merkle seal hash (`rcsFieldsFromAssessment` reads only `rcsScore`, `finalGrade`, `calculationTrace` and `axisPenalties`) and the RCS collections' append-only writes are unchanged. The V2E-0448 entry leaves the conformance test's `RCSAssessment` known drift.

## Not decided here

- **The `rcsRulePackages` collection and its writer**: which flow creates a package, and the `collections.js` and `env.js` keys it uses.
- **The validation evidence** that `validationEvidenceIds` references (RCSValidationStudy, REL-0089).
- **A SemVer version for the running rules**, which `rulePackage()` would carry as `semanticVersion`.
- **A UI notice of the AC11 statement** where the intake wizard shows the RCS.
