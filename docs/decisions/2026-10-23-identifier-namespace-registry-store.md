# 2026-10-23: IdentifierNamespaceRegistry rows are stored, entered by an administrator, and read by the FHIR validator's identifier.system check

Requirement RF011 AC3, RNF024 C2, RULE-036. Dictionary IdentifierNamespaceRegistry V2E-0691..0699. Issue #1322.

## The question

The FHIR validator refuses any `identifier.system` that is not a registered namespace (see `docs/decisions/2026-10-23-fhir-validator-version-profile-identifier-system.md`), but the only registry it read was the frozen, empty module `api/backend/src/resources/fhir/conformance-registry.js`. Nothing stored an IdentifierNamespaceRegistry row, so every identifier system was refused for good. Where are namespace rows stored, who enters them, and how does the import validation read them?

## Decided

`[inference]`, read off the Network/Biobank pattern (`docs/decisions/2026-10-23-network-biobank-structures.md`: a plain model plus the master-data router, roles 3 and 4, no seed), by the coordinator for #1322, on 2026-10-23:

1. **Stored through the master-data router.** Rows live in the `identifierNamespaceRegistries` collection, entered at `/api/identifier-namespaces` through `createMasterDataRouter` and written by roles 3 and 4, the factory's gate. The model gains a `validate` that answers `create`'s refusal as the POST's 422.
2. **Entry is activation.** The catalog's `status` lists only `active`, so a stored row is an active one, and RULE-036's "Block activation" is the POST's 422: a `systemUri` that is not HTTPS, or whose host is outside bioadvanced.dev and every approved external authority, is not stored.
3. **External authorities stay refused at entry.** The POST validates with the base registry's `approvedAuthorities`, which is empty until an approval store exists, so only bioadvanced.dev URIs are entered.
4. **The URI stays stable across versions.** `namespaceKey` and `systemUri` are immutable on PUT (422), and are left out of the PUT allowlist. A new version is a new row under the same `namespaceKey` with the same `systemUri`; a POST naming a stored key under another URI answers 409.
5. **The loader fails closed to the base registry.** `loadConformanceRegistry` (`api/backend/src/services/identifierNamespaceRegistry.service.js`) appends every stored row to the base registry's namespaces and is passed to the validator by the sync and async import validation. It filters nothing: the validator re-accepts each row through `IdentifierNamespaceRegistry.create` and keeps its `systemUri` only while its `[start, end)` vigência holds now. Without a db, or when the read fails or answers a non-array, the base answers alone, and the empty base refuses every system.
6. **No seed.** Phase 1 allows no fictitious operational data (`docs/extracted-v2.0.0/requisitos.md` line 55); a real row is entered by an administrator.

## Not decided here

- **A MongoDB unique index** on `identifierNamespaceRegistryId` or on `namespaceKey` with `semanticVersion`.
- **Uniqueness of `systemUri` across keys**: two keys may still name the same URI.
- **An approved-authority store** for RULE-036's external hosts.
- **The frontend** screen that enters namespaces.
- **PUT re-validation** of the merged row against the model (the PUT sets allowlisted keys without re-running `create`).
