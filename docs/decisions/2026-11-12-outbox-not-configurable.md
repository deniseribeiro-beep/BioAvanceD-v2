# 2026-11-12: a configuration release cannot address the outbox; the refusal is INV-SCOPE-001's

Requirements RNF028 C5/C7, RF014 AC6, RNF018 AC2; checklist CFG-002, CFG-008. Issue #1504. Follows `2026-10-07-configuration-validation-and-governance-registry.md`.

## The question

Should the governance invariant catalog carry an invariant of its own that makes the outbox impossible to disable, refused the way INV-AUDIT-001 refuses turning the audit trail off? Or is it enough that no setting can address the outbox at all?

## Decided

This is an inference from the repo's pattern, not an owner ruling (#1504, 2026-11-12). The pattern: every invariant with no configuration key (store authority, outbox, the FHIR boundary, purpose, provenance and RCS admissibility) is held by INV-SCOPE-001 (`2026-10-07-configuration-validation-and-governance-registry.md`, "Invariants with no configuration key"). A dedicated invariant exists only where the setting catalog has a key it fixes: INV-AUDIT-001, INV-PRIVACY-001, INV-CONSENT-001 and INV-IDENTITY-001, each with its `configurationPaths`.

1. **No setting addresses the outbox.** The security setting catalog holds exactly the keys of the eight policy groups, and none names the outbox. So `outbox` at top level, or `<group>.outbox…` inside a group, is outside the catalog: the structural gate fails, INV-SCOPE-001 fails, and the save is refused. The response is 422 naming `INV-SCOPE-001` and the fieldPath; the run records one InvariantViolation with outcome `block`; a `violation_attempted` ConfigurationChangeEvent is appended; and the candidate is kept as a draft. The active release does not move.
2. **No separate outbox invariant.** An invariant with no configuration path fails on every key outside the catalog (`invariantResultsFor` in `configurationValidation.service.js`). A second such invariant would therefore also fail on unrelated unknown keys, such as `session.timeout`, and double every one of those refusals. A dedicated outbox invariant becomes due only when a catalog gains an outbox-related key; it then carries that key in `configurationPaths`, as INV-AUDIT-001 does.
3. **The proof** is the real-backend e2e gate case in `tests/e2e/auth-access-security.spec.ts` (the `{ outbox: { enabled: false }, … }` case, #1488), the unit cases in `api/backend/tests/unit/services/configurationValidation.service.test.js`, and `api/backend/tests/integration/security.routes.test.js`.

## Not decided here

- **A dedicated outbox invariant** if a configuration profile other than the security one, or a future catalog key, ever touches the outbox.
- **The outbox's own operational controls** (retry, dead letter), which are not configuration releases.
