# 2026-10-22: the RCS v4 frozen inputs are modelled first, written by no flow, with no score change

Requirement RF018 AC3/AC5/AC6/AC7/AC10. Dictionary V2E-0497..0537 (RCSInputSnapshot V2E-0497..0512, RCSPreanalyticalAxisInput V2E-0513..0523, RCSGovernanceEvidenceSnapshot V2E-0524..0537). Issue #1320.

## The question

RF018 asks for exactly one immutable RCSInputSnapshot per RCS assessment (AC3), five matrix-specific axis inputs (AC5, AC6) and six individual governance criteria with their evidence and an aggregate result (AC7), all frozen once captured (AC10). Nothing in `api/backend/src` modelled any of the three, and the current assessment (`rcs-certification.service.js`, `RcsAssessment.js`) computes from inputs it does not keep. What does the backend build first, and in what shape, without changing a score?

## Decided

`[inference]`, from the specification and the repo's pattern, by the coordinator for #1320, on 2026-10-22:

1. **The models come first, written by no flow.** `RcsInputSnapshot.js`, `RcsPreanalyticalAxisInput.js` and `RcsGovernanceEvidenceSnapshot.js` are plain models under `api/backend/src/models/` with a pure `fieldsOf`, a `validate` and a `create` that returns the document deep-frozen, registered in `canonical-catalog-conformance.arch.test.js` with zero drift. No collection is registered and no flow writes them; the assessment write lands in a later #1320 slice, so no score, grade or route changes. The pattern is the inactive-structure precedent in `2026-10-22-inactive-analytical-preparation-structures.md` item 1.
2. **The axis codes take the canonical spelling.** `AXIS_CODES` is `P_pre, P_cent1, P_cent2, P_post, P_store` for fluid and `P_warm, P_cold, P_fix, P_fixTime, P_store` for solid, read from requisitos RF018 AC5, RULE-019, RULE-020 and the V2E-0515 vocabulary. `rcs-certification.service.js` spells them `Ppre` and so on; that service's codes are mapped when the write is wired.
3. **The resolution statuses.** `resolutionStatus` is `resolved|absent|unknown|invalid|incompatible|not_scored`. V2E-0521's cell reads only `resolved`; the rest is RULE-011's list. The pattern is the repo extending a one-value vocabulary cell to the set it names, as in `2026-10-22-inactive-analytical-preparation-structures.md` item 3.
4. **An unresolved axis carries null severity and penalty, never 0.** RULE-011 says "Never assign zero" to an absent, unknown, invalid, incompatible or not_scored axis, and RF018 AC9 forbids an automatic zero penalty. That outranks V2E-0517's and V2E-0519's 1..1: a resolved axis carries both, and its `weightedPenalty` is `maximumWeight * severity` (eq:axis_penalty, rounded as the service rounds).
5. **The gate set reuses RCSAssessment's, and pass needs all six criteria.** `gateResult` is `pass|fail|review_required`, the set of RCSAssessment.governanceGateResult (ENUM-0069..0071), since V2E-0536's cell reads only `pass`. `pass` requires all six flags true, because the manuscript's gate is the product of the criteria (eq:governance_product, G_gov = product of g_j) and is not compensable. A missing flag is an error, never read as false. A result other than pass needs a failure reason (V2E-0537).
6. **A CodeableConcept is stored as the Coding shape.** `materialTypeCode` takes the `{ systemUri, code, version, display }` shape, as `2026-10-22-inactive-analytical-preparation-structures.md` item 4 decides for LabelDefinition `concept`.

## Not decided here

- **The assessment write and its collections**: which flow creates the snapshot, its axis inputs and its governance evidence, and the `collections.js` and `env.js` keys they use.
- **SPRECMappingRelease and RCSRulePackage**, which the snapshot's and the axes' release references point to.
- **The RCSAssessment v4 fields** and its KNOWN_DRIFT block.
- **routeReasons** (RF018 AC8).
- **The AC11 statement** that the RCS is not clinical validity, assay quality or a universal measure.
- **The Foundation `rcs` readiness gate**, which stays deferred.
