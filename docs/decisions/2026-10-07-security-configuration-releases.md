# 2026-10-07: security configuration changes are ConfigurationReleases

Requirement: RF014 AC2 ("Criar nova ConfigurationRelease para cada alteração; impedir edição de release ativa") and AC4 ("permitir rollback governado"), Requisitos v4.0.0. Issues #1304 (line 1) and #966.

## Decided

1. **Every save of the security configuration activates a new `ConfigurationRelease`** (V2E-0032..0041) holding the whole settings snapshot and its SHA-256 checksum. A release's settings and checksum are never rewritten. Only its lifecycle moves: the previous active release becomes `superseded`, and its `effectivePeriod` is closed.
2. **The `security_config` document (`_id: 'main'`) stays the read model.** Every reader keys on it. It now also names the active release (`configurationReleaseId`) and copies its `effectivePeriod`.
3. **One active release per profile** is enforced by a partial unique index on `configurationReleases` (`profileId`, where `status: 'active'`). This is the Foundation plan's F1.2 gate, "Uma release ativa por ambiente".
4. **A rollback is a new release.** It copies the target release's settings, and its `rollbackTargetId` names the target. The old row is never reactivated (plano §10: "Nenhuma evidência ou registro histórico é sobrescrito"). It goes through the same validation, audit and session revocation as any save.
5. **Each activation and rollback appends a `ConfigurationChangeEvent`** (V2E-0052..0059). A `rolled_back` event's `rollbackOf` names the activation it undoes.
6. **The first save records the configuration already in force as a baseline release**, so the first change can be rolled back.

## Chosen where the sources leave a gap

- **`environment` (P1X-0277, #966) is `env.NODE_ENV`**, the same source and vocabulary (`development|test|staging|production`, P1X-0399) the Foundation job already records on FoundationDataRun and ReadinessReport. A second environment source would let the two disagree.
- **`securityConfigId` (P1X-0276)** is a uuid assigned when the document is first stored. `_id` stays `'main'`.
- **`ConfigurationRelease.status`**: the dictionary lists only `draft` (V2E-0040). The set used is CanonicalModelRelease's `releaseStatus` (V2E-0003: `draft|candidate|approved|active|superseded|retired`), the one release lifecycle the same v2.0.0 governance block spells out in full. This is an inference.
- **`ConfigurationChangeEvent.changeType`**: the dictionary lists only `proposed` (V2E-0054). The set used is RF014 AC7's list of steps to record: `proposed|approved|activated|rolled_back|violation_attempted`.
- **`ConfigurationProfile.scopeType`**: the dictionary lists only `organization` (V2E-0013). The security profile is scoped to an `environment`, per the F1.2 gate above.

## Not decided here

The validation run before activation (AC3) and the invariant catalog (AC6) were decided later the same day: `2026-10-07-configuration-validation-and-governance-registry.md`. When this record was written, these were open on #1304:

- the setting catalog (RF014 AC1);
- proposal and approval as separate steps, with a ConfigurationValidationRun before activation (AC3, AC7). Until then, the administrator who saves a change is recorded as its approver;
- the invariant catalog (AC6).
