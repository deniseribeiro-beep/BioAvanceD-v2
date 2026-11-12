# 2026-11-12: The intake wizard resolves its governance evidence references before certification

Requirement RNF018 AC5, RF018 AC7. Issue #1524. Sequel to `2026-11-12-rcs-governance-evidence-sample-registration.md`.

## The question

RNF018 AC5 asks certification to refuse evidence with a missing artefact hash or an unresolvable URI. `POST /api/quality/preview` and `sampleService.createSample` resolve a body's `governanceEvidence` references; the intake wizard certified `specimen` with none, and its canonical contract (`canonical.v1.intake`) refused a `governanceEvidence` key outright. Does the intake wizard resolve evidence, where does the intake body carry it, and which specimenId does it resolve against?

## Decided

`[inference]`, by the coordinator for #1524, from the pattern of `2026-11-12-rcs-governance-evidence-sample-registration.md` items 1-3 and `2026-11-09-rcs-governance-evidence-readers.md` item 5.

1. **The intake resolves a top-level `governanceEvidence`.** `POST /api/intake-wizard` (and its alias) resolves the body's `governanceEvidence` with the preview's resolver (`governance-evidence-resolver.service.js`) before certifying the specimen, and passes only the server's resolution to `resolveMethodologicalQuality`. A `governanceEvidenceResolution` the body sends is refused as a non-canonical field. The key sits at the top level, not inside `specimen`, so the shared `canonical.v1.specimen` contract is unchanged.
2. **It resolves with no specimenId.** The specimen does not exist yet, and the body's `specimen.specimenId` is a client value the intake never stores, so a custody-event or telemetry reference reads `unresolvable_uri` and fails closed. Passing the body's value would let a custody reference of an existing sample resolve for a new one.
3. **A reference that fails refuses certification, and the specimen is stored quarantined.** The intake's existing release rule stores it with `QUALITY_GOVERNANCE_FAILURE`. The same references go to `createSample`, whose certification of the sprec reads the same result, so both recorded RcsAssessments agree.
4. **Absent evidence stays `null`**, as the sample-registration record decided; the certification stays one-argument. `certify`, `governanceRuleSet()` and its checksum are unchanged.

## Not decided here

- **The imports (CSV/XLSX, LGPD, FHIR staging) and the batch validation engine**, which certify through their own payloads.
- **The sample edit**, which does not re-certify at all (`updateSample` stores a new `sprec` without recomputing the RCS).
- **The frontend wizard sending evidence.**
- **SOP (Protocol) references.**
- **A rule-package version for the evidence rule.**
