# 2026-11-12: SOP documentation evidence is the specimen's collection's governance approval

Requirement RNF018 AC5, RF018 AC7. Dictionary V2E-0530 (documentationOk). Issue #1524. Sequel to `2026-11-09-rcs-governance-evidence-readers.md`.

## The question

`2026-11-09-rcs-governance-evidence-readers.md` item 1 left a Protocol (SOP) out of the URI kinds, because the approved dictionary gives Protocol no document checksum, and `2026-11-12-rcs-governance-evidence-rule-set.md` left SOP references undecided. Should Protocol gain a checksum, or does SOP documentation evidence come from elsewhere? And a documentation reference (`urn:bioavanced:collection-governance-approval:<approvalId>`) resolved against any approval by id, whatever collection it belonged to: which approval counts as the specimen's documentation?

## Decided

1. **Owner ruling, 2026-11-12, on issue #1524:** Protocol keeps the approved dictionary's fields (ELM-0068..0075: protocolType, protocolVersion, effectivePeriod, documentUri, approvalStatus, intendedUse) and gains no document checksum; documentation evidence for SOPs is accepted through CollectionGovernanceApproval alone (its `documentChecksum`, V2E-0072). A Protocol stays not a URI kind.
2. **The approval must be the specimen's collection's** (`[inference]`, by the coordinator for #1524, from the ruling's "the collection's governance approval" and the resolver's pattern that a custody event or telemetry summary must belong to the specimen named): a `collection-governance-approval` reference resolves only when the stored approval's `collectionId` equals the collectionId the caller passes; one of another collection, or a call with no collectionId, reads `unresolvable_uri` and fails documentation (`Insufficient documentation`, grade E). The collectionId comes from `sampleData.collectionId` at sample create and the imports (already gated by the collection gate), `specimen.collectionId` at intake, and the body's `collectionId` at the quality preview.
3. **The rule set names it:** `api/backend/src/services/governance-evidence-rule.js` gains `EVIDENCE_SCOPES` (traceability and monitoring `specimen`, documentation `collection`) and `governanceRuleSet()`'s `evidence_rule` gains `scopes`, so the rule-set checksum moves from `sha256:e4d8bfe3...` to `sha256:9c534192...` and the rule-package checksum with it; the version stays `RCS-GOV-1.0`.
4. **Absent evidence still stays null**, as `2026-11-09-rcs-governance-evidence-readers.md` item 5 decided; the ruling does not change it.

## Not decided here

- **A SemVer rule-package version**: waits on #1320's validation study (`2026-10-27-rcs-validation-study-model.md`).
- **Whether the approval must also be in force** (its status and period) to count as evidence.
