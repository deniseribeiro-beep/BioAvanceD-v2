# 2026-10-27: RCSValidationStudy is modelled as a frozen structure written by no flow, with an open status code and a parsed protocol URI

Requirement RF018. Dictionary V2E-0361..0368 (RCSValidationStudy), REL-0089. Issue #1320. Sequel to `2026-10-24-rcs-rule-package-model.md`, whose "Not decided here" list named the validation evidence that RCSRulePackage's `validationEvidenceIds` (V2E-0360) references.

## The question

The catalog defines RCSValidationStudy with eight Core fields: `rcsValidationStudyId` (V2E-0361), `contextOfUse` (V2E-0362), `rulePackageId` (V2E-0363, Reference(RCSRulePackage)), `expertPanelDefinition` (V2E-0364), `outcomes` (V2E-0365, 1..*), `metrics` (V2E-0366, 1..*), `protocolUri` (V2E-0367, uri) and `status` (V2E-0368, code, cell `planned`, example `planned`). RCSRulePackage's `validationEvidenceIds` references it (REL-0089), but nothing under `api/backend/src/models/` modelled it. What does the backend build first, and in what shape, without changing a score, grade, route, penalty, `certify()`, `calculation_trace`, the RCS rule package service or the Foundation `rcs` gate?

## Decided

`[inference]`, from the dictionary rows, the migration note on V2E-0361..0368 in `docs/extracted-v2.0.0/dict-MIGRACAO_V1_3_PARA_V2.md` ("Create structure in Phase 1; populate only in the stated phase. No operational data are created by bootstrap.") and the RCSRulePackage precedent, by the coordinator for #1320, on 2026-10-27:

1. **The model comes first, written by no flow.** `api/backend/src/models/RcsValidationStudy.js` is a plain model with a pure `fieldsOf` emitting exactly the eight catalog fields, a `validate` and a `create` that returns the document deep-frozen, registered in `canonical-catalog-conformance.arch.test.js` with zero drift. No collection is registered in `collections.js` or `env.js` and no flow writes it. The precedent is `2026-10-24-rcs-rule-package-model.md` item 1. The id is required non-empty but not UUID-checked, as `rcsRulePackageId` is not: the dictionary's example is `rcs-validation-synthetic-001`.
2. **`status` is an open code.** V2E-0368's cell and its example both read `planned` and name no set, so `status` is only required non-empty, as the open codes of `2026-10-22-inactive-analytical-preparation-structures.md` item 3 are.
3. **`protocolUri` must parse as a URI.** V2E-0367's type is uri, so the value must be a non-empty string that `new URL()` parses. The dictionary's example `object://synthetic/rcs-validation.pdf` parses.
4. **No study record is created.** The CMPB manuscript (`docs/research/cmpb-submission/manuscript/00_Manuscript.tex`, "Limitations and future directions" and the last paragraph of the Conclusions) names external validation, comparing RCS outputs with expert review, as future work. No real study exists to record, so no bootstrap, seed or reference-data load writes one.

## Not decided here

- **The `rcsValidationStudies` collection and its writer**: which flow creates a study, and the `collections.js` and `env.js` keys it uses.
- **A study record**: its expert panel, protocol URI, outcomes and metrics come from a real external validation study.
- **A SemVer version for the running rules** (`RCS-GOV-1.0`), and therefore the first written RCSRulePackage, whose `validationEvidenceIds` would reference a study.
