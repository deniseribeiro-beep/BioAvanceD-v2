# 2026-11-09: RCS certification reads traceability, monitoring and documentation evidence references, and refuses one that does not resolve

Requirement RNF018 AC5, RF018 AC7. Dictionary V2E-0528 (traceabilityOk), V2E-0529 (monitoringOk), V2E-0530 (documentationOk), V2E-0532 (evidenceRefs). Issue #1524. Sequel to `2026-10-23-rcs-governance-evidence.md`.

## The question

RNF018 AC5 asks that certification refuse evidence with a missing artefact hash or an unresolvable URI. `rcs-certification.service.js` read no traceability, monitoring or documentation evidence: `traceabilityOk`, `monitoringOk` and `documentationOk` were always `null` (or `false` from a client boolean), and nothing checked a hash or a URI. What does a request present, how is it checked against the stored records, and how is the check kept inside the recalculation contract (`certify(readInput(p))` is `certify(p)`) without letting a client pass a criterion?

## Decided

`[inference]`, from the specification and the repo's pattern, by the coordinator for #1524, on 2026-11-09. The pattern read off is `2026-10-23-rcs-governance-evidence.md` item 2 ("true only where the gate checked, false where it failed, null otherwise; never true from a client-sent boolean") and the recalculation contract of `2026-10-23-rcs-input-snapshot-write.md` item 1.

1. **The reference shape and its URI kinds.** `POST /api/quality/preview` takes an optional `governanceEvidence` object with optional arrays `traceability`, `monitoring` and `documentation` of `{ uri, hash }`, and an optional `specimenId`. `hash` is `sha256:` plus 64 lower-case hex. `uri` is `urn:bioavanced:<kind>:<id>`, one kind per category, each looked up by exact id:
   - traceability, `custody-event`: a `CUSTODY_EVENT_RECORDED` outbox event of aggregate type `Sample` whose `aggregateId` is the Mongo `_id` of the sample with `specimenId`; its stored hash is `sha256:` plus the event's `payloadHash`.
   - monitoring, `telemetry-exposure-summary`: a TelemetryExposureSummary of that `specimenId`; its stored hash is `sourceReadingSetHash`.
   - documentation, `collection-governance-approval`: a CollectionGovernanceApproval by `approvalId`; its stored hash is `documentChecksum`, read as `sha256:` plus lower-case hex whether stored bare or prefixed.
   A Protocol (SOP) is not a kind: it stores no checksum of its document, so a reference to one cannot be verified.
2. **Four statuses, checked in order, and a cap.** A reference that is not an object is `unresolvable_uri`; a hash that is absent or not of the form above is `missing_hash`; a URI of another form or kind, a record not found, or a specimen-bound record of another specimen (or with no `specimenId`) is `unresolvable_uri`; a stored hash that differs is `hash_mismatch`; else `resolved`. A category value that is not an array, or an array of more than 20 references, fails closed as one `unresolvable_uri` entry with no lookup. An empty array is absent.
3. **Resolution happens before `certify`, frozen in the input, never client-sent.** `governance-evidence-resolver.service.js` resolves the references against the database and the route passes the result to `evaluateQuality` as an option, which sets `governanceEvidenceResolution` on the input `certify` reads. `governanceEvidenceResolution` is a `READ_KEYS` entry, so `readInput` freezes it and a recalculation from the snapshot reproduces the result without a database read; `certify` stays pure. `evaluateQuality` drops a `governanceEvidenceResolution` the client sent, at the top level or inside `sample`, so only the server's resolver can set it.
4. **A non-resolved reference fails its category; a resolved category is `true`.** In `evaluateGovernance`, after the client-boolean checks (which still fail a category, never pass one), a category with any non-resolved entry pushes its reason (`Insufficient traceability`, `Missing required monitoring`, `Insufficient documentation`) and a trace entry with its rule code and the failing references' `{ uri, status }`. A fully resolved category adds nothing to the trace, so `calculation_trace` is unchanged for every input without a resolution, and for one whose references all resolve. `evaluateGovernanceEvidence` reads a flag `false` when its rule code is in the trace, `true` when the category was presented and every reference resolved, else `null`.
5. **Absent evidence stays `null`.** Only presented references are checked. Refusing a certification for absent evidence would grade every current sample E, since no write path presents any yet; the `unresolvedReasons` texts now say none was presented.
6. **The governance rule-set checksum is left unchanged.** `governanceRuleSet()` is not extended with the evidence rule: its checksum is pinned by the unit tests and feeds the Foundation `rcs` readiness gate, and no existing input carries a resolution, so every existing result and checksum is unchanged. A rule-package version that names the evidence rule is a follow-up.

## Not decided here

- **The persisted certification paths** (sample create, register-sample, the intake wizard, the imports and `rcs-assessment.service.js`) do not resolve evidence yet; only the preview does.
- **`semanticCompatible`** (V2E-0531), which reads no events, and so a `pass` gate result.
- **`evidenceRefs`** (V2E-0532), which `RcsGovernanceEvidenceSnapshotModel.capture` still writes empty.
- **SOP (Protocol) references**, which need a stored checksum of the document.
- **Whether absent evidence should refuse certification.**
- **A rule-package version for the evidence rule** (item 6).
