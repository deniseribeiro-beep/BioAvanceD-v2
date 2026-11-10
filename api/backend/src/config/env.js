require('dotenv').config();

module.exports = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  // #359 / RNF008.6: authLimiter's relaxed budget must be an explicit,
  // isolated opt-in, not inferred from NODE_ENV (a generic environment
  // indicator every non-production run shares, including one where
  // NODE_ENV was simply left unset). Only the real Docker dev stack's
  // compose file sets this.
  AUTH_RATE_LIMIT_RELAXED: process.env.AUTH_RATE_LIMIT_RELAXED === 'true' || process.env.AUTH_RATE_LIMIT_RELAXED === '1',
  // #832 / RNF008.6: same isolated-opt-in shape as AUTH_RATE_LIMIT_RELAXED
  // above, for consentLimiter's budget on the unauthenticated e-consent
  // token routes. Deliberately a SEPARATE flag rather than reusing that one:
  // the two relax different controls (authentication vs. the participant
  // consent surface), and a stack that needs headroom on one does not
  // thereby need it on the other.
  CONSENT_RATE_LIMIT_RELAXED: process.env.CONSENT_RATE_LIMIT_RELAXED === 'true' || process.env.CONSENT_RATE_LIMIT_RELAXED === '1',
  // RF022 AC4/AC9, RNF014 C7: the API and workers refuse to start unless the
  // newest ReadinessReport for their environment is `ready`. An explicit
  // opt-in, set by the stacks that run the Foundation job first (test,
  // production), so a native `npm start` with no Foundation run still works.
  FOUNDATION_READINESS_REQUIRED: process.env.FOUNDATION_READINESS_REQUIRED === 'true' || process.env.FOUNDATION_READINESS_REQUIRED === '1',
  // #1378 (ELM-0116, "reject legacy writes after migration window"): closes
  // the Sample.barcode migration window. An explicit opt-in: unset, create,
  // both imports and an update still write Sample.barcode, and a scan still
  // falls back to it.
  SAMPLE_BARCODE_WINDOW_CLOSED: process.env.SAMPLE_BARCODE_WINDOW_CLOSED === 'true' || process.env.SAMPLE_BARCODE_WINDOW_CLOSED === '1',
  PORT: process.env.PORT || 3000,

  // Mongo
  MONGO_URI: process.env.MONGO_URI,
  MONGO_DB: process.env.MONGO_DB,
  MONGO_DB_NOVO: process.env.MONGO_DB_NOVO,

  // Neo4j
  NEO4J_URI: process.env.NEO4J_URI,
  NEO4J_USERNAME: process.env.NEO4J_USERNAME,
  NEO4J_PASSWORD: process.env.NEO4J_PASSWORD,
  NEO4J_DATABASE: process.env.NEO4J_DATABASE || 'neo4j',
  NEO4J_REQUIRED: process.env.NEO4J_REQUIRED === 'true' || process.env.NEO4J_REQUIRED === '1',
  NEO4J_CONNECT_MAX_RETRIES: process.env.NEO4J_CONNECT_MAX_RETRIES ? Number(process.env.NEO4J_CONNECT_MAX_RETRIES) : 8,
  NEO4J_CONNECT_INITIAL_DELAY_MS: process.env.NEO4J_CONNECT_INITIAL_DELAY_MS ? Number(process.env.NEO4J_CONNECT_INITIAL_DELAY_MS) : 1000,
  NEO4J_CONNECT_MAX_DELAY_MS: process.env.NEO4J_CONNECT_MAX_DELAY_MS ? Number(process.env.NEO4J_CONNECT_MAX_DELAY_MS) : 15000,
  // After a connectNeo4j() attempt exhausts all retries, subsequent calls fail
  // fast (no retry chain) until this cooldown elapses, instead of re-paying the
  // full backoff on every caller (cron ticks, on-demand routes) while Neo4j is down.
  NEO4J_CONNECT_FAILURE_COOLDOWN_MS: process.env.NEO4J_CONNECT_FAILURE_COOLDOWN_MS ? Number(process.env.NEO4J_CONNECT_FAILURE_COOLDOWN_MS) : 30000,
  NEO4J_CANONICAL_SALT: process.env.NEO4J_CANONICAL_SALT || process.env.GRAPH_PSEUDONYMIZATION_SALT || process.env.USER_ANON_SALT || '',
  GRAPH_OUTBOX_BATCH_SIZE: process.env.GRAPH_OUTBOX_BATCH_SIZE ? Number(process.env.GRAPH_OUTBOX_BATCH_SIZE) : 100,
  GRAPH_OUTBOX_MAX_ATTEMPTS: process.env.GRAPH_OUTBOX_MAX_ATTEMPTS ? Number(process.env.GRAPH_OUTBOX_MAX_ATTEMPTS) : 8,
  GRAPH_OUTBOX_LEASE_MS: process.env.GRAPH_OUTBOX_LEASE_MS ? Number(process.env.GRAPH_OUTBOX_LEASE_MS) : 5 * 60 * 1000,
  GRAPH_OUTBOX_RETRY_BACKOFF_MS: process.env.GRAPH_OUTBOX_RETRY_BACKOFF_MS ? Number(process.env.GRAPH_OUTBOX_RETRY_BACKOFF_MS) : 1000,

  // InfluxDB
  INFLUXDB_URL: process.env.INFLUXDB_URL,
  INFLUXDB_TOKEN: process.env.INFLUXDB_TOKEN,
  INFLUXDB_ORG: process.env.INFLUXDB_ORG,
  INFLUXDB_BUCKET: process.env.INFLUXDB_BUCKET,
  TELEMETRY_MONITOR_CRON: process.env.TELEMETRY_MONITOR_CRON,
  TELEMETRY_CRITICAL_TEMP: process.env.TELEMETRY_CRITICAL_TEMP,
  TELEMETRY_CRITICAL_DURATION_HOURS: process.env.TELEMETRY_CRITICAL_DURATION_HOURS,
  TELEMETRY_LOOKBACK_HOURS: process.env.TELEMETRY_LOOKBACK_HOURS,
  TELEMETRY_TRIGGER_COOLDOWN_MINUTES: process.env.TELEMETRY_TRIGGER_COOLDOWN_MINUTES,
  TELEMETRY_MIN_TEMP_ALERT: process.env.TELEMETRY_MIN_TEMP_ALERT,
  TELEMETRY_MAX_TEMP_ALERT: process.env.TELEMETRY_MAX_TEMP_ALERT,
  // RF009 AC4, RF017 AC5: what the ingestion contract does with a reading
  // whose sensor has no TelemetryDatastream valid at its observedAt, no
  // active DeviceRegistration, or whose Device is not registered, homologated
  // and unretired, RF017 AC8. `enforce` (the default) refuses it with a 422;
  // `record`, the opt-out, accepts it and records a TelemetryValidationIssue.
  // `enforce` became the default on 2026-10-21 (#1392) because no deployment
  // holds unbound sensors.
  TELEMETRY_BINDING_MODE: process.env.TELEMETRY_BINDING_MODE || 'enforce',

  // MQTT telemetry ingestion
  MQTT_ENABLED: process.env.MQTT_ENABLED === 'true' || process.env.MQTT_ENABLED === '1',
  MQTT_URL: process.env.MQTT_URL,
  MQTT_TOPIC: process.env.MQTT_TOPIC,
  MQTT_USERNAME: process.env.MQTT_USERNAME,
  MQTT_PASSWORD: process.env.MQTT_PASSWORD,
  MQTT_CLIENT_ID: process.env.MQTT_CLIENT_ID,
  MQTT_TLS_ENABLED: process.env.MQTT_TLS_ENABLED === 'true' || process.env.MQTT_TLS_ENABLED === '1',
  MQTT_TLS_REJECT_UNAUTHORIZED: process.env.MQTT_TLS_REJECT_UNAUTHORIZED,
  MQTT_CA_PATH: process.env.MQTT_CA_PATH,
  MQTT_CERT_PATH: process.env.MQTT_CERT_PATH,
  MQTT_KEY_PATH: process.env.MQTT_KEY_PATH,
  MQTT_SIGNATURE_REQUIRED: process.env.MQTT_SIGNATURE_REQUIRED === 'true' || process.env.MQTT_SIGNATURE_REQUIRED === '1',
  MQTT_SIGNING_SECRET: process.env.MQTT_SIGNING_SECRET,

  // Auth
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
  // #1097: read by server.js's critical-variable guard. eConsent.js and
  // fhir-import-staging.service.js both read process.env directly at call
  // time; this declaration is what lets the BOOT check name it.
  CONSENT_SECRET: process.env.CONSENT_SECRET,
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
  ENCRYPTION_KEY_ID: process.env.ENCRYPTION_KEY_ID,
  AUDIT_MERKLE_SIGN_KEY_ID: process.env.AUDIT_MERKLE_SIGN_KEY_ID,
  AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE: process.env.AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE,
  AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON: process.env.AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON,
  // #1157: the registry holds the SPKI half of a key that does not exist until
  // the stack's keygen one-shot runs, and compose resolves its environment at
  // parse time -- so no static env entry can ever carry it. This names a file
  // written beside the private key instead; the JSON var above stays the
  // fallback, for the host-side generator that already writes it.
  AUDIT_MERKLE_SIGN_PUBLIC_KEYS_FILE: process.env.AUDIT_MERKLE_SIGN_PUBLIC_KEYS_FILE,
  AUDIT_RFC3161_MODE: process.env.AUDIT_RFC3161_MODE,
  AUDIT_RFC3161_TSA_URL: process.env.AUDIT_RFC3161_TSA_URL,
  AUDIT_RFC3161_TSA_AUTH_TOKEN: process.env.AUDIT_RFC3161_TSA_AUTH_TOKEN,
  AUDIT_EXTERNAL_WITNESS_URL: process.env.AUDIT_EXTERNAL_WITNESS_URL,
  // #874: reserved for unbuilt work. AUDIT_EXTERNAL_WITNESS_URL above is
  // genuinely read (the witness call is wired), but nothing yet verifies a
  // response against this public key -- that signature-verification half
  // was never built, so this key is currently inert. Do not assume a
  // signature check exists on the strength of this declaration alone.
  AUDIT_EXTERNAL_WITNESS_PUBLIC_KEY: process.env.AUDIT_EXTERNAL_WITNESS_PUBLIC_KEY,
  // #1086: slot da chave ANTERIOR, somente para decriptação, que torna a
  // rotação de ENCRYPTION_KEY um ato de configuração e não de código
  // (RNF020 AC#5). Substitui o par ENCRYPTION_KEY_LEGACY/_LEGACY_ID que
  // havia sido removido antes do primeiro commit deste repositório -- não
  // existe commit de remoção para reverter, por isso o slot foi reescrito.
  ENCRYPTION_KEY_PREVIOUS: process.env.ENCRYPTION_KEY_PREVIOUS,
  ENCRYPTION_KEY_PREVIOUS_ID: process.env.ENCRYPTION_KEY_PREVIOUS_ID,
  USER_ANON_SALT: process.env.USER_ANON_SALT,

  // URLs
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
  FRONTEND_URL: process.env.FRONTEND_URL,
  ALLOW_CLOUD_INTEGRATIONS: process.env.ALLOW_CLOUD_INTEGRATIONS === 'true' || process.env.ALLOW_CLOUD_INTEGRATIONS === '1',
  ALLOW_EXTERNAL_TERMINOLOGY_SYNC: process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC === 'true' || process.env.ALLOW_EXTERNAL_TERMINOLOGY_SYNC === '1',
  ALLOW_EXTERNAL_HPO_LOOKUP: process.env.ALLOW_EXTERNAL_HPO_LOOKUP === 'true' || process.env.ALLOW_EXTERNAL_HPO_LOOKUP === '1',
  ALLOW_EXTERNAL_DRUG_LOOKUP: process.env.ALLOW_EXTERNAL_DRUG_LOOKUP === 'true' || process.env.ALLOW_EXTERNAL_DRUG_LOOKUP === '1',
  CORS_ALLOW_ALL: process.env.CORS_ALLOW_ALL === 'true' || process.env.CORS_ALLOW_ALL === '1',
  TRUST_PROXY: process.env.TRUST_PROXY || '0',

  // Redis Configuration
  REDIS_URL: process.env.REDIS_URL,
  REDIS_HOST: process.env.REDIS_HOST,
  REDIS_PORT: process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : undefined,
  REDIS_PASSWORD: process.env.REDIS_PASSWORD,
  REDIS_USERNAME: process.env.REDIS_USERNAME || 'default',
  REDIS_TLS: process.env.REDIS_TLS === 'true' || process.env.REDIS_TLS === '1',

  // Backup / Monitoring
  BACKUP_DIR: process.env.BACKUP_DIR,
  // #948: where a restore stages its decrypted copy of a dump. Defaults to
  // `<BACKUP_DIR>/.restore-scratch`; set only to move that scratch off the
  // backups volume. It must be DISK-backed and large enough for a whole
  // dump -- pointing it at /tmp is the defect #948 was filed for, since
  // compose.prod.yml mounts /tmp as an uncapped RAM tmpfs.
  RESTORE_SCRATCH_DIR: process.env.RESTORE_SCRATCH_DIR,
  // #893: writable-storage roots, mirroring BACKUP_DIR's shape -- default
  // reproduces today's __dirname-relative uploads/storage paths exactly,
  // set only so prod can point them at a volume mounted outside /app.
  UPLOAD_DIR: process.env.UPLOAD_DIR,
  STORAGE_DIR: process.env.STORAGE_DIR,
  // #1321 (RNF029 C4): DataFile malware scanner; unset or "none" records not-available.
  MALWARE_SCAN_DRIVER: process.env.MALWARE_SCAN_DRIVER,
  // #1321 (RF007 AC2, RNF016 C4): DataFile object store; unset or "filesystem" keeps STORAGE_BASE.
  OBJECT_STORE_DRIVER: process.env.OBJECT_STORE_DRIVER,
  OBJECT_STORE_S3_ENDPOINT: process.env.OBJECT_STORE_S3_ENDPOINT,
  OBJECT_STORE_S3_BUCKET: process.env.OBJECT_STORE_S3_BUCKET,
  OBJECT_STORE_S3_REGION: process.env.OBJECT_STORE_S3_REGION,
  OBJECT_STORE_S3_ACCESS_KEY_ID: process.env.OBJECT_STORE_S3_ACCESS_KEY_ID,
  OBJECT_STORE_S3_SECRET_ACCESS_KEY: process.env.OBJECT_STORE_S3_SECRET_ACCESS_KEY,
  OBJECT_STORE_S3_TIMEOUT_MS: process.env.OBJECT_STORE_S3_TIMEOUT_MS,
  BACKUP_CRON: process.env.BACKUP_CRON,
  BACKUP_RETENTION_DAYS: process.env.BACKUP_RETENTION_DAYS,
  // #1325 (RNF010 C1): off-site copy of each encrypted run; unset keeps it off.
  BACKUP_OFFSITE_S3_ENDPOINT: process.env.BACKUP_OFFSITE_S3_ENDPOINT,
  BACKUP_OFFSITE_S3_BUCKET: process.env.BACKUP_OFFSITE_S3_BUCKET,
  BACKUP_OFFSITE_S3_REGION: process.env.BACKUP_OFFSITE_S3_REGION,
  BACKUP_OFFSITE_S3_ACCESS_KEY_ID: process.env.BACKUP_OFFSITE_S3_ACCESS_KEY_ID,
  BACKUP_OFFSITE_S3_SECRET_ACCESS_KEY: process.env.BACKUP_OFFSITE_S3_SECRET_ACCESS_KEY,
  // #749: read by scheduler.service.js#startRetentionSweepSchedule since it
  // was written, but never registered here -- so the override was dead and
  // the sweep was pinned to its 0 4 * * * fallback no matter what was set.
  RETENTION_SWEEP_CRON: process.env.RETENTION_SWEEP_CRON,
  RESTORE_TEST_CRON: process.env.RESTORE_TEST_CRON,
  TEMP_MONITOR_CRON: process.env.TEMP_MONITOR_CRON,
  TEMP_STALE_MINUTES: process.env.TEMP_STALE_MINUTES,
  // RNF015 C2 (#1323): platformAlert.service.js parses the thresholds.
  PLATFORM_ALERT_CRON: process.env.PLATFORM_ALERT_CRON,
  ALERT_HTTP_ERROR_RATE: process.env.ALERT_HTTP_ERROR_RATE,
  ALERT_HTTP_P95_MS: process.env.ALERT_HTTP_P95_MS,
  ALERT_QUEUE_BACKLOG: process.env.ALERT_QUEUE_BACKLOG,

  // Notification
  ALERT_EMAIL_TO: process.env.ALERT_EMAIL_TO,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  EMAIL_FROM: process.env.EMAIL_FROM,

  // Canonical Collections
  COLL_PATIENTS: process.env.COLL_PATIENTS || 'patients',
  COLL_SAMPLES: process.env.COLL_SAMPLES || 'samples',
  COLL_CONSENTS: process.env.COLL_CONSENTS || 'patientConsents',
  COLL_CONSENT_TEMPLATES: process.env.COLL_CONSENT_TEMPLATES || 'consent_templates',
  COLL_SAMPLE_MOVEMENTS: process.env.COLL_SAMPLE_MOVEMENTS || 'sample_movements',
  COLL_BIOMARKER_OBSERVATIONS: process.env.COLL_BIOMARKER_OBSERVATIONS || 'biomarker_observations',
  // #863: the remaining COLL_* keys below were already read via
  // src/config/collections.js's `env.COLL_<NAME>` but never declared here --
  // that importer used a sibling `require('./env')`, which the env-guard's
  // path-substring filter could not see, so these 41 reads went unchecked.
  // Each default is copied character-for-character from the corresponding
  // line in collections.js.
  COLL_CIDS: process.env.COLL_CIDS || 'cids',
  COLL_CLINICAL_UNITS: process.env.COLL_CLINICAL_UNITS || 'clinical_units',
  COLL_ORGANIZATIONS: process.env.COLL_ORGANIZATIONS || 'organizations',
  COLL_DISEASE_DICTIONARY: process.env.COLL_DISEASE_DICTIONARY || 'disease_dictionary',
  COLL_MEDICATION_DICTIONARY: process.env.COLL_MEDICATION_DICTIONARY || 'medication_dictionary',
  COLL_REFERENCE_SEED_RUNS: process.env.COLL_REFERENCE_SEED_RUNS || 'referenceSeedRuns',
  COLL_FOUNDATION_DATA_RUNS: process.env.COLL_FOUNDATION_DATA_RUNS || 'foundationDataRuns',
  COLL_READINESS_REPORTS: process.env.COLL_READINESS_REPORTS || 'readinessReports',
  COLL_CONFIGURATION_PROFILES: process.env.COLL_CONFIGURATION_PROFILES || 'configurationProfiles',
  COLL_CONFIGURATION_RELEASES: process.env.COLL_CONFIGURATION_RELEASES || 'configurationReleases',
  COLL_CONFIGURATION_CHANGE_EVENTS: process.env.COLL_CONFIGURATION_CHANGE_EVENTS || 'configurationChangeEvents',
  COLL_CONFIGURATION_VALIDATION_RUNS: process.env.COLL_CONFIGURATION_VALIDATION_RUNS || 'configurationValidationRuns',
  COLL_CANONICAL_MODEL_RELEASES: process.env.COLL_CANONICAL_MODEL_RELEASES || 'canonicalModelReleases',
  COLL_GOVERNANCE_INVARIANT_CATALOGS: process.env.COLL_GOVERNANCE_INVARIANT_CATALOGS || 'governanceInvariantCatalogs',
  COLL_INVARIANT_VIOLATIONS: process.env.COLL_INVARIANT_VIOLATIONS || 'invariantViolations',
  COLL_PARTICIPANT_IDENTITIES: process.env.COLL_PARTICIPANT_IDENTITIES || 'participantIdentities',
  COLL_RCS_ASSESSMENTS: process.env.COLL_RCS_ASSESSMENTS || 'rcsAssessments',
  COLL_RCS_INPUT_SNAPSHOTS: process.env.COLL_RCS_INPUT_SNAPSHOTS || 'rcsInputSnapshots',
  COLL_RCS_GOVERNANCE_EVIDENCE_SNAPSHOTS: process.env.COLL_RCS_GOVERNANCE_EVIDENCE_SNAPSHOTS || 'rcsGovernanceEvidenceSnapshots',
  COLL_RCS_RULE_PACKAGES: process.env.COLL_RCS_RULE_PACKAGES || 'rcsRulePackages',
  COLL_ENCOUNTERS: process.env.COLL_ENCOUNTERS || 'encounters',
  COLL_CONDITIONS: process.env.COLL_CONDITIONS || 'conditions',
  COLL_PHENOTYPE_OBSERVATIONS: process.env.COLL_PHENOTYPE_OBSERVATIONS || 'phenotypeObservations',
  COLL_CLINICAL_OBSERVATIONS: process.env.COLL_CLINICAL_OBSERVATIONS || 'clinicalObservations',
  COLL_DIAGNOSTIC_REPORTS: process.env.COLL_DIAGNOSTIC_REPORTS || 'diagnosticReports',
  COLL_CLINICAL_OUTCOMES: process.env.COLL_CLINICAL_OUTCOMES || 'clinicalOutcomes',
  COLL_DERIVED_SCORES: process.env.COLL_DERIVED_SCORES || 'derivedScores',
  COLL_ALLERGY_INTOLERANCES: process.env.COLL_ALLERGY_INTOLERANCES || 'allergyIntolerances',
  COLL_FAMILY_HISTORIES: process.env.COLL_FAMILY_HISTORIES || 'familyHistories',
  COLL_MEDICATION_EXPOSURES: process.env.COLL_MEDICATION_EXPOSURES || 'medicationExposures',
  COLL_PROCEDURES: process.env.COLL_PROCEDURES || 'procedures',
  COLL_SPECIMEN_PREANALYTICS: process.env.COLL_SPECIMEN_PREANALYTICS || 'specimenPreanalytics',
  COLL_QUARANTINE_ACTIONS: process.env.COLL_QUARANTINE_ACTIONS || 'quarantineActions',
  COLL_CONTAINERS: process.env.COLL_CONTAINERS || 'containers',
  COLL_SPECIMEN_CONTAINER_ASSIGNMENTS: process.env.COLL_SPECIMEN_CONTAINER_ASSIGNMENTS || 'specimenContainerAssignments',
  COLL_CONTAINER_POSITION_ASSIGNMENTS: process.env.COLL_CONTAINER_POSITION_ASSIGNMENTS || 'containerPositionAssignments',
  COLL_RACK_LOCATION_ASSIGNMENTS: process.env.COLL_RACK_LOCATION_ASSIGNMENTS || 'rackLocationAssignments',
  COLL_TELEMETRY_EXPOSURE_SUMMARIES: process.env.COLL_TELEMETRY_EXPOSURE_SUMMARIES || 'telemetryExposureSummaries',
  COLL_STORAGE_LOCATIONS: process.env.COLL_STORAGE_LOCATIONS || 'storageLocations',
  COLL_STORAGE_RACKS: process.env.COLL_STORAGE_RACKS || 'storageRacks',
  COLL_STORAGE_POSITIONS: process.env.COLL_STORAGE_POSITIONS || 'storagePositions',
  COLL_OPERATIONAL_STATE_DECISIONS: process.env.COLL_OPERATIONAL_STATE_DECISIONS || 'operationalStateDecisions',
  COLL_LABEL_IDENTIFIERS: process.env.COLL_LABEL_IDENTIFIERS || 'labelIdentifiers',
  COLL_SCAN_EVENTS: process.env.COLL_SCAN_EVENTS || 'scanEvents',
  COLL_CUSTODIANSHIP_ASSIGNMENTS: process.env.COLL_CUSTODIANSHIP_ASSIGNMENTS || 'custodianshipAssignments',
  COLL_SHIPMENTS: process.env.COLL_SHIPMENTS || 'shipments',
  COLL_DEVICES: process.env.COLL_DEVICES || 'devices',
  COLL_DEVICE_LIFECYCLE_EVENTS: process.env.COLL_DEVICE_LIFECYCLE_EVENTS || 'deviceLifecycleEvents',
  COLL_DEVICE_REGISTRATIONS: process.env.COLL_DEVICE_REGISTRATIONS || 'deviceRegistrations',
  COLL_TELEMETRY_DATASTREAMS: process.env.COLL_TELEMETRY_DATASTREAMS || 'telemetryDatastreams',
  COLL_REFERENCE_DATASET_RELEASES: process.env.COLL_REFERENCE_DATASET_RELEASES || 'referenceDatasetReleases',
  COLL_REFERENCE_IMPORT_RUNS: process.env.COLL_REFERENCE_IMPORT_RUNS || 'referenceImportRuns',
  COLL_REFERENCE_IMPORT_ISSUES: process.env.COLL_REFERENCE_IMPORT_ISSUES || 'referenceImportIssues',
  COLL_REFERENCE_IMPORT_STAGING: process.env.COLL_REFERENCE_IMPORT_STAGING || 'referenceImportStaging',
  COLL_TERMINOLOGY_CONCEPTS: process.env.COLL_TERMINOLOGY_CONCEPTS || 'terminologyConcepts',
  COLL_TERMINOLOGY_RELATIONS: process.env.COLL_TERMINOLOGY_RELATIONS || 'terminologyRelations',
  COLL_ROLES: process.env.COLL_ROLES || 'roles',
  COLL_PERMISSIONS: process.env.COLL_PERMISSIONS || 'permissions',
  COLL_USER_ROLE_ASSIGNMENTS: process.env.COLL_USER_ROLE_ASSIGNMENTS || 'userRoleAssignments',
  COLL_RETENTION_POLICIES: process.env.COLL_RETENTION_POLICIES || 'retentionPolicies',
  COLL_NOTIFICATION_RULES: process.env.COLL_NOTIFICATION_RULES || 'notificationRules',
  COLL_NOTIFICATIONS: process.env.COLL_NOTIFICATIONS || 'notifications',
  COLL_LABEL_GENERATIONS: process.env.COLL_LABEL_GENERATIONS || 'labelGenerations',
  COLL_ACCESS_REQUESTS: process.env.COLL_ACCESS_REQUESTS || 'accessRequests',
  COLL_ACCESS_POLICIES: process.env.COLL_ACCESS_POLICIES || 'accessPolicies',
  COLL_COLLECTION_GOVERNANCE_APPROVALS: process.env.COLL_COLLECTION_GOVERNANCE_APPROVALS || 'collectionGovernanceApprovals',
  COLL_COLLECTION_GOVERNANCE_EVENTS: process.env.COLL_COLLECTION_GOVERNANCE_EVENTS || 'collectionGovernanceEvents',
  COLL_CONSENT_DECISION_EVENTS: process.env.COLL_CONSENT_DECISION_EVENTS || 'consentDecisionEvents',
  COLL_CONSENT_REVOCATIONS: process.env.COLL_CONSENT_REVOCATIONS || 'consentRevocations',
  COLL_CONSENT_AUTHORIZATION_DECISIONS: process.env.COLL_CONSENT_AUTHORIZATION_DECISIONS || 'consentAuthorizationDecisions',
  COLL_CONSENT_PERMISSIONS: process.env.COLL_CONSENT_PERMISSIONS || 'consentPermissions',
  COLL_CONSENT_COMMUNICATION_EVENTS: process.env.COLL_CONSENT_COMMUNICATION_EVENTS || 'consentCommunicationEvents',
  COLL_REAGENT_LOTS: process.env.COLL_REAGENT_LOTS || 'reagentLots',
  COLL_NONCONFORMANCES: process.env.COLL_NONCONFORMANCES || 'nonconformances',
  COLL_LEGAL_HOLDS: process.env.COLL_LEGAL_HOLDS || 'legalHolds',
  COLL_DISPOSITION_ACTIONS: process.env.COLL_DISPOSITION_ACTIONS || 'dispositionActions',
  COLL_DATA_FILE_VERSIONS: process.env.COLL_DATA_FILE_VERSIONS || 'dataFileVersions',
  COLL_INGESTION_IDEMPOTENCY_KEYS: process.env.COLL_INGESTION_IDEMPOTENCY_KEYS || 'ingestionIdempotencyKeys',
  COLL_INGESTION_QUARANTINE_RECORDS: process.env.COLL_INGESTION_QUARANTINE_RECORDS || 'ingestionQuarantineRecords',
  COLL_MISSING_DATA_REASONS: process.env.COLL_MISSING_DATA_REASONS || 'missingDataReasons',
  COLL_DATA_QUALITY_ASSESSMENTS: process.env.COLL_DATA_QUALITY_ASSESSMENTS || 'dataQualityAssessments',
  COLL_REFERENCE_COVERAGE_MANIFESTS: process.env.COLL_REFERENCE_COVERAGE_MANIFESTS || 'referenceCoverageManifests',

  // Neo4j lineage behavior
  LINEAGE_MODE: process.env.LINEAGE_MODE || 'fail-open',
  NEO4J_RETRY_QUEUE_KEY: process.env.NEO4J_RETRY_QUEUE_KEY,
  NEO4J_RETRY_INTERVAL_MS: process.env.NEO4J_RETRY_INTERVAL_MS,
  NEO4J_RETRY_BATCH_SIZE: process.env.NEO4J_RETRY_BATCH_SIZE,
  NEO4J_RETRY_MAX_ATTEMPTS: process.env.NEO4J_RETRY_MAX_ATTEMPTS,
};
