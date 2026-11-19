# Changelog toward the canonical model v2.0.0

Answers RNF006 C3 ("Referenciar o modelo canônico v2.0.0 e registrar changelog e migração."), its reference and changelog part; the migration part is [migration-and-rollback.md](migration-and-rollback.md). Written 2026-11-13. It describes what the code does at this commit, nothing more; everything the model release asks for that no decision or code covers, where a source says so, is listed under [Gaps](#4-gaps), never as a procedure. Tracking issue: #1472.

Sources: `docs/RELEASE_MANIFEST.json`, `docs/extracted-v2.0.0/INDEX.md`, `docs/extracted-v2.0.0/dict-CHANGELOG.md`, `api/backend/src/reference-data/canonical-dictionary/v2.js`, `api/backend/src/reference-data/canonical-dictionary/index.js`, `api/backend/src/foundation/readiness.js`, `api/backend/src/governance/registry.js`, `docs/architecture/canonical-active-surface.md`, and the first heading line of every file under `docs/decisions/`.

Related: [migration-and-rollback.md](migration-and-rollback.md) (the three phases, their gates, the v1.3.0 to v2.0.0 migration and rollback), [install-runbook.md](install-runbook.md), [configuration-runbook.md](configuration-runbook.md), [mapping-limits.md](mapping-limits.md).

## 1. The canonical model release

- **Release**, as `docs/RELEASE_MANIFEST.json` names it: `BioAvanceD Canonical Data Model v2.0.0`, `releaseStatus` `approved`, `documentaryState` `final`, `approvedOn` 2026-09-12, `approvalScope` `documentary_release`. The manifest's own statement: "A aprovação documental da release não constitui execução, aprovação de resultado ou homologação do ensaio ex ante."
- **Artifacts**, each with its sha256 in the manifest:
  - `BioAvanceD_Modelo_Persistencia_Poliglota_v2.0.0.docx`
  - `BioAvanceD_Pacote_Exemplos_JSON_Persistencia_Poliglota_v2.0.0.zip`
  - `BioAvanceD_Protocolo_Avaliacao_Ex_Ante_Identificacao_Fisica_v1.0.0.docx`
  - `BioAvanceD_Exemplos_Registros_Sinteticos_v2.0.0.json`
  - `BioAvanceD_Requisitos_Funcionais_Nao_Funcionais_v4.0.0.docx`
  - `BioAvanceD_Relatorio_Consistencia_Modelo_v2.0.0.docx`
  - `BioAvanceD_Plano_Integrado_Foundation_Data_Pipeline_v2.0.0.docx`
  - `BioAvanceD_Matriz_Rastreabilidade_Modelo_v2.0.0.xlsx`
  - `BioAvanceD_Dicionario_Dados_Consolidado_v2.0.0.xlsx`
- **Extracted copy**: `docs/extracted-v2.0.0/`, listed with each source's sha256 in `docs/extracted-v2.0.0/INDEX.md`. It is generated, never hand-edited.
- **The physical identification protocol** v1.0.0 is a separate entry of the manifest (`physicalIdentificationProtocol`): `approved_for_execution`, executed on synthetic fixtures only (`executionStatus` `executed_synthetic`, `result` `pass`, 2026-11-03), its evidence `docs/evidencias/homologacao-runtime/RF016-ex-ante-sintetico-v1.0.0.md` and its instrument `tests/e2e/physical-chain.spec.ts`.

## 2. What the code loads

- **Catalog v2.0.0**: `api/backend/src/reference-data/canonical-dictionary/v2.js` loads `catalog.2.0.0.json` (`DICTIONARY_VERSION` `2.0.0`, 1644 elements in 146 entities, with the 929 historical ones), generated from `docs/extracted-v2.0.0/dict-DICIONARIO.md` by `api/backend/scripts/generate-dictionary-catalog.js`. It is what `api/backend/src/foundation/readiness.js`, `api/backend/src/governance/registry.js`, `api/backend/src/ingestion/productionIngestion.js`, `api/backend/src/governance/dataClasses.js` and the Foundation job `api/backend/scripts/seed-essential-reference-data.js` read.
- **Catalog v1.3.0**: `api/backend/src/reference-data/canonical-dictionary/index.js` loads `catalog.1.3.0.json` (929 elements). `v2.js` also loads it, to check that every v1.3.0 element id is still present in v2.0.0. Outside that check it is read by `api/backend/scripts/generate-dictionary-catalog.js` and `api/backend/scripts/validate-dictionary-catalog.js`.
- **Release id**: `readiness.js` derives `CANONICAL_MODEL_RELEASE_ID` (`release-2.0.0`) and `MIGRATION_PLAN_ID` (`migration-1.3.0-to-2.0.0`) from `DICTIONARY_VERSION`. The Foundation job registers the CanonicalModelRelease under that id with the manifest's artifacts and their sha256 plus the generated catalog (`registerGovernance` in `registry.js`), and the API starts only on a `ready` ReadinessReport naming it (`assertReadiness`, when `FOUNDATION_READINESS_REQUIRED` is set, as `compose.prod.yml` sets it).
- **The model's own changelog** is `docs/extracted-v2.0.0/dict-CHANGELOG.md` (from the dictionary's CHANGELOG sheet): what changed in the model between v1.3.0 and v2.0.0, dated 2026-09-07 to 2026-09-12. It is not repeated here. Section 3 is the platform's changelog: what the code changed toward that model, one line per decision record.

## 3. The platform's changes, by area

One line per file under `docs/decisions/`: its date, what it decided, and the file. A decision states what the code does at its date; a later decision on the same subject says so in its own text.

### 3.1 Identity, accounts and access

- 2026-10-07: what ends an account's sessions, and a logical delete of an account. [account-lifecycle-and-logical-delete](../decisions/2026-10-07-account-lifecycle-and-logical-delete.md)
- 2026-10-07: a recovery code is redeemed at the MFA step of sign-in, once. [recovery-code-redemption](../decisions/2026-10-07-recovery-code-redemption.md)
- 2026-10-07: recovery code sets use their dictionary names; each generation is a new set. [recovery-code-set-names](../decisions/2026-10-07-recovery-code-set-names.md)
- 2026-10-11: report grants use their dictionary names. [access-grant-names](../decisions/2026-10-11-access-grant-names.md)
- 2026-10-11: sessions use their dictionary names. [session-names](../decisions/2026-10-11-session-names.md)
- 2026-10-11: user accounts use their dictionary names. [user-account-names](../decisions/2026-10-11-user-account-names.md)
- 2026-10-13: a scoped caller may link a sample to another organization's participant, and writes nothing on it. [participant-cross-organization-link](../decisions/2026-10-13-participant-cross-organization-link.md)
- 2026-10-16: a one-off migration moves users and sessions off their legacy names. [auth-legacy-name-migration](../decisions/2026-10-16-auth-legacy-name-migration.md)
- 2026-10-16: user accounts keep `createdAt` and `updatedAt` as local extensions. [user-account-timestamps](../decisions/2026-10-16-user-account-timestamps.md)
- 2026-10-17: an organization-scoped caller manages the users of its own organizations only. [org-scoped-user-management](../decisions/2026-10-17-org-scoped-user-management.md)
- 2026-10-17: ParticipantIdentity's stored ciphertext names, and which of its missing elements are built. [participant-identity-names-and-fields](../decisions/2026-10-17-participant-identity-names-and-fields.md)
- 2026-10-17: seven UserAccount elements stay absent from the user document. [user-account-absent-elements](../decisions/2026-10-17-user-account-absent-elements.md)
- 2026-10-27: the Técnico reaches the report screens; seeded permission codes whose routes no screen calls stay API-only. [role-routes-and-seeded-permissions](../decisions/2026-10-27-role-routes-and-seeded-permissions.md)
- 2026-10-28: a birth date is stored at 12:00 UTC of its calendar day. [birth-date-noon-utc](../decisions/2026-10-28-birth-date-noon-utc.md)
- 2026-11-09: an AccessPolicy scopes by study, protocol and collection through its conditions. [access-policy-scope-conditions](../decisions/2026-11-09-access-policy-scope-conditions.md)
- 2026-11-11: an AccessPolicy scopes by biobank through a `biobankId` condition, read off the item's collection. [access-policy-biobank-scope](../decisions/2026-11-11-access-policy-biobank-scope.md)

### 3.2 Consent

- 2026-10-08: a consent's state is derived from its decision events and revocations. [consent-history](../decisions/2026-10-08-consent-history.md)
- 2026-10-09: governed purpose codes on a term's permissions, and a partial revocation judged on them. [consent-purpose-codes](../decisions/2026-10-09-consent-purpose-codes.md)
- 2026-10-09: one active consent term per lineage, and one write path. [consent-term-lineages](../decisions/2026-10-09-consent-term-lineages.md)

### 3.3 Collections, biobanks and research structures

- 2026-10-08: a collection's governance context, its approvals, and the event that sets or converts it. [collection-governance](../decisions/2026-10-08-collection-governance.md)
- 2026-10-17: an import batch's tenancy key is its `organizationId`; an unstamped batch is read by global scope only. [import-batch-tenancy](../decisions/2026-10-17-import-batch-tenancy.md)
- 2026-10-23: Network and Biobank are modelled and entered by an administrator. [network-biobank-structures](../decisions/2026-10-23-network-biobank-structures.md)
- 2026-10-25: Study and WorkflowRun are shared across organizations; their master-data mounts stay unscoped. [study-and-workflow-run-organization-scope](../decisions/2026-10-25-study-and-workflow-run-organization-scope.md)
- 2026-11-10: ResearchResource and its Collection and Biobank links are stored, entered by an administrator. [research-resource-structures](../decisions/2026-11-10-research-resource-structures.md)

### 3.4 Specimen and containers

- 2026-10-11: a sample's tenancy key is `Sample.organizationId`, not its collection site. [sample-tenancy](../decisions/2026-10-11-sample-tenancy.md)
- 2026-10-13: a specimen's generated code is issued as a LabelIdentifier on its container. [specimen-label-issuance](../decisions/2026-10-13-specimen-label-issuance.md)
- 2026-10-13: every sample is created with a `specimenRole`. [specimen-role](../decisions/2026-10-13-specimen-role.md)
- 2026-10-23: the W8 showcase case shows the storage picker, the derived status and closing, and names disposition, custody and the physical chain as not demoed. [w8-showcase-scope](../decisions/2026-10-23-w8-showcase-scope.md)
- 2026-11-12: which RF019 triggers quarantine a specimen. [rf019-quarantine-triggers](../decisions/2026-11-12-rf019-quarantine-triggers.md)
- 2026-11-12: a specimen is registered only into a collection; `createSample` refuses one with no `collectionId`. [specimen-requires-collection](../decisions/2026-11-12-specimen-requires-collection.md)

### 3.5 Storage and locations

- 2026-10-11: a legacy box placement is written as the normalized physical chain. [legacy-placement-chain](../decisions/2026-10-11-legacy-placement-chain.md)
- 2026-10-14: every Facility and Room is mirrored as a StorageLocation. [facility-room-locations](../decisions/2026-10-14-facility-room-locations.md)

### 3.6 Telemetry

- 2026-10-17: a telemetry reading carries `datastreamId` and `storageLocationId`, the location taken from its datastream. [telemetry-reading-datastream-and-location](../decisions/2026-10-17-telemetry-reading-datastream-and-location.md)
- 2026-10-17: `POST /api/iot/telemetry` judges a bound reading against its datastream's threshold profile. [telemetry-threshold-from-datastream](../decisions/2026-10-17-telemetry-threshold-from-datastream.md)
- 2026-10-21: the cold-chain quarantine also quarantines the specimens the physical chain puts at the excursion's location. [cold-chain-quarantine-through-chain](../decisions/2026-10-21-cold-chain-quarantine-through-chain.md)
- 2026-10-21: each SensorMetadata row's binding is moved onto a temperature TelemetryDatastream by a one-shot migration. [sensor-metadata-to-datastream-migration](../decisions/2026-10-21-sensor-metadata-to-datastream-migration.md)
- 2026-10-21: the policy and freezer readers of SensorMetadata read the TelemetryDatastream first. [sensor-readers-from-datastream](../decisions/2026-10-21-sensor-readers-from-datastream.md)
- 2026-10-21: sensor registration and edit write the sensor's temperature TelemetryDatastream. [sensor-registration-writes-datastream](../decisions/2026-10-21-sensor-registration-writes-datastream.md)
- 2026-10-21: `TELEMETRY_BINDING_MODE` defaults to `enforce`. [telemetry-binding-enforce-default](../decisions/2026-10-21-telemetry-binding-enforce-default.md)
- 2026-10-21: a telemetry client `idempotencyKey` replays from RF029's key store, not from the `temperatures` copy. [telemetry-client-key-store](../decisions/2026-10-21-telemetry-client-key-store.md)
- 2026-10-21: RNF004 C1's edge buffer lives on the device; only a 2xx confirms a reading. [telemetry-edge-buffer](../decisions/2026-10-21-telemetry-edge-buffer.md)
- 2026-10-21: a specimen's temperature exposure is a TelemetryExposureSummary per piece of its assignment path. [telemetry-exposure-summary](../decisions/2026-10-21-telemetry-exposure-summary.md)
- 2026-10-21: the MongoDB `temperatures` copy of a telemetry reading is retired; its existing data is left in place. [telemetry-temperatures-copy-retired](../decisions/2026-10-21-telemetry-temperatures-copy-retired.md)
- 2026-11-12: a telemetry reading carrying fields outside its contract is stored with them stripped and flagged, never refused. [telemetry-personal-data-stripped](../decisions/2026-11-12-telemetry-personal-data-stripped.md)
- 2026-11-18: RULE-025 aligned to the gold standard — strip/refuse PII persistence, keep a trustworthy contract measurement, quarantine and security audit (supersedes the 2026-11-12 record on #1547). [telemetry-rule-025-gold-standard](../decisions/2026-11-18-telemetry-rule-025-gold-standard.md)
- 2026-11-19: every telemetry ingest path (IoT API, MQTT, both temperature routes, the temperature import and the iot-queue) strips the fields outside its own contract list at receipt, hashes the contract fields only, flags the kept reading and writes one `TELEMETRY_PII_STRIPPED` security audit per received payload carrying such a field, naming the fields, never a value; an untrustworthy reading is still refused whole. [telemetry-rule-025-every-ingest-path](../decisions/2026-11-19-telemetry-rule-025-every-ingest-path.md)

### 3.7 Files

- 2026-10-22: a DataFile delete is logical, and the binary is kept. [data-file-logical-delete](../decisions/2026-10-22-data-file-logical-delete.md)
- 2026-10-22: a file replace writes DataFileVersion rows and keeps the previous binary. [data-file-versions](../decisions/2026-10-22-data-file-versions.md)
- 2026-10-23: a DataFile records its canonical MIME type, its owner and every entity it is linked to. [data-file-links-and-core-companions](../decisions/2026-10-23-data-file-links-and-core-companions.md)
- 2026-10-23: every DataFile upload and replace passes its plaintext through a malware-scan hook, and the row records the verdict. [data-file-malware-scan](../decisions/2026-10-23-data-file-malware-scan.md)
- 2026-10-23: a DataFile binary is written once to a content-addressed object through one store interface. [data-file-object-storage](../decisions/2026-10-23-data-file-object-storage.md)
- 2026-10-23: `OBJECT_STORE_DRIVER` selects the DataFile object store. [data-file-object-store-driver](../decisions/2026-10-23-data-file-object-store-driver.md)
- 2026-10-23: a DataFile records the active DataFile RetentionPolicy, and its versions carry it. [data-file-retention-policy](../decisions/2026-10-23-data-file-retention-policy.md)
- 2026-10-23: an S3-compatible adapter sits behind the DataFile object-store interface. [data-file-s3-object-store](../decisions/2026-10-23-data-file-s3-object-store.md)
- 2026-10-23: a DataFile download is served through a short-lived, single-file signed token; every use and refusal is audited. [data-file-time-limited-access](../decisions/2026-10-23-data-file-time-limited-access.md)
- 2026-10-23: an upload's extension, MIME type and leading bytes must agree. [upload-mime-extension-signature](../decisions/2026-10-23-upload-mime-extension-signature.md)
- 2026-10-24: the key-rotation rewrite re-encrypts DataFile binaries held in the object store. [data-file-key-rotation-rewrite](../decisions/2026-10-24-data-file-key-rotation-rewrite.md)
- 2026-10-30: legacy DataFile rows whose binary is on local disk are migrated into the object store. [data-file-legacy-disk-rows-migration](../decisions/2026-10-30-data-file-legacy-disk-rows-migration.md)
- 2026-10-30: a quarantined import's retained source file goes into the DataFile object store. [import-source-file-object-store](../decisions/2026-10-30-import-source-file-object-store.md)
- 2026-10-30: the test stack stores DataFile binaries in an S3-compatible service. [test-stack-s3-object-store](../decisions/2026-10-30-test-stack-s3-object-store.md)

### 3.8 Reference data

- 2026-10-22: a full reference import preserves its source asset in object storage, content-addressed by its checksum. [reference-release-asset-preserved](../decisions/2026-10-22-reference-release-asset-preserved.md)
- 2026-10-22: a reference import registers its ReferenceDatasetRelease before the load, and that release ends `active` or `rejected`. [reference-release-registered-before-load](../decisions/2026-10-22-reference-release-registered-before-load.md)
- 2026-10-23: BiomarkerAssociation is modelled and entered by an administrator. [biomarker-association-store](../decisions/2026-10-23-biomarker-association-store.md)
- 2026-10-23: the disease-specific biomarker knowledge moves off `disease_dictionary` onto BiomarkerAssociation. [biomarker-knowledge-off-disease-dictionary](../decisions/2026-10-23-biomarker-knowledge-off-disease-dictionary.md)
- 2026-10-23: the essential-reference loader registers a ReferenceDatasetRelease per entry before its load, writes its coverage manifest and assessment, and promotes it through `promoteRelease`. [essential-reference-releases](../decisions/2026-10-23-essential-reference-releases.md)
- 2026-10-23: a full reference import writes a ReferenceCoverageManifest and a release DataQualityAssessment; promotion refuses a release without passing ones. [reference-release-coverage-manifest](../decisions/2026-10-23-reference-release-coverage-manifest.md)
- 2026-10-23: an approved reference release is promoted explicitly, rolled back through a route, and each change writes an AuditEvent. [reference-release-explicit-promotion](../decisions/2026-10-23-reference-release-explicit-promotion.md)
- 2026-10-24: a frontend entry screen for BiomarkerAssociation, at `/biomarker-associations`, for Administrador and Coordenador. [biomarker-association-entry-screen](../decisions/2026-10-24-biomarker-association-entry-screen.md)
- 2026-10-24: one BiomarkerAssociation row per `biomarkerId`, held by a unique index. [biomarker-association-unique-index](../decisions/2026-10-24-biomarker-association-unique-index.md)
- 2026-10-27: the Orphadata bulk sync is retired, not rerouted into the reference-release path. [orphadata-bulk-sync-retired](../decisions/2026-10-27-orphadata-bulk-sync-retired.md)
- 2026-10-29: production loads the essential reference set through compose one-shot services; full packs and operational data arrive by restore or by an operator-run import. [production-reference-data](../decisions/2026-10-29-production-reference-data.md)

### 3.9 Ingestion

- 2026-10-22: each ingested record gets a DataQualityAssessment, recorded and never gating. [ingestion-data-quality-assessment](../decisions/2026-10-22-ingestion-data-quality-assessment.md)
- 2026-10-22: an absent field on the ingestion path gets a MissingDataReason, declared beside the payload or `unknown`. [ingestion-missing-data-reasons](../decisions/2026-10-22-ingestion-missing-data-reasons.md)
- 2026-10-23: OmicsQualification is the third entity type the production ingestion route persists. [ingestion-omics-qualification-target](../decisions/2026-10-23-ingestion-omics-qualification-target.md)
- 2026-10-23: Assay is the fourth. [ingestion-assay-target](../decisions/2026-10-23-ingestion-assay-target.md)
- 2026-10-23: OmicsRun is the fifth, for its MongoDB modalities only. [ingestion-omics-run-target](../decisions/2026-10-23-ingestion-omics-run-target.md)
- 2026-10-23: Specimen is the sixth, behind the sample mount's participant, consent, parent, site and barcode gates. [ingestion-specimen-target](../decisions/2026-10-23-ingestion-specimen-target.md)
- 2026-10-23: a quarantined ingestion record keeps the client's `missingDataReasons` as received. [ingestion-quarantine-keeps-missing-data-reasons](../decisions/2026-10-23-ingestion-quarantine-keeps-missing-data-reasons.md)
- 2026-10-24: Participant is the seventh, and a record carrying civil identity is refused. [ingestion-participant-target](../decisions/2026-10-24-ingestion-participant-target.md)
- 2026-10-24: Consent is the eighth, accepting only a granted, dated consent for a participant with none in force. [ingestion-consent-target](../decisions/2026-10-24-ingestion-consent-target.md)
- 2026-10-24: a DataFile or DataFileVersion sent to the ingestion route is refused 422 `INGESTION_STORE_UNSUPPORTED` and writes nothing. [ingestion-data-file-refused](../decisions/2026-10-24-ingestion-data-file-refused.md)
- 2026-10-24: a TelemetryReading sent to the ingestion route is refused 422 `INGESTION_STORE_UNSUPPORTED`, naming InfluxDB and the telemetry route, and writes nothing. [ingestion-telemetry-reading-refused](../decisions/2026-10-24-ingestion-telemetry-reading-refused.md)
- 2026-10-25: an ingested Consent may supersede the participant's consent in force, only when the record names it and its decision is newer. [ingestion-consent-supersession](../decisions/2026-10-25-ingestion-consent-supersession.md)
- 2026-10-25: an ingested Specimen is stored unallocated, and a barcode it carries is issued as its LabelIdentifier. [ingestion-specimen-storage-and-label](../decisions/2026-10-25-ingestion-specimen-storage-and-label.md)
- 2026-11-12: the ingestion route takes an optional `provenance.accessPolicyId`, accepted only when every named AccessPolicy is in force and applicable. [ingestion-access-policy](../decisions/2026-11-12-ingestion-access-policy.md)
- 2026-11-12: the ingestion Specimen target carries `collectionId` and runs the sample mount's collection gate. [ingestion-specimen-collection-gate](../decisions/2026-11-12-ingestion-specimen-collection-gate.md)
- 2026-11-12: an ingested Specimen's unit is a code of the active UCUM reference release, else the record quarantines `INACTIVE_OR_UNKNOWN_CODE`. [ingestion-specimen-unit](../decisions/2026-11-12-ingestion-specimen-unit.md)
- 2026-11-12: the ingestion route keeps no transient state, proves telemetry convergence on the telemetry routes, and proves its transaction in the backend unit suite. [ingestion-transient-state-telemetry-and-atomicity](../decisions/2026-11-12-ingestion-transient-state-telemetry-and-atomicity.md)

### 3.10 Specimen quality (RCS)

- 2026-10-22: the RCS v4 frozen inputs are modelled first, written by no flow, with no score change. [rcs-input-snapshot-structures](../decisions/2026-10-22-rcs-input-snapshot-structures.md)
- 2026-10-23: the RCS assessment records each axis's resolution status and the reasons for its route. [rcs-axis-results-and-route-reasons](../decisions/2026-10-23-rcs-axis-results-and-route-reasons.md)
- 2026-10-23: the RCS assessment write keeps the six governance criteria, with the rule set's version and checksum. [rcs-governance-evidence](../decisions/2026-10-23-rcs-governance-evidence.md)
- 2026-10-23: the RCS assessment write freezes the input it was computed from, with no score change. [rcs-input-snapshot-write](../decisions/2026-10-23-rcs-input-snapshot-write.md)
- 2026-10-23: an RCSAssessment keeps its rule package, execution environment and justifications, states that the RCS is not clinical validity, and is never edited. [rcs-rule-package-and-scope](../decisions/2026-10-23-rcs-rule-package-and-scope.md)
- 2026-10-23: the SPREC codes, severities and weights are a versioned mapping release, named by the input snapshot and each resolved axis. [rcs-sprec-mapping-release](../decisions/2026-10-23-rcs-sprec-mapping-release.md)
- 2026-10-23: live registration carries its use context to the RCS assessment; a sent context must name all five fields. [rcs-use-context-required](../decisions/2026-10-23-rcs-use-context-required.md)
- 2026-10-23: the RCS matrix is resolved by a versioned mapping release, recorded in the input snapshot. [rcs-versioned-matrix-mapping](../decisions/2026-10-23-rcs-versioned-matrix-mapping.md)
- 2026-10-24: an RCSAssessment records its context's assay family and workflow protocol top-level. [rcs-assessment-assay-family-and-workflow-protocol](../decisions/2026-10-24-rcs-assessment-assay-family-and-workflow-protocol.md)
- 2026-10-24: an RCSAssessment records its result's own P_bio as `preanalyticalPenalty` and its 100 - P_bio score as `score`. [rcs-assessment-preanalytical-penalty-and-score](../decisions/2026-10-24-rcs-assessment-preanalytical-penalty-and-score.md)
- 2026-10-24: an RCSAssessment records the SPREC version its result was computed with. [rcs-assessment-sprec-version](../decisions/2026-10-24-rcs-assessment-sprec-version.md)
- 2026-10-24: RCSRulePackage is modelled as a frozen structure, with a SemVer version and a SHA-256 checksum. [rcs-rule-package-model](../decisions/2026-10-24-rcs-rule-package-model.md)
- 2026-10-24: the frontend states that the RCS is not clinical validity wherever it shows an RCS grade or score. [rcs-scope-ui-notice](../decisions/2026-10-24-rcs-scope-ui-notice.md)
- 2026-10-25: an RCSAssessment records its context's intended use and target analyte top-level. [rcs-assessment-intended-use-and-target-analyte](../decisions/2026-10-25-rcs-assessment-intended-use-and-target-analyte.md)
- 2026-10-25: RCSRulePackage is stored in `rcsRulePackages` and written by the Phase 2 essential-reference load, only when it validates, once per checksum. [rcs-rule-package-collection-and-writer](../decisions/2026-10-25-rcs-rule-package-collection-and-writer.md)
- 2026-10-27: RCSValidationStudy is modelled as a frozen structure written by no flow. [rcs-validation-study-model](../decisions/2026-10-27-rcs-validation-study-model.md)
- 2026-11-09: RCS certification reads traceability, monitoring and documentation evidence references, and refuses one that does not resolve. [rcs-governance-evidence-readers](../decisions/2026-11-09-rcs-governance-evidence-readers.md)
- 2026-11-10: RCS governance evidence keeps the URIs of the references that resolved in `evidenceRefs`. [rcs-governance-evidence-refs](../decisions/2026-11-10-rcs-governance-evidence-refs.md)
- 2026-11-12: the imports' governance evidence references. [rcs-governance-evidence-imports](../decisions/2026-11-12-rcs-governance-evidence-imports.md)
- 2026-11-12: the intake wizard resolves its governance evidence references before certification. [rcs-governance-evidence-intake](../decisions/2026-11-12-rcs-governance-evidence-intake.md)
- 2026-11-12: the RCS governance rule-set checksum covers the governance evidence rule. [rcs-governance-evidence-rule-set](../decisions/2026-11-12-rcs-governance-evidence-rule-set.md)
- 2026-11-12: sample registration resolves its governance evidence references before certification. [rcs-governance-evidence-sample-registration](../decisions/2026-11-12-rcs-governance-evidence-sample-registration.md)
- 2026-11-12: the JSON sample import and the sample edit store only a certified RCS result. [rcs-json-import-and-sample-edit](../decisions/2026-11-12-rcs-json-import-and-sample-edit.md)
- 2026-11-12: RCS `semanticCompatible` reads true on resolved axes and custody events, and the governance gate can pass. [rcs-semantic-compatible](../decisions/2026-11-12-rcs-semantic-compatible.md)
- 2026-11-12: SOP documentation evidence is the specimen's collection's governance approval. [rcs-sop-documentation-evidence](../decisions/2026-11-12-rcs-sop-documentation-evidence.md)

### 3.11 Clinical, omics, imaging and provenance

- 2026-10-22: the analytical-preparation entities are modelled as inactive structures, written by no flow. [inactive-analytical-preparation-structures](../decisions/2026-10-22-inactive-analytical-preparation-structures.md)
- 2026-10-23: DiagnosticReport is built as a full entity, and the three references to it are checked. [diagnostic-report-entity](../decisions/2026-10-23-diagnostic-report-entity.md)
- 2026-10-23: DiagnosticReport gets a create, read and per-participant list route. [diagnostic-report-route](../decisions/2026-10-23-diagnostic-report-route.md)
- 2026-10-23: ImagingDerivedData is modelled and entered by an administrator. [imaging-derived-data-structure](../decisions/2026-10-23-imaging-derived-data-structure.md)
- 2026-10-23: ImagingStudy is modelled and entered by an administrator. [imaging-study-structure](../decisions/2026-10-23-imaging-study-structure.md)
- 2026-10-23: a WorkflowRun records why it failed and which failed run it resumes. [workflow-run-failure-and-resume](../decisions/2026-10-23-workflow-run-failure-and-resume.md)
- 2026-10-23: WorkflowRun lineage is derived from shared file ids, never stored. [workflow-run-lineage](../decisions/2026-10-23-workflow-run-lineage.md)
- 2026-10-23: WorkflowRun carries its v2 provenance companions, the dataset snapshot optional until DatasetSnapshot is activated. [workflow-run-provenance-companions](../decisions/2026-10-23-workflow-run-provenance-companions.md)
- 2026-10-27: one WorkflowRun per `workflowRunId`, held by a unique index. [workflow-run-unique-id](../decisions/2026-10-27-workflow-run-unique-id.md)

### 3.12 Interoperability and FHIR

- 2026-10-22: InteroperabilityMappingRelease and FHIRProfileRegistry are modelled as Phase 1 structures. [interoperability-mapping-release-structures](../decisions/2026-10-22-interoperability-mapping-release-structures.md)
- 2026-10-23: WorkflowRun, AuditEvent, DataFile and Study export to FHIR R4 as pure transforms that force no equivalence. [fhir-export-provenance-auditevent-documentreference-researchstudy](../decisions/2026-10-23-fhir-export-provenance-auditevent-documentreference-researchstudy.md)
- 2026-10-23: FHIR staging records its round-trip loss, per record and per batch, as paths. [fhir-round-trip-loss-record](../decisions/2026-10-23-fhir-round-trip-loss-record.md)
- 2026-10-23: the FHIR validator checks the declared version, the declared profile and every `identifier.system`. [fhir-validator-version-profile-identifier-system](../decisions/2026-10-23-fhir-validator-version-profile-identifier-system.md)
- 2026-10-23: IdentifierNamespaceRegistry rows are stored, entered by an administrator, and read by the FHIR validator's `identifier.system` check. [identifier-namespace-registry-store](../decisions/2026-10-23-identifier-namespace-registry-store.md)
- 2026-10-23: InteroperabilityMappingRelease and FHIRProfileRegistry rows are stored, entered by an administrator, and the FHIR import validation reads the stored profiles. [interoperability-mapping-release-store](../decisions/2026-10-23-interoperability-mapping-release-store.md)
- 2026-10-23: Biobank and Collection are exported by the MIABIS mapping, with their national extensions and a round-trip loss report. [miabis-export](../decisions/2026-10-23-miabis-export.md)
- 2026-10-24: Provenance, AuditEvent, DocumentReference and ResearchStudy are exported one record at a time under `/api/export/fhir`, as a collection Bundle in an envelope that claims no release. [fhir-export-route-and-bundle](../decisions/2026-10-24-fhir-export-route-and-bundle.md)
- 2026-10-24: FHIR staging maps Provenance, AuditEvent, DocumentReference and ResearchStudy as pure inverse transforms and commits none. [fhir-import-provenance-auditevent-documentreference-researchstudy](../decisions/2026-10-24-fhir-import-provenance-auditevent-documentreference-researchstudy.md)
- 2026-10-25: a WorkflowRun's lineage is exported as one collection Bundle of Provenance resources. [fhir-export-workflow-run-lineage-bundle](../decisions/2026-10-25-fhir-export-workflow-run-lineage-bundle.md)
- 2026-10-25: FHIR import commits a staged ResearchStudy as a Study, only when absent and only for a Coordenador or Administrador. [fhir-import-research-study-commit](../decisions/2026-10-25-fhir-import-research-study-commit.md)
- 2026-11-06: RNF007 AC6 writes no DeidentificationProcess until an export's input is a DatasetSnapshot. [deidentification-process-on-exports](../decisions/2026-11-06-deidentification-process-on-exports.md)
- 2026-11-06: a FHIR import records the mapping releases its declared profiles name. [fhir-import-mapping-release](../decisions/2026-11-06-fhir-import-mapping-release.md)

### 3.13 Audit and encryption

- 2026-10-08: one audit event chain, its v4 fields, and how an event is verified. [audit-event-chain](../decisions/2026-10-08-audit-event-chain.md)
- 2026-10-08: one inventory of encrypted fields, and a checked step to retire the previous key. [encryption-key-rotation-rewrite](../decisions/2026-10-08-encryption-key-rotation-rewrite.md)

### 3.14 Backup

- 2026-10-30: backup runs stay out of the DataFile object store. [backup-files-outside-object-store](../decisions/2026-10-30-backup-files-outside-object-store.md)

### 3.15 Configuration and governance

- 2026-10-07: configuration validation runs, governance invariants and the canonical model release. [configuration-validation-and-governance-registry](../decisions/2026-10-07-configuration-validation-and-governance-registry.md)
- 2026-10-07: security configuration changes are ConfigurationReleases. [security-configuration-releases](../decisions/2026-10-07-security-configuration-releases.md)
- 2026-10-07: the security setting catalog, and who approves a configuration release. [security-setting-catalog-and-approval](../decisions/2026-10-07-security-setting-catalog-and-approval.md)
- 2026-10-23: the Foundation `rcs` readiness gate is evaluated over the build's rule package, axes, governance evidence, input snapshot and golden vectors. [foundation-rcs-readiness-gate](../decisions/2026-10-23-foundation-rcs-readiness-gate.md)
- 2026-11-06: a data class is a retention family, and records its purpose, sensitivity, policy, period and owner. [data-class-registry](../decisions/2026-11-06-data-class-registry.md)
- 2026-11-12: a configuration release cannot address the outbox; the refusal is INV-SCOPE-001's. [outbox-not-configurable](../decisions/2026-11-12-outbox-not-configurable.md)

### 3.16 Outbox and graph

- 2026-11-12: a quarantine applied appends a `QUARANTINE_APPLIED` outbox event. [quarantine-apply-outbox-event](../decisions/2026-11-12-quarantine-apply-outbox-event.md)
- 2026-11-12: an explicit quarantine release appends a `QUARANTINE_RELEASED` outbox event. [quarantine-release-outbox-event](../decisions/2026-11-12-quarantine-release-outbox-event.md)

### 3.17 Platform, frontend and CI

- 2026-10-23: the dev and test compose stacks publish their ports on the host loopback only. [compose-ports-loopback](../decisions/2026-10-23-compose-ports-loopback.md)
- 2026-10-27: RNF027 C2's automated rule check is an axe scan with the WCAG 2.1 A and AA tags, with no rule disabled. [rnf027-axe-scan](../decisions/2026-10-27-rnf027-axe-scan.md)
- 2026-10-27: RNF027's browser matrix is the three engines the pinned Playwright image ships, at three institutional viewports. [rnf027-browser-and-viewport-matrix](../decisions/2026-10-27-rnf027-browser-and-viewport-matrix.md)
- 2026-10-30: backend coverage reads `require`d files against the file on disk. [backend-coverage-native-require](../decisions/2026-10-30-backend-coverage-native-require.md)
- 2026-11-03: the frontend design system is Tailwind with shadcn primitives under `frontend/src/components/shadcn/`. [frontend-shadcn-tailwind](../decisions/2026-11-03-frontend-shadcn-tailwind.md)
- 2026-11-06: RNF020 C1 and C5, and RNF021 C5's Secure flag, are proven in CI outside the e2e stack. [rnf020-rnf021-proof-outside-e2e](../decisions/2026-11-06-rnf020-rnf021-proof-outside-e2e.md)
- 2026-11-12: the severity at which CI's dependency audit fails. [dependency-audit-level](../decisions/2026-11-12-dependency-audit-level.md)

## 4. Gaps

Each row is something the model release or its plan asks for that a source in this repository records as not done. Nothing here is inferred from a missing decision file. A row labelled "deferred by decision" is one a decision record settles as not built yet; it is listed so the gap stays visible.

| Criterion | What the code does today | Gap |
|---|---|---|
| Plano §9 readiness gates, through RNF006 C3's reference to the v2.0.0 model | The Foundation job evaluates the version, schemas, governance-registry, configuration, reference-mechanisms, `rcs`, index and zero-data gates (`api/backend/scripts/seed-essential-reference-data.js`). | Not implemented: the `biobank-biorepository`, `consent`, `specimen`, `identification`, `persistence`, `fhir` and `ai-ready` gates; `DEFERRED_P0_GATES` in `api/backend/src/foundation/readiness.js` reports each as `not_evaluated`, naming the later phase that brings it. |
| Canonicalization of the active surface | `docs/architecture/canonical-active-surface.md` (dated 2026-07-08, written before the v2.0.0 approval) lists "Known Residual Legacy Surfaces" that still carry legacy aliases, among them `api/backend/src/routes/intakeWizard.js`, `api/backend/src/services/storageService.js` and `api/backend/src/services/consent.validator.js`, and a "Deferred Cleanup Plan" of PR 100 to PR 104, of which only PR 100 (participant flow) has a section there recording what it treated. | Not implemented, as that inventory records it: the removal of those residual legacy surfaces. This changelog does not re-verify the inventory at this commit. |
| DeidentificationProcess on exports (RNF007 AC6) | An export writes no DeidentificationProcess ([deidentification-process-on-exports](../decisions/2026-11-06-deidentification-process-on-exports.md)). | Not implemented, deferred by decision (`docs/decisions/2026-11-06-deidentification-process-on-exports.md`): a DeidentificationProcess, until an export's input is a DatasetSnapshot. |
| DatasetSnapshot | A WorkflowRun's dataset snapshot is optional ([workflow-run-provenance-companions](../decisions/2026-10-23-workflow-run-provenance-companions.md)). | Not implemented, deferred by decision (`docs/decisions/2026-10-23-workflow-run-provenance-companions.md`): DatasetSnapshot is not activated. |
| Personal data nested inside a contract field's value (RF009 AC8, RNF004 C7, RULE-025) | Every telemetry path strips top-level fields outside its contract list and audits them ([telemetry-rule-025-every-ingest-path](../decisions/2026-11-19-telemetry-rule-025-every-ingest-path.md)); a contract field's own value is not screened for personal data. | Not implemented, deferred by decision (`docs/decisions/2026-11-18-telemetry-rule-025-gold-standard.md`, "Not decided here"): screening a contract field's value for nested personal data. |
| UserAccount elements | Seven UserAccount elements are absent from the user document ([user-account-absent-elements](../decisions/2026-10-17-user-account-absent-elements.md)). | Not implemented, deferred by decision (`docs/decisions/2026-10-17-user-account-absent-elements.md`): those seven elements. |
| Model limitations the release itself names (`docs/extracted-v2.0.0/persistencia-poliglota.md` §15, `docs/extracted-v2.0.0/plano.md` §13) | The analytical-preparation entities and RCSValidationStudy are modelled and written by no flow (sections 3.10 and 3.11). | Not implemented, and conditioned by the release itself: national FHIR/RNDS profiles and institutional endpoints, SPREC 4.0, the external validation of the RCS, and any model (AI) entity activation. The release claims no ISO conformity or certification, and neither does this system. |
