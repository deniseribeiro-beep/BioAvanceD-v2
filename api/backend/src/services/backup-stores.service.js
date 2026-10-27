const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { once } = require('events');
const neo4j = require('neo4j-driver');
const { InfluxDB, flux } = require('@influxdata/influxdb-client');
const env = require('../config/env');
const keyRegistry = require('../config/keyRegistry');
const logger = require('../utils/logger');
const { encryptFileBuffer, decryptFileBuffer } = require('../utils/fileCrypto');

// #1325 (RNF010 C1): the Neo4j and InfluxDB exports that run beside the
// MongoDB dump in the same backup folder, encrypted and checksummed with it.
// This module never requires backup.service.js; backup.service.js takes the
// two encryption helpers below from here.

// Every client goes through this seam so tests can replace it. The Neo4j
// driver is opened WITHOUT disableLosslessIntegers (the app's connection
// sets it): with it, a Cypher float like 1.0 comes back as an integer and an
// integer past 2^53 loses digits, and the export must keep both exactly.
const clients = {
  neo4jDriver(uri, user, pass) {
    return neo4j.driver(uri, neo4j.auth.basic(user, pass));
  },
  influxQueryApi(url, token, org) {
    return new InfluxDB({ url, token }).getQueryApi(org);
  }
};

function neo4jSettings() {
  return { NEO4J_URI: env.NEO4J_URI, NEO4J_USERNAME: env.NEO4J_USERNAME, NEO4J_PASSWORD: env.NEO4J_PASSWORD };
}

function influxdbSettings() {
  return {
    INFLUXDB_URL: env.INFLUXDB_URL,
    INFLUXDB_TOKEN: env.INFLUXDB_TOKEN,
    INFLUXDB_ORG: env.INFLUXDB_ORG,
    INFLUXDB_BUCKET: env.INFLUXDB_BUCKET
  };
}

const INFLUX_POINT_COLUMNS = ['_measurement', '_field', '_time', '_value'];
const INFLUX_NON_TAG_COLUMNS =new Set(['result', 'table', '_start', '_stop', '_time', '_value', '_field', '_measurement']);

const TEMPORAL_TYPES = [
  ['date', neo4j.isDate],
  ['datetime', neo4j.isDateTime],
  ['localdatetime', neo4j.isLocalDateTime],
  ['localtime', neo4j.isLocalTime],
  ['time', neo4j.isTime],
  ['duration', neo4j.isDuration],
  ['point', neo4j.isPoint]
];

// #734: encryptFileBuffer (fileCrypto.js) returns null rather than throwing
// when ENCRYPTION_KEY isn't configured -- the right behavior for its other
// caller (sample-file.controller.js), which falls back to storing
// plaintext. That silent fallback is exactly the defect this issue is
// about, so backups check for a configured key up front and abort loudly
// instead of ever reaching that null.
function assertEncryptionKeyConfigured() {
  if (!keyRegistry.getActiveKey()) {
    throw new Error(
      'Criptografia de backup habilitada (encryptionEnabled) mas nenhuma chave de criptografia está configurada (ENCRYPTION_KEY). Backup abortado para não gravar dados em texto plano.'
    );
  }
}

// Encrypts one file's bytes in place, returning the per-file envelope
// (algorithm/keyId/iv/tag) to be recorded in manifest.json. Field names
// match sample-file.controller.js's persisted shape so decryptFileBuffer
// can be handed the entry object directly on restore.
async function encryptFileInPlace(filePath) {
  const plaintext = await fs.promises.readFile(filePath);
  const encryption = encryptFileBuffer(plaintext);
  if (!encryption) {
    // assertEncryptionKeyConfigured() is always called before this, so
    // reaching here means the key vanished between the two checks -- still
    // fail loudly rather than silently leaving plaintext on disk.
    assertEncryptionKeyConfigured();
  }
  await fs.promises.writeFile(filePath, encryption.ciphertext);
  return {
    encrypted: true,
    encryptionAlgorithm: encryption.algorithm,
    encryptionKeyId: encryption.keyId,
    encryptionIv: encryption.iv,
    encryptionTag: encryption.tag
  };
}

// A store with none of its variables set is skipped, the way performBackup
// skips a run with no MONGO_URI (missing_mongo_uri). That the skip applies
// here too is an inference from that pattern, not a stated rule. A store
// with only some of them set is misconfigured, and fails the run.
function isStoreConfigured(storeName, settings) {
  const names = Object.keys(settings);
  const present = names.filter((name) => settings[name] !== undefined && settings[name] !== null && String(settings[name]) !== '');
  if (present.length === 0) return false;
  if (present.length < names.length) {
    const missing = names.filter((name) => !present.includes(name));
    throw new Error(`Configuração parcial de ${storeName}: ${missing.join(', ')} não configurada(s).`);
  }
  return true;
}

function openNdjsonWriter(filePath) {
  const stream = fs.createWriteStream(filePath);
  let failure = null;
  let closed = false;
  stream.on('error', (error) => { failure = error; });
  stream.on('close', () => { closed = true; });
  return {
    async write(record) {
      if (failure) throw failure;
      if (!stream.write(`${JSON.stringify(record)}\n`)) await once(stream, 'drain');
    },
    async end() {
      if (failure) throw failure;
      stream.end();
      await once(stream, 'close');
      if (failure) throw failure;
    },
    // Waits for the file to be closed, so a failed store's folder can be
    // removed right after (Windows refuses to remove an open file).
    async destroy() {
      if (closed) return;
      const done = once(stream, 'close').catch(() => {});
      stream.destroy();
      await done;
    }
  };
}

// Every Neo4j property value is written with its type, so a restore can
// rebuild it exactly. A value of any other type fails the export rather
// than being written lossily.
function typedNeo4jValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (neo4j.isInt(value)) return { $t: 'int', v: value.toString() };
  if (typeof value === 'number') return { $t: 'float', v: Number.isFinite(value) ? value : String(value) };
  if (Array.isArray(value)) return value.map(typedNeo4jValue);
  for (const [tag, matches] of TEMPORAL_TYPES) {
    if (matches(value)) return { $t: tag, v: value.toString() };
  }
  const kind = value?.constructor?.name || typeof value;
  throw new Error(`Valor de propriedade Neo4j de tipo não suportado (${kind}).`);
}

function typedNeo4jProperties(props) {
  const typed = {};
  for (const [key, value] of Object.entries(props || {})) typed[key] = typedNeo4jValue(value);
  return typed;
}

async function streamRecords(result, writer, toLine) {
  let count = 0;
  for await (const record of result) {
    // eslint-disable-next-line no-await-in-loop
    await writer.write(toLine(record));
    count += 1;
  }
  return count;
}

async function finishStoreFiles(backupDir, relativeFiles, encryptionEnabled) {
  const files = [];
  for (const file of relativeFiles) {
    if (encryptionEnabled) {
      // eslint-disable-next-line no-await-in-loop
      const envelope = await encryptFileInPlace(path.join(backupDir, ...file.split('/')));
      files.push({ file, ...envelope });
    } else {
      files.push({ file, encrypted: false });
    }
  }
  return files;
}

async function exportNeo4j(backupDir, encryptionEnabled) {
  if (!isStoreConfigured('Neo4j', neo4jSettings())) return { status: 'skipped', reason: 'not_configured' };
  if (encryptionEnabled) assertEncryptionKeyConfigured();

  const database = env.NEO4J_DATABASE || 'neo4j';
  const storeDir = path.join(backupDir, 'neo4j');
  await fs.promises.mkdir(storeDir, { recursive: true });

  const driver = clients.neo4jDriver(env.NEO4J_URI, env.NEO4J_USERNAME, env.NEO4J_PASSWORD);
  let nodes;
  let relationships;
  try {
    const session = driver.session({ database, defaultAccessMode: neo4j.session.READ });
    try {
      // An explicit transaction, not executeRead: a retried transaction
      // function would append the same records to the files a second time.
      const tx = session.beginTransaction();
      try {
        const nodeWriter = openNdjsonWriter(path.join(storeDir, 'nodes.ndjson'));
        try {
          nodes = await streamRecords(
            tx.run('MATCH (n) RETURN elementId(n) AS id, labels(n) AS labels, properties(n) AS props'),
            nodeWriter,
            (record) => ({ id: record.get('id'), labels: record.get('labels'), props: typedNeo4jProperties(record.get('props')) })
          );
          await nodeWriter.end();
        } finally {
          await nodeWriter.destroy();
        }

        const relationshipWriter = openNdjsonWriter(path.join(storeDir, 'relationships.ndjson'));
        try {
          relationships = await streamRecords(
            tx.run('MATCH (a)-[r]->(b) RETURN elementId(r) AS id, type(r) AS type, elementId(a) AS start, elementId(b) AS end, properties(r) AS props'),
            relationshipWriter,
            (record) => ({
              id: record.get('id'),
              type: record.get('type'),
              start: record.get('start'),
              end: record.get('end'),
              props: typedNeo4jProperties(record.get('props'))
            })
          );
          await relationshipWriter.end();
        } finally {
          await relationshipWriter.destroy();
        }
      } finally {
        await tx.close();
      }

      // SHOW commands run as their own auto-commit queries, outside the
      // read transaction.
      const constraints = await session.run('SHOW CONSTRAINTS YIELD createStatement');
      const indexes = await session.run(
        "SHOW INDEXES YIELD createStatement, owningConstraint, type WHERE owningConstraint IS NULL AND type <> 'LOOKUP'"
      );
      await fs.promises.writeFile(
        path.join(storeDir, 'schema.json'),
        JSON.stringify({
          constraints: constraints.records.map((record) => record.get('createStatement')),
          indexes: indexes.records.map((record) => record.get('createStatement'))
        }, null, 2),
        'utf8'
      );
    } finally {
      await session.close();
    }
  } finally {
    await driver.close();
  }

  const files = await finishStoreFiles(
    backupDir,
    ['neo4j/nodes.ndjson', 'neo4j/relationships.ndjson', 'neo4j/schema.json'],
    encryptionEnabled
  );
  return { status: 'exported', database, nodes, relationships, files };
}

async function exportInfluxDB(backupDir, encryptionEnabled) {
  if (!isStoreConfigured('InfluxDB', influxdbSettings())) return { status: 'skipped', reason: 'not_configured' };
  if (encryptionEnabled) assertEncryptionKeyConfigured();

  const bucket = env.INFLUXDB_BUCKET;
  const org = env.INFLUXDB_ORG;
  const storeDir = path.join(backupDir, 'influxdb');
  await fs.promises.mkdir(storeDir, { recursive: true });

  const queryApi = clients.influxQueryApi(env.INFLUXDB_URL, env.INFLUXDB_TOKEN, org);
  // flux`` quotes and escapes the bucket name as a Flux string. The range is
  // the full one Flux accepts, with an explicit stop: range()'s default stop
  // is now(), which would drop future-stamped points.
  const fluxQuery = flux`from(bucket: ${bucket}) |> range(start: 1678-01-01T00:00:00Z, stop: 2262-01-01T00:00:00Z)`;

  let points = 0;
  const writer = openNdjsonWriter(path.join(storeDir, 'points.ndjson'));
  try {
    for await (const { values, tableMeta } of queryApi.iterateRows(fluxQuery)) {
      // Raw strings from the annotated CSV, never tableMeta.toObject: that
      // parses a long into a JS number and loses digits past 2^53.
      // A query that fails after the response started sends its error as an
      // annotated-CSV table of its own (error, reference): that ends the
      // export, never becomes a point.
      const labels = tableMeta.columns.map((column) => column.label);
      if (labels.includes('error')) {
        throw new Error(`Consulta Flux falhou: ${values[labels.indexOf('error')]}`);
      }
      const absent = INFLUX_POINT_COLUMNS.filter((label) => !labels.includes(label));
      if (absent.length) {
        throw new Error(`Resposta Flux sem as colunas ${absent.join(', ')}.`);
      }
      const line ={ measurement: null, field: null, time: null, valueType: null, value: null, tags: {} };
      tableMeta.columns.forEach((column, index) => {
        const raw = values[index];
        if (column.label === '_measurement') line.measurement = raw;
        else if (column.label === '_field') line.field = raw;
        else if (column.label === '_time') line.time = raw;
        else if (column.label === '_value') {
          line.value = raw;
          line.valueType = column.dataType;
        } else if (!INFLUX_NON_TAG_COLUMNS.has(column.label)) line.tags[column.label] = raw;
      });
      // eslint-disable-next-line no-await-in-loop
      await writer.write(line);
      points += 1;
    }
    await writer.end();
  } finally {
    await writer.destroy();
  }

  const files = await finishStoreFiles(backupDir, ['influxdb/points.ndjson'], encryptionEnabled);
  return { status: 'exported', bucket, org, points, files };
}

// A store's files are encrypted only once all of them are written, so a
// store that fails partway can leave plaintext behind. Its subfolder is
// removed before the failure propagates; when that removal fails too, the
// error says so, since plaintext may then remain on disk.
async function exportNamedStore(storeName, storeDirName, exporter, backupDir, encryptionEnabled) {
  try {
    return await exporter(backupDir, encryptionEnabled);
  } catch (error) {
    let message = `Backup de ${storeName} falhou: ${error?.message || String(error)}`;
    try {
      await fs.promises.rm(path.join(backupDir, storeDirName), { recursive: true, force: true, maxRetries: 3 });
    } catch (removeError) {
      message += ` A pasta ${storeDirName}/ não pôde ser removida: ${removeError?.message || String(removeError)}`;
    }
    throw new Error(message);
  }
}

// Neo4j, then InfluxDB. Any failure propagates, naming its store, so the
// whole run fails rather than completing without one of them.
async function exportSecondaryStores(backupDir, encryptionEnabled) {
  const neo4jResult = await exportNamedStore('Neo4j', 'neo4j', module.exports.exportNeo4j, backupDir, encryptionEnabled);
  const influxdbResult = await exportNamedStore('InfluxDB', 'influxdb', module.exports.exportInfluxDB, backupDir, encryptionEnabled);
  return { neo4j: neo4jResult, influxdb: influxdbResult };
}

// #1325 (RNF010 C5): the restore test's check of the two exports above. Each
// exported store's files are decrypted into a scratch folder, every line is
// parsed, and the counts and relationship endpoints are checked against the
// manifest. Nothing connects to Neo4j or InfluxDB: the image's Neo4j
// Community has a single database, so there is no scratch one to load into,
// and the restore test never touches the live databases.
const STORE_FILES = {
  neo4j: ['neo4j/nodes.ndjson', 'neo4j/relationships.ndjson', 'neo4j/schema.json'],
  influxdb: ['influxdb/points.ndjson']
};
const STORE_LABELS = { neo4j: 'Neo4j', influxdb: 'InfluxDB' };
const NEO4J_STRING_TAGS = new Set(TEMPORAL_TYPES.map(([tag]) => tag));
const NEO4J_NON_FINITE_FLOATS = ['NaN', 'Infinity', '-Infinity'];
const INFLUX_VALUE_PATTERNS = {
  long: /^-?\d+$/,
  unsignedLong: /^\d+$/,
  boolean: /^(true|false)$/
};

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

// The inverse of typedNeo4jValue: a value it could not have written fails.
function isDecodableNeo4jValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.every(isDecodableNeo4jValue);
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes('$t') || !keys.includes('v')) return false;
  const { $t: tag, v } = value;
  if (tag === 'int') return typeof v === 'string' && /^-?\d+$/.test(v);
  if (tag === 'float') return (typeof v === 'number' && Number.isFinite(v)) || NEO4J_NON_FINITE_FLOATS.includes(v);
  if (NEO4J_STRING_TAGS.has(tag)) return typeof v === 'string' && v !== '';
  return false;
}

function isDecodableNeo4jProperties(props) {
  return isPlainObject(props) && Object.values(props).every(isDecodableNeo4jValue);
}

function isInfluxValue(valueType, value) {
  if (typeof value !== 'string') return false;
  if (valueType === 'string') return true;
  if (valueType === 'double') {
    return ['NaN', '+Inf', '-Inf'].includes(value) || (value !== '' && !Number.isNaN(Number(value)));
  }
  return Object.prototype.hasOwnProperty.call(INFLUX_VALUE_PATTERNS, valueType)
    && INFLUX_VALUE_PATTERNS[valueType].test(value);
}

// Calls check(record, lineNumber) for every line of an NDJSON file and
// returns the line count. A trailing newline ends the last line; any other
// empty line fails JSON.parse.
async function forEachJsonLine(filePath, check) {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  let failure = null;
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  stream.on('error', (error) => {
    failure = error;
    lines.close();
  });
  let count = 0;
  try {
    for await (const line of lines) {
      count += 1;
      let record;
      try {
        record = JSON.parse(line);
      } catch (_) {
        throw new Error(`${path.basename(filePath)} linha ${count}: não é JSON.`);
      }
      check(record, count);
    }
    if (failure) throw failure;
  } finally {
    lines.close();
    // Windows refuses to remove an open file, and the scratch folder is
    // removed right after.
    if (!stream.closed) {
      const done = once(stream, 'close').catch(() => {});
      stream.destroy();
      await done;
    }
  }
  return count;
}

// The store's files must be exactly its own set, which also keeps a manifest
// path like ../x from being read. Each is decrypted (or copied, when stored
// in plaintext) into the scratch folder.
async function decryptStoreFiles(storeKey, backupPath, entry, scratchDir) {
  const expected = STORE_FILES[storeKey];
  const entries = Array.isArray(entry.files) ? entry.files : [];
  const names = entries.map((fileEntry) => (isPlainObject(fileEntry) ? fileEntry.file : undefined));
  const sameSet = names.length === expected.length
    && new Set(names).size === names.length
    && expected.every((name) => names.includes(name));
  if (!sameSet) {
    throw new Error(`arquivos no manifest (${names.map(String).join(', ')}) diferem de ${expected.join(', ')}.`);
  }

  await fs.promises.mkdir(path.join(scratchDir, storeKey), { recursive: true });
  for (const fileEntry of entries) {
    const parts = fileEntry.file.split('/');
    // eslint-disable-next-line no-await-in-loop
    const stored = await fs.promises.readFile(path.join(backupPath, ...parts));
    let plaintext;
    if (fileEntry.encrypted === true) {
      try {
        plaintext = decryptFileBuffer(stored, fileEntry);
      } catch (error) {
        throw new Error(`${fileEntry.file} não pôde ser descriptografado: ${error?.message || String(error)}`);
      }
    } else if (fileEntry.encrypted === false) {
      plaintext = stored;
    } else {
      throw new Error(`${fileEntry.file}: campo encrypted inválido no manifest.`);
    }
    // eslint-disable-next-line no-await-in-loop
    await fs.promises.writeFile(path.join(scratchDir, ...parts), plaintext);
  }
}

async function verifyNeo4jExport(backupPath, entry, scratchDir) {
  await decryptStoreFiles('neo4j', backupPath, entry, scratchDir);

  const nodeIds = new Set();
  const nodes = await forEachJsonLine(path.join(scratchDir, 'neo4j', 'nodes.ndjson'), (record, line) => {
    if (!isPlainObject(record) || typeof record.id !== 'string' || !isStringArray(record.labels)
      || !isDecodableNeo4jProperties(record.props)) {
      throw new Error(`nodes.ndjson linha ${line}: nó inválido.`);
    }
    if (nodeIds.has(record.id)) throw new Error(`nodes.ndjson linha ${line}: id ${record.id} repetido.`);
    nodeIds.add(record.id);
  });

  const relationships = await forEachJsonLine(path.join(scratchDir, 'neo4j', 'relationships.ndjson'), (record, line) => {
    if (!isPlainObject(record) || typeof record.id !== 'string' || typeof record.type !== 'string'
      || typeof record.start !== 'string' || typeof record.end !== 'string'
      || !isDecodableNeo4jProperties(record.props)) {
      throw new Error(`relationships.ndjson linha ${line}: relacionamento inválido.`);
    }
    // A load could not attach it. A write between the export's two queries
    // can cause this (the export is not a point-in-time snapshot).
    if (!nodeIds.has(record.start) || !nodeIds.has(record.end)) {
      throw new Error(`relationships.ndjson linha ${line}: extremidade ${record.start} -> ${record.end} fora dos nós exportados.`);
    }
  });

  let schema;
  try {
    schema = JSON.parse(await fs.promises.readFile(path.join(scratchDir, 'neo4j', 'schema.json'), 'utf8'));
  } catch (_) {
    throw new Error('schema.json não é JSON.');
  }
  if (!isPlainObject(schema) || !isStringArray(schema.constraints) || !isStringArray(schema.indexes)) {
    throw new Error('schema.json sem as listas constraints e indexes.');
  }

  if (nodes !== entry.nodes || relationships !== entry.relationships) {
    throw new Error(`contagem diferente do manifest: ${nodes} nós e ${relationships} relacionamentos lidos, ${entry.nodes} e ${entry.relationships} registrados.`);
  }
  return { status: 'verified', nodes, relationships, constraints: schema.constraints.length, indexes: schema.indexes.length };
}

async function verifyInfluxDBExport(backupPath, entry, scratchDir) {
  await decryptStoreFiles('influxdb', backupPath, entry, scratchDir);

  const points = await forEachJsonLine(path.join(scratchDir, 'influxdb', 'points.ndjson'), (record, line) => {
    const valid = isPlainObject(record)
      && typeof record.measurement === 'string' && record.measurement !== ''
      && typeof record.field === 'string' && record.field !== ''
      && typeof record.time === 'string' && record.time !== '' && !Number.isNaN(Date.parse(record.time))
      && isPlainObject(record.tags) && Object.values(record.tags).every((tag) => typeof tag === 'string')
      && isInfluxValue(record.valueType, record.value);
    if (!valid) throw new Error(`points.ndjson linha ${line}: ponto inválido.`);
  });

  if (points !== entry.points) {
    throw new Error(`contagem diferente do manifest: ${points} pontos lidos, ${entry.points} registrados.`);
  }
  return { status: 'verified', points };
}

const STORE_VERIFIERS = { neo4j: verifyNeo4jExport, influxdb: verifyInfluxDBExport };

// Never throws: the restore test's catch reads an ENOENT as a missing
// mongorestore binary, so a missing store file must come back as a result.
// `stores` undefined is a folder written before the exports existed: there
// is no store data to test, and `stores: null` says so.
async function verifySecondaryStores(backupPath, stores, scratchBase) {
  if (stores === undefined) return { stores: null, error: null };

  const results = {};
  const errors = [];
  let scratchDir = null;
  try {
    for (const storeKey of ['neo4j', 'influxdb']) {
      try {
        if (!isPlainObject(stores)) throw new Error('registro stores do manifest não é um objeto.');
        const entry = stores[storeKey];
        if (!isPlainObject(entry)) throw new Error('sem registro no manifest.');
        if (entry.status === 'skipped') {
          results[storeKey] = { status: 'skipped', reason: entry.reason };
          continue;
        }
        if (entry.status !== 'exported') throw new Error(`status ${String(entry.status)} desconhecido no manifest.`);
        if (!scratchDir) {
          // eslint-disable-next-line no-await-in-loop
          await fs.promises.mkdir(scratchBase, { recursive: true });
          // eslint-disable-next-line no-await-in-loop
          scratchDir = await fs.promises.mkdtemp(path.join(scratchBase, 'bioavanced-restore-stores-'));
        }
        // eslint-disable-next-line no-await-in-loop
        results[storeKey] = await STORE_VERIFIERS[storeKey](backupPath, entry, scratchDir);
      } catch (error) {
        const message = `Teste de restauração de ${STORE_LABELS[storeKey]} falhou: ${error?.message || String(error)}`;
        results[storeKey] = { status: 'failed', error: message };
        errors.push(message);
      }
    }
  } finally {
    if (scratchDir) {
      try {
        await fs.promises.rm(scratchDir, { recursive: true, force: true });
      } catch (removeError) {
        logger.error(`Erro ao remover cópia temporária dos stores ${scratchDir}:`, removeError?.message || String(removeError));
      }
    }
  }
  return { stores: results, error: errors.length ? errors.join(' ') : null };
}

module.exports = {
  clients,
  assertEncryptionKeyConfigured,
  encryptFileInPlace,
  exportNeo4j,
  exportInfluxDB,
  exportSecondaryStores,
  verifySecondaryStores
};
