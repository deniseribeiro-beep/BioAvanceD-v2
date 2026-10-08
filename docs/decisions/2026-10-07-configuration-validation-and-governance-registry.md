# 2026-10-07: configuration validation runs, governance invariants and the canonical model release

Requirements: RF014 AC3, AC4, AC6 and AC7, RF012 AC2, RNF018 C3, RNF023 C1/C7, RNF028 C3/C5, Requisitos v4.0.0; checklist GOV-001, GOV-002, CFG-003, CFG-005, CFG-008; rule RULE-015; plano §4 F1.2 and §9. Issue #1304, lines 3 to 5. Follows `2026-10-07-security-configuration-releases.md`.

## Decided

1. **The Foundation job registers the `CanonicalModelRelease`** (V2E-0001..0010) under the id it already wrote on every run, `release-2.0.0`. Its `artifactManifest` lists each artifact of `docs/RELEASE_MANIFEST.json` with its SHA-256, plus the generated `catalog.2.0.0.json`. Its checksum is the SHA-256 of that list, so the release moves if any of them does.
2. **The Foundation job registers a `GovernanceInvariantCatalog`** (V2E-0020..0031), version 1.0.0, bound to that release. Its invariants live in `api/backend/src/governance/invariants.js`. Each one names its enforcement points and the tests that verify it, with `block` as the outcome.
3. **Registration happens once.** A registered release or catalog is never rewritten. A re-run whose checksum differs leaves the record as it is and fails the new P0 readiness gate, `governance-registry`.
4. **Every security-configuration candidate gets a `ConfigurationValidationRun`** (V2E-0042..0051) before activation. The run records the structural, semantic, dependency and security gates, plus one result per invariant.
5. **A failed run refuses the change.** The candidate is kept as a `draft` release that was never active, and it cannot be rolled back to. The response is 422 when an invariant was broken and 400 when another gate failed, and it carries the run's id and the broken invariants.
6. **A fixed key sent at a different value is now refused.** Before, a write to a fixed key was dropped silently. CFG-008 says no administrative function bypasses an invariant silently, so the refusal also appends a `violation_attempted` `ConfigurationChangeEvent`. The page's echo of a fixed value is unchanged, so it still saves.
7. **A passed run is followed by `proposed`, `approved` and `activated` events,** in that order (RF014 AC7). Approval is not yet a separate step, so the administrator who saves is recorded as the approver, as before.
8. **The Foundation `configuration` readiness gate is now evaluated:** every active `ConfigurationRelease` has a passed run (plano §9, "ConfigurationValidationRun aprovado").

## Chosen where the sources leave a gap

- **`releaseStatus`** uses V2E-0003's full list: `draft|candidate|approved|active|superseded|retired`.
- **`GovernanceInvariantCatalog.status`**: the dictionary lists only `draft` (V2E-0025). The set used is V2E-0003's, as decided earlier for `ConfigurationRelease.status`. This is an inference.
- **Gate results**: the dictionary lists only `pass` (V2E-0044..0047). The results used are `pass|fail`.
- **Run status**: the dictionary lists only `planned` (V2E-0049). A run is recorded once it has executed, as `passed` or `failed`, after the plan's gate wording. This is an inference.
- **The conflict check** in RULE-015 has no field of its own in the dictionary, so it is folded into the dependency gate. `minLengthWithMFA` above `minLength` is that case.
- **Which check belongs to which gate:**
  - **Structural:** an unknown key, a wrong type, or a group that is not an object.
  - **Security:** the NIST password floors and the MFA method.
  - **Semantic:** the other ranges and the log level.
- **`approvedBy` of the canonical model release**: the release manifest records the approval date and scope, and names no person. The approver is therefore recorded as `release-manifest:documentary_release`.
- **The release manifest is carried beside the catalog** (`api/backend/src/reference-data/canonical-dictionary/release-manifest.2.0.0.json`), because the backend image is built from `api/backend` and cannot read `docs/`. `npm run dictionary:generate` writes it, and `npm run dictionary:validate` fails when it is stale.
- **Invariants with no configuration key** cover store authority, outbox, the FHIR boundary, purpose, provenance and RCS admissibility. They are held by INV-SCOPE-001: any key outside the profile's catalog fails the structural gate and that invariant.

## Not decided here

These stay open on #1304:

- the setting catalog (RF014 AC1: type, scope, allowed values, defaults, dependencies, owner and validity for each setting);
- approval as a step separate from saving (RF014 AC7);
- the consumers that must name the active configuration release (RF015 AC1, RF024 AC4, RF029 AC1).
