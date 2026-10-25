# 2026-10-25: an ingested Specimen is stored unallocated, and a barcode it carries is issued as its LabelIdentifier

Requirement RF029 AC3, AC7, RF016 AC4, RF017 AC2, AC8, RULE-012. Dictionary ELM-0116 (barcode), V2E-0169 (LabelIdentifier.encodedValue), V2E-0176 (LabelIdentifier.issuedBy). Issues #1318, #1378.

## The question

`POST /api/ingestion/records` persists a Specimen into `samples` (`2026-10-23-ingestion-specimen-target.md`), which left storage allocation and the LabelIdentifier the sample mount issues at registration undecided. An accepted Specimen carrying a `barcode` stored `Sample.barcode` and got no LabelIdentifier, no Container and no SpecimenContainerAssignment, while the sample mount and both imports issue a given code as a LabelIdentifier (#1378). Does ingestion allocate the specimen, and what does it do with a barcode it is sent?

## Decided

`[inference]`, from the specification and the repo's pattern, by the coordinator for #1318, on 2026-10-25. The pattern: every writer of a sample code issues a given code as a LabelIdentifier (the sample mount, `importSamples`, the LGPD import, the barcode migration), and every writer that allocates takes a location its caller names (the mount's required `boxId` and `positionCode`, the LGPD import's row location or operator-chosen start box), while `importSamples` stores a specimen unallocated.

1. **No storage allocation at ingestion.** `canonical.v1.specimen` has no placement field and `additionalProperties: false` (`api/backend/src/contracts/canonical/v1/index.js`), so a record naming a box quarantines, and the server never picks a position (RF029 AC3: refuse rather than correct). The specimen stays unallocated (specimen-target item 8) and is placed later through `POST /api/storage/allocate` or `POST /api/storage/allocate/auto`, which run the location gates (RF017 AC2, AC8).
2. **A given barcode is issued as an unprinted LabelIdentifier** (V2E-0169, RF016 AC4) through `issueSpecimenLabel`, on a container created and loaded for the specimen, in the insert's transaction (`specimenTarget.js` `appendSpecimenProjection`). It is issued by the acting user, else the stamped organization (V2E-0176). No position is written, no print batch is opened and no LabelPrintEvent is recorded.
3. **No code is generated** for a record without one: `barcode` is a missingness field (specimen-target item 7), so its absence is a MissingDataReason (RF029 AC7), as `importSamples` generates none.
4. **The duplicate gate also reads the active labels** in namespace `legacy-sample-barcode`, refusing 409 `DUPLICATE_BARCODE`, since a sample's barcode can move while its label stays active on the old value; the record quarantines as sent rather than being corrected (RF029 AC3). **A barcode carrying whitespace, an e-mail or a CPF** (RULE-012), which the label model refuses, is refused 422 `BARCODE_PERSONAL_DATA` before the gateway, through the target's `labelFields` (`productionIngestion.js`), as civil identity fields are (#575): a quarantine would store the value as sent, so nothing is written, no quarantine record, idempotency key or assessment, and the response and its `INGESTION_REFUSED` audit row name the kind, never the value. The refusal holds for a model-invalid record too, and under a key already recorded.
5. **Once the window is closed** the barcode is refused as before (`LEGACY_BARCODE_WRITE_REFUSED`); nothing changes there.
6. **No removal hook is needed** for the no-transaction race, while the unique barcode index `samples_barcode_unique_v2` exists. A loser that carries a barcode then fails at its `samples` insert before `appendProjection` runs, and a loser without one issues no label. A failed build of that index only logs a warning (`sampleIndexes.js`), and then this item does not hold.

## Not decided here

- **Printing** (LabelPrintEvent, print batch) on the ingestion route.
- **The no-transaction path** leaving the sample, its outbox event, and its container and load when a label issue fails mid-write, as any `appendProjection` failure there does today.
- **The no-transaction race without `samples_barcode_unique_v2`.** A same-key loser that carries a barcode leaves a duplicate-barcode sample, a container, a load and an outbox event, and answers `LABEL_EXISTS` instead of a replay. A same-key retry then quarantines `DUPLICATE_BARCODE` against its own orphan.
