# 2026-10-23: the Foundation `rcs` readiness gate is evaluated over the build's rule package, axes, governance evidence, input snapshot and golden vectors

Requirement RF022 AC3. Plano §9 (gate row "RCS") and §11 (RCS tests). Issue #1320, handed from #1305. Sequel to `2026-10-23-rcs-rule-package-and-scope.md`, whose "Not decided here" list named this gate.

## The question

RF022 AC3 asks to "Preparar os contratos e gates de RCSInputSnapshot, eixos pré-analíticos, evidências de governança e recálculo integral". The Foundation job reported gate `rcs` as `not_evaluated`, listed in `DEFERRED_P0_GATES` with phase `W10 · RCS v4`. The contracts it waited on now exist: the input snapshot, the axis inputs, the governance evidence, the SPREC and matrix mapping releases and the rule package. What does the gate check, and over what, without changing `certify()`, a score, grade, route or penalty, or `calculation_trace`, and without writing anything?

## Decided

`[inference]`, from plano §9's RCS row (evidence "Matriz, cinco eixos, códigos/severidades, seis evidências, snapshot/hash/URI, P_bio e rota"; blocker "Entrada ausente/não resolvida, hash divergente ou resultado não recalculável"), §11's RCS tests (golden vectors fluid/solid, five axes, six evidences, recalculation, classes A-E, governance_failure, unknown/Not scored), and the repo's pattern of pure Foundation gates over in-build contracts (`versionGate`, `mechanismsGate`), by the coordinator for #1320, on 2026-10-23:

1. **The gate is pure.** `src/foundation/rcs-readiness.js` exports `rcsReadinessGate({ service })`, over the `rcs-certification.service` singleton by default. It reads no database and names no RCS collection, and `readiness.js` does not require it, so RCS code stays off the API's boot path. The Foundation job runs it in apply and in verify, after the configuration gate; not in dry-run or rollback.
2. **Five checks, in order**, each recorded as `{ check, passed, detail }` in `evidence.checks`:
   - `releases`: the governance rule set, the matrix mapping release, the SPREC mapping release and the rule package are each non-null with a `sha256:<64 hex>` checksum, and both mapping releases are `active`.
   - `axes`: fluid and solid each have five axes, one weight row per axis, weights summing to 100, and axis codes that map (`Ppre` to `P_pre`) onto `RcsInputSnapshot.AXIS_CODES` in order.
   - `governance-evidence`: six governance flags; on the `fluid-ideal` vector each is true, false or null, the evidence names the rule set's checksum, and `RcsGovernanceEvidenceSnapshot.capture` accepts it.
   - `input-snapshot`: `RcsInputSnapshot.capture` with fixed ids and instant gives the same hash for the same input twice, a different hash for `fluid-mid`, a URI that pins the hash, and a frozen result.
   - `golden-vectors`: ten vectors recalculate to their expected `rcs_score`, `final_grade`, `grade_route` and `governance_failure_reasons`, and a second certify of a deep copy gives identical canonical JSON.
3. **The vectors** (`RCS_GOLDEN_VECTORS`), every value measured on the build's certify: fluid-ideal 100 A, solid-ideal 100 A, solid-b 85.05 B, fluid-mid 73 C, fluid-d 50 D, fluid-e 35 E by "Score critical penalty", and governance failures (null, E) for an unknown code (`X`), an Other code (`Z`), a code incompatible with the axis (`SNP` on a fluid axis) and a missing matrix.
4. **It fails closed.** The gate passes only when all five checks pass. A throw stops the remaining checks, keeps the entries already recorded, and fails the gate with the message (300 chars at most) as `evidence.error`. The gate is P0, so a fail blocks the ReadinessReport, as plano §9 orders.
5. **Its evidence names the package.** `evidence` carries `rulePackage`, `governanceRuleSet`, `matrixMappingRelease` and `sprecMappingRelease` as the service returns them.

## Not decided here

- **Recording the rule-package checksum in `FoundationDataRun.contractChecksums`**, for release parity across runs as the `version` gate does for the dictionary.
- **Gating on Mongo-seeded RCS reference collections**; the gate checks the rule package this build carries.
