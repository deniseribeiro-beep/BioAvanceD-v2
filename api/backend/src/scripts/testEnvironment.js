const { connectDB, closeConnection } = require('../database/mongo');
const { connectNeo4j, closeNeo4jConnection } = require('../infrastructure/database/neo4j/connection');
const Redis = require('ioredis');

const MARKER = 'BIOAVANCED_SYNTHETIC_TEST_V1';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseUrl(value, name) {
  try {
    return new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
}

function normalizeList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function ensureAllowedHost(urlValue, name, allowedHosts) {
  const url = parseUrl(urlValue, name);
  if (!allowedHosts.includes(url.hostname)) {
    throw new Error(`${name} must use one of the test hosts: ${allowedHosts.join(', ')}`);
  }
  return url;
}

function ensureTestEnvironment(action) {
  const errors = [];
  const push = (condition, message) => {
    if (!condition) errors.push(message);
  };

  push(process.env.NODE_ENV === 'test', 'NODE_ENV must be test');
  push(process.env.TEST_ENVIRONMENT === 'true' || process.env.TEST_ENVIRONMENT === '1', 'TEST_ENVIRONMENT must be true');
  push(String(process.env.MONGO_DB || '').trim() === 'bioavanced_test', 'MONGO_DB must be bioavanced_test');
  push(String(process.env.MONGO_DB_NOVO || '').trim() === 'bioavanced_test', 'MONGO_DB_NOVO must be bioavanced_test');
  push(String(process.env.NEO4J_DATABASE || '').trim() === 'bioavanced_test', 'NEO4J_DATABASE must be bioavanced_test');
  push(String(process.env.INFLUXDB_ORG || '').trim() === 'bioavanced-test', 'INFLUXDB_ORG must be bioavanced-test');
  push(String(process.env.INFLUXDB_BUCKET || '').trim() === 'bioavanced-test', 'INFLUXDB_BUCKET must be bioavanced-test');
  push(String(process.env.SMTP_HOST || '').trim() === 'smtp-test', 'SMTP_HOST must be smtp-test');
  push(String(process.env.ALLOWED_ORIGINS || '').includes('http://frontend-test:5173'), 'ALLOWED_ORIGINS must include the frontend-test origin');

  if (process.env.MONGO_URI) {
    try {
      const mongoUrl = parseUrl(process.env.MONGO_URI, 'MONGO_URI');
      push(mongoUrl.hostname === 'mongodb-test', 'MONGO_URI must point to mongodb-test');
      push(!mongoUrl.hostname.includes('localhost') && !mongoUrl.hostname.includes('127.0.0.1'), 'MONGO_URI must not use localhost');
    } catch (error) {
      errors.push(error.message);
    }
  } else {
    errors.push('MONGO_URI is required');
  }

  if (process.env.NEO4J_URI) {
    try {
      ensureAllowedHost(process.env.NEO4J_URI, 'NEO4J_URI', ['neo4j-test']);
    } catch (error) {
      errors.push(error.message);
    }
  } else {
    errors.push('NEO4J_URI is required');
  }

  if (process.env.REDIS_URL) {
    try {
      ensureAllowedHost(process.env.REDIS_URL, 'REDIS_URL', ['redis-test']);
    } catch (error) {
      errors.push(error.message);
    }
  } else {
    errors.push('REDIS_URL is required');
  }

  if (process.env.INFLUXDB_URL) {
    try {
      ensureAllowedHost(process.env.INFLUXDB_URL, 'INFLUXDB_URL', ['influxdb-test']);
    } catch (error) {
      errors.push(error.message);
    }
  } else {
    errors.push('INFLUXDB_URL is required');
  }

  if (process.env.MQTT_URL) {
    try {
      ensureAllowedHost(process.env.MQTT_URL, 'MQTT_URL', ['mqtt-test']);
    } catch (error) {
      errors.push(error.message);
    }
  } else {
    errors.push('MQTT_URL is required');
  }

  const invalidOrigins = normalizeList(process.env.ALLOWED_ORIGINS).filter((origin) => {
    try {
      return new URL(origin).hostname !== 'frontend-test';
    } catch {
      return true;
    }
  });
  push(invalidOrigins.length === 0, 'ALLOWED_ORIGINS must contain only frontend-test origins');

  const requiredKeys = [
    'MONGO_URI',
    'MONGO_DB',
    'MONGO_DB_NOVO',
    'NEO4J_URI',
    'NEO4J_USERNAME',
    'NEO4J_PASSWORD',
    'NEO4J_DATABASE',
    'REDIS_URL',
    'INFLUXDB_URL',
    'INFLUXDB_TOKEN',
    'INFLUXDB_ORG',
    'INFLUXDB_BUCKET',
    'MQTT_URL',
    'SMTP_HOST',
    'ALLOWED_ORIGINS',
    'JWT_SECRET',
    'JWT_REFRESH_SECRET',
    'USER_ANON_SALT',
    'CONSENT_SECRET',
  ];

  for (const key of requiredKeys) {
    push(String(process.env[key] || '').trim() !== '', `${key} is required`);
  }

  if (errors.length > 0) {
    throw new Error(`[${action.toUpperCase()}] Unsafe test environment:\n- ${errors.join('\n- ')}`);
  }
}

async function cleanupSyntheticData() {
  ensureTestEnvironment('cleanup');
  const db = await connectDB();
  try {
    const collections = await db.listCollections({}, { nameOnly: true }).toArray();
    for (const { name } of collections) {
      await db.collection(name).deleteMany({ $or: [{ source: MARKER }, { synthetic: true }] });
    }
  } finally {
    await closeConnection();
  }

  const driver = await connectNeo4j();
  const session = driver.session({ database: process.env.NEO4J_DATABASE || 'neo4j' });
  try {
    await session.run('MATCH (n {source: $source}) DETACH DELETE n', { source: MARKER });
  } finally {
    await session.close();
    await closeNeo4jConnection();
  }
}

async function resetTestEnvironment() {
  ensureTestEnvironment('reset');
  const db = await connectDB();
  try {
    await db.dropDatabase();
  } finally {
    await closeConnection();
  }

  const driver = await connectNeo4j();
  const session = driver.session({ database: process.env.NEO4J_DATABASE || 'neo4j' });
  try {
    await session.run('MATCH (n) DETACH DELETE n');
  } finally {
    await session.close();
    await closeNeo4jConnection();
  }

  const influxUrl = new URL('/api/v2/delete', required('INFLUXDB_URL'));
  influxUrl.searchParams.set('org', required('INFLUXDB_ORG'));
  influxUrl.searchParams.set('bucket', required('INFLUXDB_BUCKET'));
  const influxResponse = await fetch(influxUrl, {
    method: 'POST',
    headers: {
      Authorization: `Token ${required('INFLUXDB_TOKEN')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ start: '1970-01-01T00:00:00Z', stop: '2100-01-01T00:00:00Z' }),
  });
  if (!influxResponse.ok) {
    throw new Error(`InfluxDB reset failed: ${influxResponse.status} ${await influxResponse.text()}`);
  }

  const redis = new Redis(required('REDIS_URL'));
  try {
    await redis.flushdb();
  } finally {
    await redis.quit();
  }
}

async function main() {
  const action = process.argv[2];
  if (action === 'reset') return resetTestEnvironment();
  if (action === 'cleanup') return cleanupSyntheticData();
  throw new Error('Use: testEnvironment.js reset|cleanup');
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((error) => {
    console.error(`[TEST_ENV] ${error.message || error}`);
    process.exit(1);
  });
}

module.exports = { MARKER, resetTestEnvironment, cleanupSyntheticData };
