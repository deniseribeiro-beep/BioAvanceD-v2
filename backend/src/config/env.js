require('dotenv').config();

module.exports = {
  NODE_ENV: process.env.NODE_ENV || 'development',
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

  // Auth
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
  USER_ANON_SALT: process.env.USER_ANON_SALT,

  // URLs
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
  FRONTEND_URL: process.env.FRONTEND_URL,
  API_URL: process.env.API_URL,
  SUPABASE_URL: process.env.SUPABASE_URL,
  CORS_ALLOW_ALL: process.env.CORS_ALLOW_ALL === 'true' || process.env.CORS_ALLOW_ALL === '1',
  TRUST_PROXY: process.env.TRUST_PROXY || '0',

  // Redis Configuration
  REDIS_HOST: process.env.REDIS_HOST,
  REDIS_PORT: process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : undefined,
  REDIS_PASSWORD: process.env.REDIS_PASSWORD,
  REDIS_USERNAME: process.env.REDIS_USERNAME || 'default',
  REDIS_TLS: process.env.REDIS_TLS === 'true' || process.env.REDIS_TLS === '1',

  // Backup / Monitoring
  BACKUP_DIR: process.env.BACKUP_DIR,
  BACKUP_CRON: process.env.BACKUP_CRON,
  BACKUP_RETENTION_DAYS: process.env.BACKUP_RETENTION_DAYS,
  TEMP_MONITOR_CRON: process.env.TEMP_MONITOR_CRON,
  TEMP_STALE_MINUTES: process.env.TEMP_STALE_MINUTES,
  ENABLE_CONSENT_SYNC: process.env.ENABLE_CONSENT_SYNC === 'true' || process.env.ENABLE_CONSENT_SYNC === '1',
  CONSENT_SYNC_CRON: process.env.CONSENT_SYNC_CRON,
  CONSENT_SYNC_BATCH_SIZE: process.env.CONSENT_SYNC_BATCH_SIZE,

  // Canonical Collections
  COLL_PATIENTS: process.env.COLL_PATIENTS || 'patients',
  COLL_SAMPLES: process.env.COLL_SAMPLES || 'samples',
  COLL_CONSENTS: process.env.COLL_CONSENTS || 'patientConsents',
  COLL_CONSENT_TEMPLATES: process.env.COLL_CONSENT_TEMPLATES || 'consent_templates',
  COLL_SAMPLE_MOVEMENTS: process.env.COLL_SAMPLE_MOVEMENTS || 'sample_movements',

  // Neo4j lineage behavior
  LINEAGE_MODE: process.env.LINEAGE_MODE || 'fail-open',
  NEO4J_RETRY_QUEUE_KEY: process.env.NEO4J_RETRY_QUEUE_KEY,
  NEO4J_RETRY_INTERVAL_MS: process.env.NEO4J_RETRY_INTERVAL_MS,
  NEO4J_RETRY_BATCH_SIZE: process.env.NEO4J_RETRY_BATCH_SIZE,
  NEO4J_RETRY_MAX_ATTEMPTS: process.env.NEO4J_RETRY_MAX_ATTEMPTS,

  // Data read strategy
  FHIR_READ_MODE: process.env.FHIR_READ_MODE || 'fhir-first',
};
