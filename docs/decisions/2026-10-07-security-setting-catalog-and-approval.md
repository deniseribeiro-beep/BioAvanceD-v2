# 2026-10-07: the security setting catalog, and who approves a configuration release

Requirements: RF014 AC1 and AC7, Requisitos v4.0.0; checklist CFG-002, CFG-004, CFG-008; dictionary V2E-0011..0019 (ConfigurationProfile) and V2E-0037/0038 (ConfigurationRelease approvedBy, approvedAt). Issue #1304, line 2. Follows `2026-10-07-configuration-validation-and-governance-registry.md`.

## Decided

1. **Every key of the security configuration has a catalog entry** (`api/backend/src/governance/securitySettingCatalog.js`, version 1.0.0). An entry names the seven attributes RF014 AC1 and CFG-002 list: `type`, `scope`, `allowedValues`, `default`, `dependencies`, `owner` and `validity`.
2. **`allowedValues` takes one of six forms:**
   - `range`: a number in `[min, max]`, optionally an integer;
   - `enum`: one of a list, booleans included;
   - `any`: any value of its type, where no rule narrows it today;
   - `fixed`: only one value, with the reason and the invariant that fixes it. Another value is refused (RF014 AC6);
   - `governed`: derived from the active RetentionPolicy (#1248);
   - `follows`: copied from another key on every save (#1249).
3. **The catalog is the source of the fixed and the retention-governed keys.** `security.service.js` derives `FIXED_PATHS` and `RETENTION_GOVERNED_PATHS` from it.
4. **The ranges and enums restate the validation run's checks** (`configFindings`), which keep their own messages. `securitySettingCatalog.test.js` probes each bound against the run: the bounds pass and one step past either fails. A catalog that drifts from the run fails that test.
5. **The ConfigurationProfile carries the catalog** in its `settings` (types), `defaults`, `allowedValues` (by path) and `dependencies` (V2E-0015..0018). A profile stored before the catalog, or under an older one, is refreshed when it is next read, and keeps its `profileId`, which the releases name.
6. **`GET /api/security/config/catalog`** serves the catalog with its version, administrator only, like the rest of that router.
7. **Approval stays part of activation (RF014 AC7).** The administrator who activates a change is recorded as its approver, and the `proposed`, `approved` and `activated` events are appended in that order. No separate approval step is added.

## Why approval is not a separate step

The sources were read for a second approver, a waiting `candidate` state or a separation of duties, and none asks for one:

- **RF014 AC7** asks the system to record proposal, approval, activation, rollback and violation attempts. All five are recorded.
- **V2E-0037/0038** make `approvedBy` and `approvedAt` "obrigatório para ativação", required for activation. Both are set on every active release.
- **CFG-004 and CFG-008** ask that every change creates a release and is traceable, with no invariant bypassed silently. They name no approver.
- `[ran it]` A search of `docs/extracted-v2.0.0/` for a four-eyes or separation-of-duties rule ("quatro olhos", "segregação de função", "dupla aprovação", "segundo aprovador") found none. `requisitos.md`'s other approval mentions are about ethics approvals, reference data and disposition actions.

A two-person rule would change the Security page, so that a save no longer takes effect, and every flow that saves a configuration. With no source asking for it, it is not built. If a later release asks for it, the `candidate` status (V2E-0003) is where a waiting proposal would sit.

## Chosen where the sources leave a gap

- **`scope`** is `environment` for every key, the scope of the profile, as decided in `2026-10-07-security-configuration-releases.md`.
- **`owner`** is `role:administrator` for a key the Security page edits, the invariant's id for a fixed key, `GovernanceInvariantCatalog` for a key fixed only because no job applies it, and `RetentionPolicy` for a governed key. The profile's own `ownerId` stays `SYSTEM`.
- **`validity`** names where a value's period comes from: the release's `effectivePeriod`, the RetentionPolicy's for a governed key, and the canonical model release for a fixed one.
- **`any`** is declared, not invented, for `authentication.lockoutDurationMinutes` and `enhancedSecurity.sessionTimeoutMinutes`. The run has no range for them, and choosing one is a policy change, not a catalog entry.
- **Only enforced dependencies are listed:** `minLengthWithMFA` at most `minLength`, and the two `loginAttempts` keys that follow the authentication pair.
