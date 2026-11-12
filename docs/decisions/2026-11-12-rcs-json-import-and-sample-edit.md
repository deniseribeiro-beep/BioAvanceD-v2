# 2026-11-12: The JSON sample import and the sample edit store only a certified RCS result

Requirement RNF018 AC4, RF018 AC10. Issue #1537. Sequel to `2026-11-12-rcs-governance-evidence-imports.md` and `2026-11-12-rcs-governance-evidence-sample-registration.md`, which both left these two paths under "Not decided here".

## The question

RNF018 AC4 says the RCS result is set only by certification. The JSON sample import (`importService.importSamples`, a `.json` file on `POST /api/import/upload`) stored the file row's own `rcsEvaluation`, `rcsScore`, `finalGrade` and the rest, and recorded that as the RcsAssessment without certifying. The sample edit (`sampleService.updateSample`, `PUT /api/samples/{id}`) wrote a new `sprec` with no recertification, so the stored SPREC could diverge from the certified assessment. How does each path reach a certified result?

## Decided

`[inference]`, by the coordinator for #1537, on 2026-11-12.

1. **The JSON sample import certifies each row's SPREC through the same function as `createSample`** (`sample-certification.service.js`), resolving the row's `governanceEvidence` first (RNF018 AC5). The row's RCS result fields (the RNF018 AC4 list: biologicalPenalty, rcsScore, scoreBasedGrade, finalGrade, gradeRoute, axisPenalties, calculationTrace, rcsEvaluation, modelVersion, matrixType, governanceStatus, governanceFailureReasons, governanceRuleCodes, sealedRcsAssessmentId) and any `governanceEvidenceResolution` are dropped and never stored or recorded. A row with no SPREC carries no RCS result and records no RcsAssessment.
2. **The sample edit refuses a SPREC change with 422 `SPREC_WRITE_REFUSED` and never recertifies**; a body repeating the stored SPREC passes and writes nothing. This is an inference from RF018 AC10 ("tornar entradas congeladas e resultados não editáveis", in `docs/extracted-v2.0.0/requisitos.md`) and the repo's pattern of refusing an edit of certified or ledgered state rather than recomputing it: RNF018 AC4's `RCS_DERIVED_WRITE_REFUSED` on edit, RF006 AC4's refusal of a ledgered quantity after the first movement (#1531), and `parentSpecimenIds`, set at creation and not updatable (#1368). Recertifying would need the use context and evidence an edit does not carry.

## Not decided here

- **A re-assessment flow** that records a new RcsAssessment for a corrected SPREC (RF018 AC2 allows several per specimen).
- **The edit's `sealedSpecimenPreanalyticsId`**, still in the edit's allowlist.
- **The CSV/XLSX branch of the sample import**, which already certifies and presents no evidence.
