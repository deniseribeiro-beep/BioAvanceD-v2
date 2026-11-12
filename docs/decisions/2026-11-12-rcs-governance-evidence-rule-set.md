# 2026-11-12: the RCS governance rule-set checksum covers the governance evidence rule

Requirement RNF018 AC5, RF018 AC7. Issue #1524. Sequel to `2026-11-09-rcs-governance-evidence-readers.md` (its item 6).

## The question

Since 2026-11-09, certification fails a category whose evidence reference has a missing hash, an unresolvable URI or a wrong hash, but `governanceRuleSet()` (the version and checksum of the rules the gate applies, RF018 AC7) did not include that rule. Its checksum, and the rule-package checksum built on it, did not identify the rules a certification ran. How does the rule set name the evidence rule?

## Decided

`[inference]`, by the coordinator for #1524, from `governanceRuleSet()`'s own contract (the seeded rules, the catalogs and the code constants the gate reads) and `2026-10-23-rcs-rule-package-and-scope.md` item 1 (the package checksum changes whenever any rule certify reads changes).

1. **The rule set gains `evidence_rule`.** Its six keys: `categories` (the per-category reason, rule code and flag `evaluateGovernance` reads), `kinds` (the one URI kind each category accepts), `hash_pattern` and `uri_pattern` (the hash and URI forms, as regex sources), `statuses` (the resolution statuses) and `max_references_per_category` (the cap).
2. **The constants move to `api/backend/src/services/governance-evidence-rule.js`**, a module that requires nothing, so the certification service (which models load) reads them without loading the resolver's database helpers and outbox service. The resolver takes them from there; its exports are unchanged, so no caller changes.
3. **The version stays the model code** (`RCS-GOV-1.0`): a SemVer for the running rules waits for a validation study (`2026-10-27-rcs-validation-study-model.md`).
4. **The checksums move.** The rule-set checksum moves from `sha256:0aa3cb01...` to `sha256:e4d8bfe3...`, and the rule-package checksum with it. Assessments and evidence snapshots already written keep the checksum they were written with, and the Foundation `rcs` gate reads both sides live.

## Not decided here

- **A SemVer version** for the governance rule set.
- **SOP (Protocol) references**, which need a stored checksum of the document.
