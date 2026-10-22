# 2026-10-22: a DataFile delete is logical, and the binary is kept

Requirement RF007 AC6, RNF029 C3. Issue #1321.

## The question

RF007 AC6 asks to "auditar upload, acesso, criação de versão, remoção lógica e destinação". `DELETE .../files/:fileID`, in both `api/backend/src/controllers/sample-file.controller.js` and the Assay/Dataset factory `api/backend/src/controllers/createLinkedFileController.js`, unlinked the binary at `storagePath` and deleted the DataFile row, so the removal was physical and its evidence destroyed. What does a delete write, what happens to the binary, and how do the other file routes treat a deleted row?

## Decided

`[inference]`, from the specification and the repo's code, by the coordinator for #1321, on 2026-10-22:

1. **A delete marks the row, it never removes it.** No requirement names the field; the pattern is the repo's existing logical delete, `deletedAt: { type: Date, default: null }` on `api/backend/src/models/StorageContainer.js`, whose readers filter `deletedAt: null` (`api/backend/src/services/storage-scope.service.js`). A delete runs one `updateOne({ _id, deletedAt: null }, { $set: { deletedAt, deletedByAnonId, updatedAt } })`. The actor is recorded as `deletedByAnonId` from `getUserAnonId`, anonymised as `uploaderAnonId` already is. If the update matches nothing, a concurrent delete won: the request answers 404 and writes no audit.
2. **The binary is kept, never unlinked** (RNF029 C3), as the replace already keeps the superseded binary (`docs/decisions/2026-10-22-data-file-versions.md`). The file's DataFileVersion rows are untouched.
3. **The audit names the removal as logical.** It keeps action `file_delete` and severity `critical`; its message is `Arquivo removido logicamente: <fileName>` and its payload adds `logicalDelete: true` and `deletedAt` (ISO string). The response stays 200 with the same body.
4. **A deleted row is not served.** Every single-file lookup (download, delete, replace, and the sample HL7 v2, FHIR and CDA exports) treats a row with a truthy `deletedAt` exactly as a missing row, with the same 404 body; a replace also cleans up its upload as for a missing row. Both `listFiles` filter `deletedAt: null`, which also matches a row with no such field, so a second delete of the same file gets 404 and no audit.

## Not decided here

- **Restore or undelete.** No route clears `deletedAt`.
- **Retention and destinação** (RF007 AC6, `retentionPolicyId` V2E-0475): when a retained binary may finally be disposed of, and how that disposal is audited.
- **Other readers of DataFile rows:** `api/backend/src/services/workflowRunFileLinker.js`, `api/backend/src/services/accessRequest.service.js` and `api/backend/src/services/hl7Audit.service.js` still read deleted rows.
- **Object storage** (RF007 AC2): the binary stays at its local `storagePath`.
