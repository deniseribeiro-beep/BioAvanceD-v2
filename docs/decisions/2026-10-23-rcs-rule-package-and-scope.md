# 2026-10-23: an RCSAssessment keeps its rule package, execution environment and justifications, states that the RCS is not clinical validity, and is never edited

Requirement RF018 AC10 and AC11. Dictionary V2E-0445 (RCSAssessment.rulePackageVersion), V2E-0446 (rulePackageChecksum), V2E-0449 (executionEnvironment), V2E-0450 (justifications). Issue #1320. Sequel to `2026-10-23-rcs-sprec-mapping-release.md`, whose "Not decided here" list named the RCSRulePackage that would version the grade thresholds.

## The question

RF018 AC10 asks to "preservar pacote/checksum, ambiente, instante e justificativas; tornar entradas congeladas e resultados não editáveis", and AC11 not to represent the RCS "como validade clínica, qualidade analítica do ensaio ou medida universal". An RCSAssessment carried no rule package version or checksum, no execution environment and no justifications, nothing guarded the RCS collections against an edit, and nothing stated what the RCS is not. Which package, which environment and which justifications, named when, without changing `certify()`, a score, grade, route or penalty, or `calculation_trace` (which `MerkleService.js` hashes)?

## Decided

`[inference]`, from the dictionary rows, the v2.0.0 synthetic example (`biobankExample.rcsAssessments[0]`) and the repo's pattern (a release named only on positive evidence, else null, as the SPREC and matrix mapping releases; `security.service.js`'s `env.NODE_ENV` as the environment field), by the coordinator for #1320, on 2026-10-23:

1. **The package checksum composes the existing checksums with the thresholds.** `rulePackage()` returns `sha256:` plus the SHA-256 of `canonicalJson` over the model code, the SPREC version, the checksums of `governanceRuleSet()`, `matrixMappingRelease()` and `sprecMappingRelease()`, and the grade thresholds. The thresholds are the one table certify reads that no existing checksum covers, so the package checksum changes whenever any rule certify reads changes. With either mapping release absent from the data it is null. The three existing checksums are unchanged.
2. **The package version is the model code** (`RCS-GOV-1.0`), as `governanceRuleSet().version` is; it is not a SemVer.
3. **The package and the environment are named only on reproduction.** `recordAssessment` writes `rulePackageVersion`, `rulePackageChecksum` and `executionEnvironment` only when `certify` over the captured `rcs_input` reproduces the stored result on the keys the SPREC mapping release decision lists, and the package is non-null. A result with no `rcs_input`, one not reproduced, or one with no package carries null for all three, never a fabricated value.
4. **The environment is `{ runtime: 'node', runtimeVersion, environment, packageVersion }`**: `process.version`, the configured `env.NODE_ENV` as `security.service.js` records it, and the package version under the synthetic example's own `packageVersion` key.
5. **The justifications are the route's reasons plus the scope statement.** Every assessment, with or without `rcs_input`, carries `[...routeReasons, RCS_SCOPE_STATEMENT]`, so V2E-0450 (1..*) is never empty and every assessment states AC11: "RCS qualifies the pre-analytical history of this specimen for the stated use context; it is not clinical validity, analytical assay quality or a universal quality measure." Nothing is added to the input snapshot, the governance evidence or `calculation_trace`.
6. **The results are not editable, by an architecture guard.** `tests/architecture/rcs-results-immutable.arch.test.js` fails when a file other than `src/config/collections.js`, `src/config/env.js`, `src/services/rcs-assessment.service.js` and `scripts/seed-essential-reference-data.js` (which only counts them) names `rcsAssessments`, `rcsInputSnapshots` or `rcsGovernanceEvidenceSnapshots`, and when `rcs-assessment.service.js` makes any write other than its three inserts and the two compensation deletes keyed on the snapshot's or the evidence's own id.

## Not decided here

- **An RCSRulePackage model or collection** (V2E-0354..0360): its id, status and validation evidence. The package is resolvable only through `rulePackage()`.
- **A UI notice of the AC11 statement** where the intake wizard shows the RCS.
- **`sprecVersion` on the assessment** (V2E-0448).
- **The Foundation `rcs` readiness gate.**
