# 2026-11-10: RCS governance evidence keeps the URIs of the references that resolved in evidenceRefs

Requirement RNF018 AC5, RF018 AC7. Dictionary V2E-0532 (evidenceRefs). Issue #1524. Sequel to `2026-11-09-rcs-governance-evidence-readers.md`.

## The question

Since 2026-11-09, `POST /api/quality/preview` resolves `governanceEvidence` references into `governanceEvidenceResolution` on the frozen RCS input, and the three evidence criteria read it. The resolved references were still never recorded: `RcsGovernanceEvidenceSnapshotModel.capture` forced `evidenceRefs` (V2E-0532, "Referências resolvíveis usadas nas seis verificações", array<Reference>, 1..*) to `[]`. Which references does `evidenceRefs` hold, in what order, and how does it stay inside the recalculation contract?

## Decided

`[inference]`, from the dictionary row and the repo's pattern, by the coordinator for #1524, on 2026-11-10. The pattern read off is `2026-11-09-rcs-governance-evidence-readers.md` item 4 ("true when the category was presented and every reference resolved"): only a resolved reference counts as evidence, and V2E-0532 names "resolvable" references.

1. **Only resolved references.** `evaluateGovernanceEvidence` lists the `uri` of every resolution entry whose status is `resolved` and whose `uri` is a non-empty string. A `missing_hash`, `unresolvable_uri` or `hash_mismatch` reference is not resolvable, so it is never listed.
2. **Order and duplicates.** The categories are read in `EVIDENCE_CATEGORIES` key order (traceability, monitoring, documentation), each in its presented order; a repeated URI is kept once, at its first occurrence.
3. **From the frozen input only.** The list is computed from `governanceEvidenceResolution` on the input, so a recalculation from the snapshot reproduces it without a database read. `certify`, its trace and `governanceRuleSet()` are unchanged.
4. **Kept by capture, checked fail closed.** `capture` keeps the `evidenceRefs` it is given; absent is `[]`. A present value that is not an array of non-empty strings is refused. `validate` and `create` still require 1..*, so a captured document with no resolved reference still does not pass `validate()`.
5. **Effect today.** The preview response's `governance_evidence` carries `evidenceRefs`, and `recordAssessment` writes them into `rcsGovernanceEvidenceSnapshots`. No persisted path presents evidence yet, so every stored snapshot still gets `[]`.

## Not decided here

- **The persisted certification paths** (sample create, register-sample, the intake wizard, the imports and `rcs-assessment.service.js`) do not resolve evidence yet; only the preview does.
- **`semanticCompatible`** (V2E-0531), which reads no events, and so a `pass` gate result.
- **SOP (Protocol) references**, which need a stored checksum of the document.
- **Whether absent evidence should refuse certification.**
- **A rule-package version for the evidence rule** (2026-11-09 item 6).
