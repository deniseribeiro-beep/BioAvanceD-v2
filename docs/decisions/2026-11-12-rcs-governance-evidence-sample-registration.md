# 2026-11-12: Sample registration resolves its governance evidence references before certification

Requirement RNF018 AC5, RF018 AC7. Issue #1524. Sequel to `2026-11-12-rcs-semantic-compatible.md`.

## The question

RNF018 AC5 asks certification to refuse evidence with a missing artefact hash or an unresolvable URI. Until now only `POST /api/quality/preview` resolved a body's `governanceEvidence` references; the persisted paths certified a `sprec` without them, so a body's evidence was silently dropped and a bad reference never refused. Which persisted path resolves evidence first, and does absent evidence refuse certification?

## Decided

`[inference]`, by the coordinator for #1524, from the pattern of `2026-11-09-rcs-governance-evidence-readers.md` items 3-5 and `2026-10-23-rcs-governance-evidence.md` item 2 (true only where checked, false where failed, null otherwise).

1. **The sample create resolves first.** `POST /api/samples` and `POST /api/users/register-sample`, both through `sampleService.createSample`, resolve the body's `governanceEvidence` with the preview's resolver (`governance-evidence-resolver.service.js`) before certifying, and pass only the server's resolution to `resolveMethodologicalQuality`. A `governanceEvidenceResolution` the body sends is never read.
2. **A custody-event reference cannot resolve at registration.** The sample is stored after its certification, so the resolver finds no sample for the `specimenId` and the reference reads `unresolvable_uri`: it fails traceability (fail closed). Monitoring and documentation references resolve as in the preview.
3. **Absent evidence does not refuse certification.** It stays `null`, as 2026-11-09 item 5 decided, since refusing it would grade every sample E while no client presents evidence. This is an inference from that item and the consistent null-when-unchecked pattern, not an owner question.
4. **Nothing else changes.** `certify`, `governanceRuleSet()` and its checksum are unchanged.

## Not decided here

- **The intake wizard, the imports (CSV/XLSX, LGPD, FHIR staging) and the batch validation engine**, which certify through their own payloads.
- **The sample edit**, which does not re-certify at all (`updateSample` stores a new `sprec` without recomputing the RCS).
- **SOP (Protocol) references.**
- **A rule-package version for the evidence rule.**
