# 2026-11-12: RCS semanticCompatible reads true on resolved axes and custody events, and the governance gate can pass

Requirement RNF018 AC5, RF018 AC7. Dictionary V2E-0531 (semanticCompatible). Issue #1524. Sequel to `2026-11-10-rcs-governance-evidence-refs.md`.

## The question

Since 2026-11-10, `traceabilityOk`, `monitoringOk` and `documentationOk` read `true` from resolved evidence references, but `semanticCompatible` (V2E-0531, "Compatibilidade entre matriz, códigos, eventos e contexto") could only be `false` or `null`, so `evaluateGovernanceEvidence` never returned `gateResult: 'pass'` and certification could not read all six criteria as RNF018 AC5 asks. When does `semanticCompatible` read `true`, and when does the gate pass?

## Decided

`[inference]`, from the dictionary row and the repo's pattern, by the coordinator for #1524. V2E-0531 names the matrix, the codes, the events and the context. The matrix, the codes and the context are what the gate and the axis resolution already check; the only events the calculation reads are the custody events resolved under traceability, the event kind V2E-0532's own example names (`custody-event-001`). The pattern read off is `2026-10-23-rcs-governance-evidence.md` item 2 (true only where checked, false where failed, null otherwise) and `2026-11-09-rcs-governance-evidence-readers.md` item 4 (true only on presented, resolved references).

1. **False exactly as before.** `semanticCompatible` is `false` where the gate trace holds MATRIX_INCOMPATIBLE_CODE or SEMANTIC_INCOMPATIBILITY, or certify's codes hold the workflow-context mismatch.
2. **True only on four conditions.** Otherwise it is `true` only when all of these hold: `metadataComplete` is true; `terminologyValid` is true (every code was checked against its matrix catalog); `traceabilityOk` is true (every presented custody-event reference resolved); and `evaluateAxisResults` gives at least one axis and every axis is `resolved` (code in its matrix catalog, a scored severity, the workflow context matched).
3. **Null otherwise, with its reason.** Any other input leaves it `null`, with the reason that the matrix, codes and context of every axis did not resolve or no custody event resolved. A failed traceability leaves it `null`, never `false`: the custody failure is traceability's own.
4. **The gate.** `gateResult` is `pass` when all six criteria are `true`, `fail` when any is `false`, else `null` with its reason in `unresolvedReasons`. A passed gate has empty `failureReasons` and no `unresolvedReasons`; `RcsGovernanceEvidenceSnapshot.capture` already accepts it.
5. **Nothing else changes.** `certify`, its `calculation_trace` and `governanceRuleSet()` are unchanged, so every score, grade, route and the rule-set checksum the Foundation readiness gate reads stay the same.
6. **`routeReasons` still says "no governance failure found".** It reads a certify result, which carries no evidence, so it cannot say the gate passed.

## Not decided here

- **The persisted certification paths** (sample create and edit, register-sample, the intake wizard, the imports and the `rcs-assessment.service.js` callers) do not resolve evidence; only the preview does, so only the preview can read a `pass`.
- **SOP (Protocol) references**, which need a stored checksum of the document.
- **Whether absent evidence should refuse certification.**
- **A rule-package version for the evidence rule** (2026-11-09 item 6).
