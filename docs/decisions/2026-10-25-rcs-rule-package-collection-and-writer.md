# 2026-10-25: RCSRulePackage is stored in rcsRulePackages and written by the Phase 2 essential-reference load, only when it validates, once per checksum

Requirement RF018 AC10, CFG-006. Dictionary V2E-0354..0360 (RCSRulePackage). Issue #1320. Sequel to `2026-10-24-rcs-rule-package-model.md`, whose "Not decided here" list named the `rcsRulePackages` collection and its writer.

## The question

`api/backend/src/models/RcsRulePackage.js` models the package and freezes it, but no collection holds it and no flow writes it. Which collection stores it, which flow writes it, and what is written while the running rules do not give a valid package, without changing `certify()`, `rulePackage()`, `calculation_trace`, the Merkle seal, any score, grade, route or penalty, the RCSAssessment fields or the Foundation `rcs` gate?

## Decided

`[inference]`, from `docs/extracted-v2.0.0/plano.md` §7 (row "RCS package/SPREC mapping": Phase 1 prepares the schema and baseline, Phase 2 populates approved releases, Phase 3 references it from the assessment) and the phase split in `api/backend/src/foundation/essential-references.js`, by the coordinator for #1320, on 2026-10-25:

1. **The collection is `rcsRulePackages`.** `collections.js` reads it as `rcsRulePackages` from `env.js`'s `COLL_RCS_RULE_PACKAGES`, default `rcsRulePackages`.
2. **The writer is the Phase 2 essential-reference load.** `scripts/load-essential-references.js` records the package after the `rcs-gov-1.0` release is active, through `api/backend/src/services/rcs-rule-package.service.js`. The Foundation job never writes it, since it writes no reference data (RF022 AC7), and the assessment write never writes it, since an assessment only references the package (plano §7). A dry run, or a selection without `rcs-gov-1.0`, records nothing.
3. **A package is written only when `RcsRulePackageModel` validates it**, keyed by `checksum` with `$setOnInsert`. The same rules re-loaded write no second package and answer the first one's id, and nothing edits or deletes a stored package.
4. **`status` is `active`, taken from the active `rcs-gov-1.0` release**, the only positive evidence the load has that the package's rules are the approved running release. With that release absent or not active, no package is written and the load reports `rcs-gov-1.0 release not active`.
5. **Today no package is written.** The running rules name the model code `RCS-GOV-1.0`, not a SemVer, and no RCSValidationStudy exists, so the model refuses the package with exactly the `semanticVersion` and `validationEvidenceIds` errors. The load reports them as `rulePackage` in its output, and its exit code is unchanged: an unwritten package does not fail the load. No SemVer and no evidence id is fabricated to make it validate.

## Not decided here

- **A SemVer version for the running rules**, which the package would carry as `semanticVersion`.
- **RCSValidationStudy (V2E-0361..0368) and its writer**, the evidence `validationEvidenceIds` references.
- **Linking an RCSAssessment to the package by id**, and the `rulePackageId` on RCSValidationStudy (REL-0089).
- **An immutability architecture test over `rcsRulePackages`.**
