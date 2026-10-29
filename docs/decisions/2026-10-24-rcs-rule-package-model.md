# 2026-10-24: RCSRulePackage is modelled as a frozen structure written by no flow, with a SemVer version and a SHA-256 checksum

Requirement RF018 AC10, CFG-006. Dictionary V2E-0354..0360 (RCSRulePackage). Issue #1320. Sequel to `2026-10-23-rcs-rule-package-and-scope.md`, whose "Not decided here" list named an RCSRulePackage model or collection: its id, status and validation evidence.

## The question

The catalog defines RCSRulePackage with seven Core fields: `rcsRulePackageId` (V2E-0354), `semanticVersion` (V2E-0355, SemVer), `sprecMappingReleaseId` (V2E-0356), `checksum` (V2E-0357, SHA-256), `governanceGateVersion` (V2E-0358, internal vocabulary), `status` (V2E-0359, cell `draft`, example `active`) and `validationEvidenceIds` (V2E-0360, 1..*). Nothing under `api/backend/src/models/` modelled it; the package existed only as the `{ version, checksum }` that `rcs-certification.service.js#rulePackage()` returns. What does the backend build first, and in what shape, without changing a score, grade, route, penalty, `certify()` or `calculation_trace`?

## Decided

`[inference]`, from the dictionary rows, the specification and the repo's pattern, by the coordinator for #1320, on 2026-10-24:

1. **The model comes first, written by no flow.** `api/backend/src/models/RcsRulePackage.js` is a plain model with a pure `fieldsOf` emitting exactly the seven catalog fields, a `validate` and a `create` that returns the document deep-frozen, registered in `canonical-catalog-conformance.arch.test.js` with zero drift. No collection is registered in `collections.js` or `env.js` and no flow writes it. The precedent is `2026-10-22-rcs-input-snapshot-structures.md` item 1 and `2026-10-22-inactive-analytical-preparation-structures.md` items 1 and 5.
2. **The status set is the release lifecycle.** `status` is `draft|candidate|approved|active|superseded|retired`. V2E-0359's cell reads `draft` and its example `active`; the set is the one `ConfigurationRelease.js` and `InteroperabilityMappingRelease.js` use, extending a vocabulary cell to the set it names as in `2026-10-22-inactive-analytical-preparation-structures.md` item 3.
3. **`semanticVersion` is SemVer-checked; `governanceGateVersion` is not.** V2E-0355's vocabulary is SemVer, so `semanticVersion` must be `MAJOR.MINOR.PATCH`. V2E-0358's vocabulary is internal, and the running gate's version is the model code `RCS-GOV-1.0`, so `governanceGateVersion` is only required non-empty.
4. **`checksum` is a SHA-256 digest.** It must be 64 hex characters, optionally prefixed `sha256:`, as the RCS models and `rulePackage()` write digests. The dictionary's example `sha256:synthetic-rcs` is not a digest and does not validate.
5. **The link to `rulePackage()`.** The checksum `rulePackage()` computes is the value a package's `checksum` would carry. Its version is the model code `RCS-GOV-1.0`, not a SemVer, so no package built from the running rules validates until the rules name a SemVer version. `rulePackage()`, the assessment's `rulePackageVersion` and `rulePackageChecksum`, and the Foundation `rcs` readiness gate are unchanged, and none of them uses the model.

## Not decided here

- **The `rcsRulePackages` collection and its writer**: which flow creates a package, and the `collections.js` and `env.js` keys it uses.
- **The validation evidence** that `validationEvidenceIds` references (RCSValidationStudy, REL-0089).
- **A SemVer version for the running rules**, which `rulePackage()` would carry as `semanticVersion`.
- **A UI notice of the AC11 statement** where the intake wizard shows the RCS.
- **`sprecVersion` on the assessment** (V2E-0448).
