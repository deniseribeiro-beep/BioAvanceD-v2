# 2026-10-23: a DataFile records its canonical MIME type, its owner and every entity it is linked to

Requirements RF007 AC3 and AC5; dictionary V2E-0471, V2E-0474, V2E-0475 and V2E-0476. Issue #1321.

## The question

RF007 AC5 asks to "Vincular arquivos a espécime, consentimento, aprovação, ensaio, estudo, dataset, workflow ou outra entidade aplicável", and AC3 to "Registrar ... owner, retenção, ... vínculos canônicos". A DataFile row (`sample_files`, `assayFiles`, `datasetFiles`) recorded only its parent (specimen, assay or dataset). It carried none of `mimeType` (V2E-0471, code, 1..1), `ownerId` (V2E-0474, Reference(Actor), 1..1), `retentionPolicyId` (V2E-0475, 1..1) or `linkedEntityRefs` (V2E-0476, array<Reference>, 1..*). A workflow link existed only on the WorkflowRun side (`inputFileIds`/`outputFileIds`), and nothing linked a file to a consent, an approval or a study. What does a file record, and how is a link made?

## Decided

By the coordinator for #1321, on 2026-10-23:

1. **`linkedEntityRefs` is a list of `{ entityType, entityId }`, and it always starts with the parent:** `Specimen` (the sample `_id`) for a sample file, and `Assay` or `Dataset` (the parent's own id) for a linked file. `SampleFileModel.LINKED_ENTITY_TYPES` names the allowed types: `Specimen`, `Assay`, `Dataset`, `Consent`, `CollectionGovernanceApproval`, `Study` and `WorkflowRun`.
2. **An upload may name a consent, an approval and a study** in the optional request fields `consentId`, `approvalId` and `studyId`. `resolveLinkedEntityRefs` (`api/backend/src/services/dataFileLinks.service.js`) looks each one up (`patientConsents` by `consentId`, `collectionGovernanceApprovals` by `approvalId`, `studies` by `studyId`) and appends the found ones after the parent, in that order. An absent or empty field is skipped. A field that is not a string of 1 to 128 characters after trimming, a repeated multipart field included, is an error, and so is an id with no document. Every field is checked and every error is collected.
3. **A refused link answers 422 `{ success: false, error: 'Vínculo inválido', details }`** before the object is written and before any row exists. Only multer's staging file of that upload is removed, so a refused link leaves no orphan object and destroys no evidence.
4. **Linking a file to a WorkflowRun also writes the file side:** `POST /api/workflow-runs/:workflowRunId/files` `$addToSet`s `{ entityType: 'WorkflowRun', entityId }` on the file's own collection, with the keys in that order, so a repeated link adds no second entry.
5. **`mimeType` is `canonicalMimeType(ext)`** (`uploadFormatPolicy.js`): the first MIME of the extension's format policy, or `application/octet-stream` for an extension with an empty list (`.raw`, `.bam`) or no policy. A `.vcf` here is a Variant Call Format file, never a vCard, so `text/plain` is moved first in its list and is its canonical type. The vCard MIMEs browsers send stay accepted. `fileFormat` (ELM-0319) stays as it is beside it.
6. **`ownerId` is the uploader's anonymised id.** The upload and list responses return `mimeType`, `ownerId` and `linkedEntityRefs`, and the upload audit payload carries `linkedEntityRefs`.
7. **A replace recomputes `mimeType` from the new file and leaves `ownerId` and `linkedEntityRefs` untouched:** they belong to the DataFile, not to one of its versions.
8. **`SampleFile.validate` treats the three fields as optional,** as it does `storageObjectVersion`, since older rows lack them. A `mimeType` that is present must be a lower-case `type/subtype`, and a `linkedEntityRefs` that is present must be a non-empty list whose entries have an allowed `entityType` and a non-empty `entityId`.

`[inference]` `mimeType` is the extension's canonical IANA type, not the client's declared MIME. The declared MIME is supplied by the client, and browsers mislabel it: the format policy's own comments say a `.csv` arrives as `application/vnd.ms-excel` and a `.vcf` as vCard. The extension is the axis the bytes were checked against (`checkFileSignature`). For the sample file types it equals `fileFormat` (`FILE_FORMAT_BY_TYPE`).

`[inference]` A link is checked for existence only, with no status or organisation gate. This follows `workflowRunFileLinker.js`'s precedent ("existence only, no status gate"): the link records provenance and grants no use.

`[inference]` A reference is `{ entityType, entityId }`. The field is polymorphic, and the catalog's example `[consent-synthetic-001]` alone cannot say which entity an id names. The pair of an entity type and a record id follows `DispositionAction` and `LegalHold`, which name their target by `entityType` and the record's id.

`[inference]` `ownerId` is the uploader's anonymised id (`uploaderAnonId`). The file rows keep only an anonymised actor id ("ID anonimizado do uploader (LGPD)"), and the repo has no Actor collection to reference.

`[inference]` `retentionPolicyId` is not written. `retentionPolicy.service.js` accepts only the entity types something acts on (#1273): its families are `auditTrail` and `specimen`, and no policy can name a DataFile, so there is no policy to reference. Inheriting the specimen's policy would claim a governance that nothing enforces on files.

## Not decided here

- **Rows written before this decision** have no `mimeType`, `ownerId` or `linkedEntityRefs`. A workflow link on such a row creates a `linkedEntityRefs` holding only the WorkflowRun reference, without the parent.
- **Adding a consent, approval or study link after upload:** no route does it.
- **`retentionPolicyId` (V2E-0475):** decided in `2026-10-23-data-file-retention-policy.md`.
- **`encryptionKeyReference` (V2E-0473).**
