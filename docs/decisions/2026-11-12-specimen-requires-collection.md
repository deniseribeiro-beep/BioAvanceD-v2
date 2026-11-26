# 2026-11-12: A specimen is registered only into a collection; createSample refuses one with no collectionId

Requirement RF004 AC2, AC3, AC7. Dictionary ELM-0118 (Specimen.collectionId), ELM-0117 (Specimen.participantId), V2E-0427 (Collection.governanceRegime). Issue #1497.

## The question

`createSample` ran the collection governance gate (RF004 AC2, AC3, AC7) only when a `collectionId` was given, so a specimen sent without one skipped the regime requirement entirely. Should a specimen of human research material created without a `collectionId` be refused?

## Decided

`[inference]`, by the coordinator for #1497, on 2026-11-12, from the pattern of `2026-11-10-research-resource-structures.md` item 2: required fields follow the dictionary's 1..1 Core rows. ELM-0118 `collectionId` is 1..1 Core for every Specimen.

1. **`createSample` refuses a specimen with no `collectionId` with a 422**, when the field is absent, null or blank, before the collection gate reads `collections`. The message is `collectionId é obrigatório: a amostra precisa de uma coleção com regime de governança (RF004 AC2, ELM-0118)`. Every caller of `createSample` gets the rule: `POST /api/samples` (through `RegisterSample.js`), the user route's sample create in `user.routes.js`, the intake wizard (`intakeWizard.js`) and the batch import (`batch-validation-engine.service.js`). `docs/api/openapi.json` lists `collectionId` as required on `POST /api/samples`.
2. **No exemption for non-human or non-research material.** ELM-0118 is 1..1 Core for every Specimen, ELM-0117 `participantId` is 1..1 too, and no Specimen element marks material as non-human or non-research. Collection's P1X-0047 `sampleSource` describes a collection, not an exemption for a specimen.
3. **Consequence:** every new specimen carries a collection, so access evaluation's collection and custody reasons (#1495) now apply to all of them.

## Not decided here

- **The writers that store samples without `createSample`** (#1538): `import-lgpd.service.js`, `import.service.js` `importSamples` (the JSON sample import) and the ingestion Specimen target. `canonical.v1.specimen` has no `collectionId`; see `2026-10-23-ingestion-specimen-target.md`.
- **Samples stored before this rule** are not migrated; `Sample.js` keeps a null `collectionId` default for them.
