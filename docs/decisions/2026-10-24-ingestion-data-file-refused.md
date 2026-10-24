# 2026-10-24: A DataFile or DataFileVersion sent to the production ingestion route is refused 422 INGESTION_STORE_UNSUPPORTED, naming Object Storage and the trusted upload and replace routes, and writes nothing

Requirement RF007 AC2; RF029 AC4, AC6, AC10; RNF029 C4. Issue #1318.

## The question

`POST /api/ingestion/records` persists eight entity types and refuses TelemetryReading by name (`docs/decisions/2026-10-24-ingestion-telemetry-reading-refused.md`). RF029 asks for further ones, and the file entities are next. `entityType: 'DataFile'` or `'DataFileVersion'` answered the generic 422 `INGESTION_TARGET_UNSUPPORTED` before the releases were read, which says nothing about why, and the `ingestionTargets.js` header said "Binaries are still absent." Can a DataFile or DataFileVersion be a target, registering its metadata only? If not, what does the route answer?

## Decided

`[inference]`, from the specification and the repo's pattern, by the coordinator for #1318, on 2026-10-24. The pattern, read off the existing targets and their records: the route refuses what it cannot place, rather than placing it in the wrong store or storing it as sent. OmicsRun's three Object Storage modalities are refused 422 `INGESTION_STORE_UNSUPPORTED` (`docs/decisions/2026-10-23-ingestion-omics-run-target.md`), Participant's and Consent's identity fields are refused, never quarantined as sent (`docs/decisions/2026-10-24-ingestion-consent-target.md`), and TelemetryReading is refused naming InfluxDB and its telemetry route.

1. **Neither is a target, not even for its metadata alone.**
   - (a) **A row would claim an object the server never received.** DataFile (ELM-0316..0325, V2E-0471..0476) holds `fileUri`, `checksum`, `fileSizeBytes`, `encryptionStatus` and `storageObjectVersion`, each 1..1 Core, and DataFileVersion (V2E-0346..0353) is "MongoDB metadata; Object Storage binary", with `objectUri` and `checksum` 1..1. Written from a client payload, those fields would state a URI, checksum, size, encryption and object version for bytes this route never carried.
   - (b) **The trusted path is what makes those fields true.** RF007 AC2 has the server "Calcular checksum e armazenar o binário exclusivamente no Object Storage". `sample-file.controller.js` and `createLinkedFileController.js` scan the plaintext (RNF029 C4, `docs/decisions/2026-10-23-data-file-malware-scan.md`), check the file signature, encrypt, and `putObject` a content-addressed object whose `getObject` refuses bytes that do not hash to their key (`docs/decisions/2026-10-23-data-file-object-storage.md`). A registered row would name an object that path never wrote, and its downloads read `storagePath`.
   - (c) **The route's transaction has no Object Storage part.** RF029 AC4 keeps "binários no Object Storage"; the route's write is a MongoDB document and its outbox event in one transaction (RF029 AC6), and it carries no bytes.
   - (d) **The gates differ.** The sample upload is `requirePermission('uploadSampleFiles')` plus organization scope, the assay upload is `requireRole(3, 4)` plus organization scope, and each runs a link check (`resolveLinkedEntityRefs`, `docs/decisions/2026-10-23-data-file-links-and-core-companions.md`) before the write. The ingestion route is `requireRole(3, 4)` only, so registering through it would open a second way to attach a file to a specimen, assay or dataset.
2. **Each is refused by name.** `ingestionTargets.js` `OTHER_STORE_ENTITY_TYPES` gains two frozen entries after `TelemetryReading`, and every entry gains a `record` key, the noun the refusal tells the caller to register:
   - `DataFile`: `store: 'objectStorage'`, `route: 'POST /api/samples/:specimenId/files/upload, POST /api/assays/:assayId/files/upload ou POST /api/datasets/:datasetId/files/upload'`, `record: 'o arquivo'`;
   - `DataFileVersion`: `store: 'objectStorage'`, `route: 'PUT /api/samples/:specimenId/files/:fileID/replace, PUT /api/assays/:assayId/files/:fileID/replace ou PUT /api/datasets/:datasetId/files/:fileID/replace'`, `record: 'a nova versão do arquivo'`;
   - `TelemetryReading` keeps its store and route and gains `record: 'a leitura'`.

   `objectStorage` is the store key OmicsRun's `otherStore` already uses. Only the dictionary names are named; `SampleFile`, `File`, `dataFile` and `DataFileVersions` stay unknown and answer `INGESTION_TARGET_UNSUPPORTED` before the releases are read.
3. **The message is built per store.** `productionIngestion.js` replaces its store names with a phrase per store, `influxdb: 'é armazenado no InfluxDB'` and `objectStorage: 'tem seu binário no Object Storage'`, and refuses with "`<entityType> <phrase>`, não suportado pela ingestão; registre `<record>` por `<route>`". For DataFile that reads "DataFile tem seu binário no Object Storage, não suportado pela ingestão; registre o arquivo por POST /api/samples/:specimenId/files/upload, ..."; the TelemetryReading message is unchanged byte for byte.
4. **The flow is the TelemetryReading one.** The refusal comes after both releases are read, so an inactive or missing canonical release answers 503 `CANONICAL_RELEASE_NOT_ACTIVE` first; it is stamped with both release ids (CFG-004), reads neither the payload nor the idempotency key, holds no payload value, and writes no document, quarantine record, idempotency key, MissingDataReason, DataQualityAssessment or outbox event. The route writes its one `INGESTION_REFUSED` warning row naming both release ids (RF029 AC10).

## Not decided here

- **Registering metadata for a binary already held in Object Storage.** It needs a server-side verification of the object (its existence, hash, size and encryption) before a row may claim it.
- **Linking an ingested record to an existing DataFile.**
- **Specimen storage allocation.**
