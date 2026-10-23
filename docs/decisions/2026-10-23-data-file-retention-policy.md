# 2026-10-23: a DataFile records the active DataFile RetentionPolicy, and its versions carry it

Requirement RF007 AC3; dictionary V2E-0475 and ELM-0021. Issue #1321.

## The question

RF007 AC3 asks to "Registrar ... owner, retenção ...", and V2E-0475 makes `DataFile.retentionPolicyId` a Reference(RetentionPolicy), 1..1 Core. No file row recorded a policy: `retentionPolicy.service.js` accepts only the entity types something acts on (#1273), its families were `auditTrail` and `specimen`, and no policy could name a DataFile (`2026-10-23-data-file-links-and-core-companions.md`). Which policy does a file record, and how?

## Decided

By the coordinator for #1321, on 2026-10-23:

1. **`retentionPolicy.service.js` has a third family, `dataFile: ['DataFile']`.** A policy may name `DataFile`, and activating one deactivates only the active policies naming `DataFile`. `ALLOWED_ENTITY_TYPES` follows from the table.
2. **`getActivePolicyId(db, family)` returns the id of the family's one active policy** (`String(policy._id)`, the newest by `createdAt`), or `null` when none is active, and throws for a family not in the table.
3. **Every DataFile upload** (`sample-file.controller.js`, `createLinkedFileController.js`) resolves `getActivePolicyId(db, 'dataFile')` after the link check and writes it as `retentionPolicyId` on the row. The upload's 201 `data`, its audit payload and the list responses carry it. A request field named `retentionPolicyId` is ignored: the server resolves the policy, the client never picks it.
4. **No active DataFile policy records `null`,** and the upload still lands.
5. **A replace leaves `retentionPolicyId` untouched:** it belongs to the DataFile, as `ownerId` does.
6. **`SampleFile.validate` treats `retentionPolicyId` as optional,** as it does the other v2 companions, and a present value must be a non-empty string.
7. **A DataFileVersion row carries its DataFile's `retentionPolicyId`,** the baseline and the new version both, and `null` for a file row without one. It stays outside `DataFileVersionModel.fieldsOf`, which lists the version's own catalog fields, as the encryption envelope does.

`[inference]` The DataFile family is admitted because a DispositionAction acts on it: a person records and executes a DispositionAction with `entityType: 'DataFile'` (RF026 AC4-AC6), never the sweep. This is the justification commit `6624e98c` gave the specimen family under the #1273 rule.

`[inference]` The file records its family's one active policy, the way "the sweep, the security settings and GET /active" each read their family's active policy (the `getActivePolicy` comment). The id is the policy's `_id` as a string, the form `DispositionAction.retentionPolicyId` already stores.

`[inference]` No active policy records `null` rather than refusing the upload. The v2 companions are optional on `SampleFile.validate` because older rows lack them (`2026-10-23-data-file-links-and-core-companions.md`, item 8), and no seed or e2e fixture creates a retention policy, so a refusal would block every upload on a fresh stack.

`[inference]` A version row carries its DataFile's policy under BaseRecord ELM-0021 (`retentionPolicyId`, Reference, 0..1). The dictionary gives DataFileVersion no field of its own for it, and the retained binary of a version is governed by its DataFile's policy.

## Not decided here

- **Refusing an upload when no DataFile policy is active.**
- **A DispositionAction for a DataFile checking that the policy it names is the file's.**
- **What executing a DataFile disposition does** to the row and its binaries.
- **Re-pointing existing rows to a policy:** rows written before this decision, and rows recorded under a policy later deactivated, keep what they hold.
