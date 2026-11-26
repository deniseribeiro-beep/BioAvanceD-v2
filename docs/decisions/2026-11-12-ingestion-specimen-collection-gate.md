# 2026-11-12: the ingestion Specimen target carries collectionId and runs the sample mount's collection gate

Requirement RF004 AC2, AC3, AC7, RF029 AC2, AC3. Dictionary ELM-0118 (`Specimen.collectionId`, 1..1 Core). Issues #1538, #1497, #1318.

## The question

`POST /api/ingestion/records` with `entityType: 'Specimen'` stores a sample behind the sample mount's participant, consent, site, parent and barcode gates, but not its collection gate, and `canonical.v1.specimen` refuses a `collectionId` outright. Since #1497 the mount (`createSample`) refuses a specimen that names no governed collection. Does the ingestion Specimen target carry and gate `collectionId`, or quarantine a specimen lacking one?

## Decided

`[inference]`, by the coordinator for #1538, on 2026-11-12, from the pattern of `2026-10-23-ingestion-specimen-target.md` (a target reuses what its master-data mount enforces, so ingesting is never a way around a gate the mount holds; the route refuses rather than corrects, RF029 AC3) and from ELM-0118, `Specimen.collectionId` 1..1 Core.

1. **`canonical.v1.specimen` admits an optional non-empty `collectionId`.** It is not in `required`: the gate refuses its absence with its own violation, and the intake wizard keeps validating its specimen without the field and hands it to `createSample`, which gates it.
2. **`validateSpecimenReferences` runs the mount's own collection gate last** (`sample-collection-gate.service.js` `assertSampleCollectionAdmits`, the one `createSample` and the imports run), after the barcode checks. Each refusal quarantines the record as sent:

   | gate | refusal | violation code |
   |---|---|---|
   | the specimen names a `collectionId` | 409 | `COLLECTION_REQUIRED` |
   | the `collectionId` resolves in `collections` | 404 | `REFERENCE_NOT_FOUND` |
   | the collection's regime, context or approval admits registration, and a biorepository's study and protocol are not contradicted by the specimen | 409 | `COLLECTION_NOT_ADMITTED` |

   A failed lookup is a failure, not a verdict: it rethrows, with no quarantine and no write, as the other gates' lookups do.
3. **`collectionId` is not a missingness field.** The gate refuses an absent `collectionId`, so it is never stored absent (the rule of item 7 of the 2026-10-23 record), and the MissingDataReason fields stay `barcode`, `linkedProject`, `parentSpecimenIds`, `merkleRoot` and `sprec`.
4. **This settles the `collectionId` part of the 2026-10-23 record's "Not decided here".** The `studyId` and `protocolId` gates stay undecided there: those fields are still not in `canonical.v1.specimen`, so a body that sends one quarantines.
