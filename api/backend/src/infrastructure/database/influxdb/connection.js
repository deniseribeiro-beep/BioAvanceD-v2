const { InfluxDB } = require('@influxdata/influxdb-client');
const env = require('../../../config/env');
const logger = require('../../../utils/logger');
const { currentRequestId, requestIdHeaders } = require('../../../utils/requestContext');

let influxClient = null;

function getInfluxConfig() {
  return {
    url: env.INFLUXDB_URL,
    token: env.INFLUXDB_TOKEN,
    org: env.INFLUXDB_ORG,
    bucket: env.INFLUXDB_BUCKET
  };
}

function assertInfluxEnv(config) {
  if (!config.url || !config.token || !config.org || !config.bucket) {
    throw new Error('[ISO20387][INFLUXDB] Variáveis INFLUXDB_URL, INFLUXDB_TOKEN, INFLUXDB_ORG e INFLUXDB_BUCKET são obrigatórias');
  }
}

async function connectInfluxDB() {
  if (influxClient) {
    return influxClient;
  }

  const config = getInfluxConfig();
  assertInfluxEnv(config);

  const client = new InfluxDB({
    url: config.url,
    token: config.token
  });

  try {
    const queryApi = client.getQueryApi(config.org);
    const checkQuery = `buckets() |> filter(fn: (r) => r.name == "${config.bucket}") |> limit(n: 1)`;
    await queryApi.collectRows(checkQuery);
    influxClient = client;
    logger.info('[ISO20387][INFLUXDB] Conexão validada para telemetria com rastreabilidade temporal');
    return influxClient;
  } catch (error) {
    logger.error('[ISO20387][INFLUXDB] Falha de conexão que compromete histórico temporal:', error.message);
    throw error;
  }
}

function getInfluxClient() {
  if (!influxClient) {
    throw new Error('[ISO20387][INFLUXDB] Cliente indisponível');
  }
  return influxClient;
}

// #1323 RNF015 C1: a query made for a request sends its X-Request-Id. Each
// caller builds a fresh query API per query, so the header is that query's.
function getInfluxQueryApi() {
  const config = getInfluxConfig();
  const api = getInfluxClient().getQueryApi(config.org);
  const headers = requestIdHeaders(currentRequestId());
  return headers && typeof api.with === 'function' ? api.with({ headers }) : api;
}

// Only a writer built for one request's write (requestScoped) sends its id: a
// shared writer batches several requests' points under one set of headers.
function getInfluxWriteApi(options = {}) {
  const config = getInfluxConfig();
  const headers = options.requestScoped === true ? requestIdHeaders(currentRequestId()) : null;
  if (headers) {
    return getInfluxClient().getWriteApi(config.org, config.bucket, 'ns', { headers });
  }
  return getInfluxClient().getWriteApi(config.org, config.bucket, 'ns');
}

async function closeInfluxDBConnection() {
  influxClient = null;
  logger.info('[ISO20387][INFLUXDB] Cliente liberado com sucesso');
}

module.exports = {
  connectInfluxDB,
  getInfluxClient,
  getInfluxQueryApi,
  getInfluxWriteApi,
  closeInfluxDBConnection,
  getInfluxConfig
};
