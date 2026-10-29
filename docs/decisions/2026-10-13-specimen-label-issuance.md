# 2026-10-13: a specimen's generated code is issued as a LabelIdentifier on its container

Dictionary: Specimen.barcodeValue, ELM-0116 (0..1, deprecated, "Replaced by LabelIdentifier records", replaced by V2E-0169; migration note "Read legacy value, transform to the indicated v2 element, preserve original provenance; reject legacy writes after migration window"); LabelIdentifier V2E-0168..0179 and V2E-0642..0645; RULE-034 (Dicionário de Dados v2.0.0). Requirements: RF016 AC1/AC4. Issue #1378.

These decisions are inferences, not owner rulings. Two independent readings agree on each: the conventions of the label and chain code already in this repo (`models/LabelIdentifier.js`, `labelResolver.service.js`, `legacyPlacementChain.service.js`), and the dictionary rows above. Where a source leaves a gap, the choice is named below.

The function is `issueSpecimenLabel` in `services/specimenLabel.service.js`. This slice wires no caller: `Sample.barcode` is still written and read as before, and later slices call the function at create, at import and in the migration.

## Decided

1. **A generated code lands on the specimen's one Container** (`targetType: 'container'`; V2E-0171, "o tubo vazio é Container, não Specimen"): the container of its open SpecimenContainerAssignment. With none open, the specimen's legacy placement is adopted, else a container is created and loaded, as its first placement would be (2026-10-11 item 1). The load's `sourceEventId` (V2E-0683, 1..1) is `specimen-label-issuance:<sample _id>:<ISO instant>`. `ensureSpecimenContainer` in `legacyPlacementChain.service.js` does this.
2. **The label's fields:** `identifierOrigin: 'institution_applied'` (generated and printed by the biobank; RULE-034 is the maker's case), `symbology: 'code_128'` (the print job's ZPL is `^BC`, Code 128), `carrierPlacement: 'container_side'`, `immutableAtSource: false`, and `encodedValue` the code, unchanged.
3. **Namespace and template** are fixed local references, `namespaceRegistryId: 'legacy-sample-barcode'` and `templateVersionId: 'legacy-sample-barcode-label@1.0.0'`: no IdentifierNamespaceRegistry or LabelTemplate store exists yet.
4. **Issuance:** `issuedAt` is the issuing instant. `issuedBy` (V2E-0176, "Actor ou Organization") is the acting user's id, else the sample's `organizationId`, else `'system'`.
5. **The print batch.** `printBatchId` (V2E-0178) is required "quando houve impressão institucional", and RF016 AC4 asks for the batch "somente quando aplicável": a label issued at create or import is unprinted and has none. `LabelIdentifierModel.create` still requires it of an institutional label by default; an unprinted issue says `{ printed: false }`, and `issueSpecimenLabel` issues unprinted unless told otherwise.
6. **A migrated label keeps its provenance** in a local `migratedFrom: { elementId: 'ELM-0116', sampleId, value }`, written beside the model's fields, not in `fieldsOf`. Its `issuedAt` is the sample's `registeredAt`, else `createdAt`, else the run instant. `Sample.barcode` is kept for read compatibility.
7. **Sessions.** Every read and write of an issue runs in the caller's session, and with a session no index is built (2026-10-11 item 7). The `uniq_active_label_value` and ScanEvent index specs moved into `utils/physicalChainIndexes.js`, unchanged, and the Foundation job builds them at boot.
8. **The migration window** (2026-10-16, #1378). The window closes when `SAMPLE_BARCODE_WINDOW_CLOSED` is set (`true` or `1`); it is open by default. Once closed, create and both imports issue the code only as the LabelIdentifier and write no `Sample.barcode`; a PATCH naming `barcode`, with any value, is refused 422 `LEGACY_BARCODE_WRITE_REFUSED`; `resolveScan` stops reading the legacy barcode. Stored `Sample.barcode` values are kept, read only by the legacy readers.

## Chosen where the sources leave a gap

- **`institution_applied` and `container_side`.** The catalog lists only `manufacturer_applied` for the origin; `institution_applied` is the documented local value `LabelIdentifier.js` already accepts. The side of the tube is where a printed adhesive label goes; the manufacturer's Data Matrix is `container_bottom`.
- **`migratedFrom` is outside the model's fields.** The dictionary asks to "preserve original provenance" and names no field for it, and the catalog conformance guard diffs `fieldsOf` against the catalog.
- **The issuer fallback.** V2E-0176 allows an Actor or an Organization; a run with neither (a migration with no user, a sample with no organization) is attributed to `'system'`.
- **How the window closes.** The dictionary names no date or condition; it is an operator's opt-in, as the repo's other opt-ins are. It is closed only after `npm run migrate:sample-barcode-labels` has run and every reader of `Sample.barcode` (the print and by-barcode routes in `sample.routes.js`, `getSampleByBarcode`) reads the label first, and the code's uniqueness checks (`generateUniqueBarcode`'s yearly counter seed and the given-code duplicate checks in `createSample` and the LGPD import, all reading `samples.barcode` only) also read `labelIdentifiers`, none of which this change does.

## Not decided here

- Recording the batch at print (LabelPrintEvent).
- Persisted namespace and template records.
- The readers of `Sample.barcode` and the uniqueness checks reading the label first. While the window is open, `updateSample` still accepts a new `barcode` and leaves the issued label on the old value.
