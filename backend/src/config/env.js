require('dotenv').config();

module.exports = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: process.env.PORT || 3000,

  // Mongo
  MONGO_URI: process.env.MONGO_URI,
  MONGO_DB: process.env.MONGO_DB,
  MONGO_DB_NOVO: process.env.MONGO_DB_NOVO,

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
};
