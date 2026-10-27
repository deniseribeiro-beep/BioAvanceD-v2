import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const path = require('path');
const os = require('os');
const fs = require('fs');
const neo4j = require('neo4j-driver');
const env = require('../../../src/config/env');
const backupStores = require('../../../src/services/backup-stores.service');
const { decryptFileBuffer } = require('../../../src/utils/fileCrypto');

// #1325 (RNF010 C1): the Neo4j and InfluxDB exports written beside the
// MongoDB dump. Clients are replaced through backupStores.clients; the files
// are real, in a temp dir.
const STORE_ENV = [
  'NEO4J_URI', 'NEO4J_USERNAME', 'NEO4J_PASSWORD', 'NEO4J_DATABASE',
  'INFLUXDB_URL', 'INFLUXDB_TOKEN', 'INFLUXDB_ORG', 'INFLUXDB_BUCKET'
];

function fakeRecord(fields) {
  return { get: (key) => fields[key] };
}

async function* iterate(items) {
  for (const item of items) yield item;
}

// A driver whose read transaction streams `nodes` then `relationships`, and
// whose auto-commit runs answer the two SHOW commands.
function fakeNeo4jDriver({ nodes = [], relationships = [], constraints = [], indexes = [] } = {}) {
  const tx = {
    run: vi.fn((query) => iterate((query.startsWith('MATCH (n)') ? nodes : relationships).map(fakeRecord))),
    close: vi.fn().mockResolvedValue(),
  };
  const session = {
    beginTransaction: vi.fn(() => tx),
    run: vi.fn(async (query) => ({
      records: (query.startsWith('SHOW CONSTRAINTS') ? constraints : indexes).map((createStatement) => fakeRecord({ createStatement })),
    })),
    close: vi.fn().mockResolvedValue(),
  };
  return { session: vi.fn(() => session), close: vi.fn().mockResolvedValue(), tx, sessionObject: session };
}

function fakeInfluxQueryApi(tables) {
  const rows = tables.flatMap(({ columns, rows: tableRows }) => tableRows.map((values) => ({ values, tableMeta: { columns } })));
  return { iterateRows: vi.fn(() => iterate(rows)) };
}

const INFLUX_COLUMNS = [
  { label: 'result', dataType: 'string' },
  { label: 'table', dataType: 'long' },
  { label: '_start', dataType: 'dateTime:RFC3339' },
  { label: '_stop', dataType: 'dateTime:RFC3339' },
  { label: '_time', dataType: 'dateTime:RFC3339' },
  { label: '_value', dataType: 'long' },
  { label: '_field', dataType: 'string' },
  { label: '_measurement', dataType: 'string' },
  { label: 'sensorId', dataType: 'string' },
];

function readNdjson(filePath) {
  return fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

describe('backup-stores.service (#1325)', () => {
  const saved = {};
  let backupDir;

  beforeEach(async () => {
    for (const name of STORE_ENV) saved[name] = env[name];
    for (const name of STORE_ENV) env[name] = undefined;
    backupDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'bioavanced-1325-stores-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const name of STORE_ENV) env[name] = saved[name];
    await fs.promises.rm(backupDir, { recursive: true, force: true });
  });

  function configureNeo4j() {
    env.NEO4J_URI = 'bolt://neo4j:7687';
    env.NEO4J_USERNAME = 'neo4j';
    env.NEO4J_PASSWORD = 'secret';
    env.NEO4J_DATABASE = 'neo4j';
  }

  function configureInflux() {
    env.INFLUXDB_URL = 'http://influx:8086';
    env.INFLUXDB_TOKEN = 'token';
    env.INFLUXDB_ORG = 'org';
    env.INFLUXDB_BUCKET = 'bucket';
  }

  it('skips both stores when none of their variables is set', async () => {
    const neo4jDriver = vi.spyOn(backupStores.clients, 'neo4jDriver');
    const influxQueryApi = vi.spyOn(backupStores.clients, 'influxQueryApi');

    const result = await backupStores.exportSecondaryStores(backupDir, true);

    expect(result).toEqual({
      neo4j: { status: 'skipped', reason: 'not_configured' },
      influxdb: { status: 'skipped', reason: 'not_configured' },
    });
    expect(neo4jDriver).not.toHaveBeenCalled();
    expect(influxQueryApi).not.toHaveBeenCalled();
    expect(fs.readdirSync(backupDir)).toEqual([]);
  });

  it('fails, naming the store and the missing variable, when a store is partly configured', async () => {
    env.INFLUXDB_URL = 'http://influx:8086';
    env.INFLUXDB_TOKEN = 'token';
    env.INFLUXDB_ORG = 'org';
    const influxQueryApi = vi.spyOn(backupStores.clients, 'influxQueryApi');

    await expect(backupStores.exportSecondaryStores(backupDir, false)).rejects.toThrow(/InfluxDB.*INFLUXDB_BUCKET/);
    expect(influxQueryApi).not.toHaveBeenCalled();
  });

  it('writes Neo4j nodes, relationships and schema with every property value typed', async () => {
    configureNeo4j();
    const big = neo4j.int('9007199254740993');
    const driver = fakeNeo4jDriver({
      nodes: [
        {
          id: '4:a:1',
          labels: ['Sample'],
          props: {
            count: big,
            ratio: 1.0,
            name: 'x',
            active: true,
            missing: null,
            collectedOn: new neo4j.types.Date(2024, 2, 5),
            tags: [neo4j.int(1), 2.5, 'y'],
          },
        },
      ],
      relationships: [
        { id: '5:a:9', type: 'DERIVED_FROM', start: '4:a:1', end: '4:a:2', props: { at: new neo4j.types.Duration(1, 2, 3, 0) } },
      ],
      constraints: ['CONSTRAINT stmt'],
      indexes: ['INDEX stmt'],
    });
    vi.spyOn(backupStores.clients, 'neo4jDriver').mockReturnValue(driver);

    const result = await backupStores.exportNeo4j(backupDir, false);

    expect(result).toMatchObject({ status: 'exported', database: 'neo4j', nodes: 1, relationships: 1 });
    expect(backupStores.clients.neo4jDriver).toHaveBeenCalledWith('bolt://neo4j:7687', 'neo4j', 'secret');
    expect(driver.close).toHaveBeenCalled();

    const [node] = readNdjson(path.join(backupDir, 'neo4j', 'nodes.ndjson'));
    expect(node).toEqual({
      id: '4:a:1',
      labels: ['Sample'],
      props: {
        count: { $t: 'int', v: '9007199254740993' },
        ratio: { $t: 'float', v: 1 },
        name: 'x',
        active: true,
        missing: null,
        collectedOn: { $t: 'date', v: '2024-02-05' },
        tags: [{ $t: 'int', v: '1' }, { $t: 'float', v: 2.5 }, 'y'],
      },
    });
    const [relationship] = readNdjson(path.join(backupDir, 'neo4j', 'relationships.ndjson'));
    expect(relationship).toEqual({
      id: '5:a:9', type: 'DERIVED_FROM', start: '4:a:1', end: '4:a:2', props: { at: { $t: 'duration', v: 'P1M2DT3S' } },
    });
    expect(JSON.parse(fs.readFileSync(path.join(backupDir, 'neo4j', 'schema.json'), 'utf8')))
      .toEqual({ constraints: ['CONSTRAINT stmt'], indexes: ['INDEX stmt'] });
  });

  it('fails the Neo4j export on a property value it cannot type, and still closes the driver', async () => {
    configureNeo4j();
    const driver = fakeNeo4jDriver({ nodes: [{ id: '4:a:1', labels: [], props: { blob: new Uint8Array([1, 2]) } }] });
    vi.spyOn(backupStores.clients, 'neo4jDriver').mockReturnValue(driver);

    await expect(backupStores.exportSecondaryStores(backupDir, false)).rejects.toThrow(/^Backup de Neo4j falhou: .*não suportado/);
    expect(driver.close).toHaveBeenCalled();
  });

  it('writes every InfluxDB point with its raw value, value type and tags', async () => {
    configureInflux();
    const queryApi = fakeInfluxQueryApi([
      { columns: INFLUX_COLUMNS, rows: [['_result', '0', 's', 'e', '2030-01-01T00:00:00Z', '9007199254740993', 'value', 'temperature', 'S-1']] },
      {
        columns: INFLUX_COLUMNS.map((column) => (column.label === '_value' ? { label: '_value', dataType: 'double' } : column)),
        rows: [['_result', '1', 's', 'e', '2026-01-01T00:00:00Z', '1.0', 'reading', 'temperature', 'S-2']],
      },
    ]);
    vi.spyOn(backupStores.clients, 'influxQueryApi').mockReturnValue(queryApi);

    const result = await backupStores.exportInfluxDB(backupDir, false);

    expect(result).toMatchObject({ status: 'exported', bucket: 'bucket', org: 'org', points: 2 });
    expect(backupStores.clients.influxQueryApi).toHaveBeenCalledWith('http://influx:8086', 'token', 'org');
    const flux = String(queryApi.iterateRows.mock.calls[0][0]);
    expect(flux).toContain('from(bucket: "bucket")');
    expect(flux).toContain('range(start: 1678-01-01T00:00:00Z, stop: 2262-01-01T00:00:00Z)');
    expect(readNdjson(path.join(backupDir, 'influxdb', 'points.ndjson'))).toEqual([
      { measurement: 'temperature', field: 'value', time: '2030-01-01T00:00:00Z', valueType: 'long', value: '9007199254740993', tags: { sensorId: 'S-1' } },
      { measurement: 'temperature', field: 'reading', time: '2026-01-01T00:00:00Z', valueType: 'double', value: '1.0', tags: { sensorId: 'S-2' } },
    ]);
  });

  // A Flux error raised after the response started arrives as a table of its
  // own (error, reference) inside the 200 body.
  it('fails the InfluxDB export on a Flux error table, leaving no points file', async () => {
    configureInflux();
    vi.spyOn(backupStores.clients, 'influxQueryApi').mockReturnValue(fakeInfluxQueryApi([
      { columns: INFLUX_COLUMNS, rows: [['_result', '0', 's', 'e', '2026-01-01T00:00:00Z', '1', 'value', 'temperature', 'S-1']] },
      {
        columns: [{ label: 'error', dataType: 'string' }, { label: 'reference', dataType: 'string' }],
        rows: [['runtime error: query exceeded memory limit', '897']],
      },
    ]));

    await expect(backupStores.exportSecondaryStores(backupDir, false))
      .rejects.toThrow('Backup de InfluxDB falhou: Consulta Flux falhou: runtime error: query exceeded memory limit');
    expect(fs.existsSync(path.join(backupDir, 'influxdb'))).toBe(false);
  });

  it('fails the InfluxDB export on a table without a point column', async () => {
    configureInflux();
    vi.spyOn(backupStores.clients, 'influxQueryApi').mockReturnValue(fakeInfluxQueryApi([
      { columns: INFLUX_COLUMNS.filter((column) => column.label !== '_value'), rows: [['_result', '0', 's', 'e', '2026-01-01T00:00:00Z', 'value', 'temperature', 'S-1']] },
    ]));

    await expect(backupStores.exportInfluxDB(backupDir, false)).rejects.toThrow('Resposta Flux sem as colunas _value.');
  });

  it('encrypts every store file in place when encryption is on, recording an envelope that decrypts it', async () => {
    configureNeo4j();
    configureInflux();
    vi.spyOn(backupStores.clients, 'neo4jDriver').mockReturnValue(fakeNeo4jDriver({
      nodes: [{ id: '4:a:1', labels: ['Sample'], props: { name: 'PLAINTEXT-NODE-MARKER' } }],
    }));
    vi.spyOn(backupStores.clients, 'influxQueryApi').mockReturnValue(fakeInfluxQueryApi([
      { columns: INFLUX_COLUMNS, rows: [['_result', '0', 's', 'e', '2026-01-01T00:00:00Z', '1', 'value', 'temperature', 'PLAINTEXT-TAG-MARKER']] },
    ]));

    const result = await backupStores.exportSecondaryStores(backupDir, true);

    const entries = [...result.neo4j.files, ...result.influxdb.files];
    expect(entries.map((entry) => entry.file)).toEqual([
      'neo4j/nodes.ndjson', 'neo4j/relationships.ndjson', 'neo4j/schema.json', 'influxdb/points.ndjson',
    ]);
    for (const entry of entries) {
      expect(entry).toMatchObject({ encrypted: true, encryptionAlgorithm: 'aes-256-gcm' });
      expect(typeof entry.encryptionKeyId).toBe('string');
      expect(typeof entry.encryptionIv).toBe('string');
      expect(typeof entry.encryptionTag).toBe('string');
    }

    const nodesEntry = entries[0];
    const nodesCiphertext = fs.readFileSync(path.join(backupDir, 'neo4j', 'nodes.ndjson'));
    expect(nodesCiphertext.toString('utf8')).not.toContain('PLAINTEXT-NODE-MARKER');
    expect(decryptFileBuffer(nodesCiphertext, nodesEntry).toString('utf8')).toContain('PLAINTEXT-NODE-MARKER');

    const pointsEntry = entries[3];
    const pointsCiphertext = fs.readFileSync(path.join(backupDir, 'influxdb', 'points.ndjson'));
    expect(pointsCiphertext.toString('utf8')).not.toContain('PLAINTEXT-TAG-MARKER');
    expect(decryptFileBuffer(pointsCiphertext, pointsEntry).toString('utf8')).toContain('PLAINTEXT-TAG-MARKER');
  });

  it('leaves the store files in plaintext, marked encrypted: false, when encryption is off', async () => {
    configureInflux();
    vi.spyOn(backupStores.clients, 'influxQueryApi').mockReturnValue(fakeInfluxQueryApi([
      { columns: INFLUX_COLUMNS, rows: [['_result', '0', 's', 'e', '2026-01-01T00:00:00Z', '1', 'value', 'temperature', 'S-1']] },
    ]));

    const result = await backupStores.exportSecondaryStores(backupDir, false);

    expect(result.neo4j).toEqual({ status: 'skipped', reason: 'not_configured' });
    expect(result.influxdb.files).toEqual([{ file: 'influxdb/points.ndjson', encrypted: false }]);
    expect(readNdjson(path.join(backupDir, 'influxdb', 'points.ndjson'))[0].tags).toEqual({ sensorId: 'S-1' });
  });

  // RNF010 C5: the restore test's check of the exports. Each case exports
  // through the real code, then verifies what landed on disk.
  describe('verifySecondaryStores', () => {
    const GRAPH = {
      nodes: [
        {
          id: '4:a:1',
          labels: ['Sample'],
          props: { name: 'S-1', count: neo4j.int(7), weight: 1.5, ratio: NaN, at: new neo4j.types.Date(2026, 2, 1), tags: ['x', 'y'], note: null },
        },
        { id: '4:a:2', labels: ['Box'], props: {} },
      ],
      relationships: [{ id: '5:a:1', type: 'STORED_IN', start: '4:a:1', end: '4:a:2', props: { since: neo4j.int(2026) } }],
      constraints: ['CREATE CONSTRAINT sample_name FOR (n:Sample) REQUIRE n.name IS UNIQUE'],
      indexes: ['CREATE INDEX box_code FOR (n:Box) ON (n.code)'],
    };
    const INFLUX_DOUBLE_COLUMNS = INFLUX_COLUMNS.map((column) => (column.label === '_value' ? { ...column, dataType: 'double' } : column));
    const INFLUX_TABLES = [
      { columns: INFLUX_COLUMNS, rows: [['_result', '0', 's', 'e', '2026-01-01T00:00:00Z', '1', 'count', 'door', 'S-1']] },
      { columns: INFLUX_DOUBLE_COLUMNS, rows: [['_result', '1', 's', 'e', '2026-01-01T00:00:00.123456789Z', '-21.5', 'value', 'temperature', 'S-2']] },
    ];

    let scratchBase;

    beforeEach(() => {
      scratchBase = path.join(backupDir, '.restore-scratch');
    });

    // Exports both stores, then makes every client throw: the verify step
    // must open none.
    async function exportBoth(encryptionEnabled) {
      configureNeo4j();
      configureInflux();
      const neo4jDriver = vi.spyOn(backupStores.clients, 'neo4jDriver').mockReturnValue(fakeNeo4jDriver(GRAPH));
      const influxQueryApi = vi.spyOn(backupStores.clients, 'influxQueryApi').mockReturnValue(fakeInfluxQueryApi(INFLUX_TABLES));
      const stores = {
        neo4j: await backupStores.exportNeo4j(backupDir, encryptionEnabled),
        influxdb: await backupStores.exportInfluxDB(backupDir, encryptionEnabled),
      };
      neo4jDriver.mockImplementation(() => { throw new Error('the restore test opened a Neo4j driver'); });
      influxQueryApi.mockImplementation(() => { throw new Error('the restore test opened an InfluxDB query API'); });
      return { stores, neo4jDriver, influxQueryApi };
    }

    function writeNdjson(relativeFile, records) {
      fs.writeFileSync(path.join(backupDir, ...relativeFile.split('/')), records.map((record) => `${JSON.stringify(record)}\n`).join(''));
    }

    const VERIFIED = {
      neo4j: { status: 'verified', nodes: 2, relationships: 1, constraints: 1, indexes: 1 },
      influxdb: { status: 'verified', points: 2 },
    };

    it('verifies an encrypted export of both stores with its counts, opening no client and removing its scratch folder', async () => {
      const { stores, neo4jDriver, influxQueryApi } = await exportBoth(true);
      expect(stores.neo4j.files.every((entry) => entry.encrypted === true)).toBe(true);

      const result = await backupStores.verifySecondaryStores(backupDir, stores, scratchBase);

      expect(result).toEqual({ stores: VERIFIED, error: null });
      expect(neo4jDriver).toHaveBeenCalledTimes(1);
      expect(influxQueryApi).toHaveBeenCalledTimes(1);
      expect(fs.readdirSync(scratchBase)).toEqual([]);
    });

    it('verifies a plaintext export of both stores', async () => {
      const { stores } = await exportBoth(false);

      const result = await backupStores.verifySecondaryStores(backupDir, stores, scratchBase);

      expect(result).toEqual({ stores: VERIFIED, error: null });
      expect(fs.readdirSync(scratchBase)).toEqual([]);
    });

    it('fails Neo4j alone when one ciphertext byte of nodes.ndjson is flipped', async () => {
      const { stores } = await exportBoth(true);
      const nodesFile = path.join(backupDir, 'neo4j', 'nodes.ndjson');
      const bytes = fs.readFileSync(nodesFile);
      bytes[0] ^= 0xff;
      fs.writeFileSync(nodesFile, bytes);

      const result = await backupStores.verifySecondaryStores(backupDir, stores, scratchBase);

      expect(result.stores.neo4j.status).toBe('failed');
      expect(result.stores.influxdb).toEqual(VERIFIED.influxdb);
      expect(result.error).toContain('Teste de restauração de Neo4j falhou: neo4j/nodes.ndjson não pôde ser descriptografado');
      expect(result.error).not.toContain('InfluxDB');
      expect(fs.readdirSync(scratchBase)).toEqual([]);
    });

    it('fails Neo4j when the manifest node count is off by one', async () => {
      const { stores } = await exportBoth(true);
      stores.neo4j.nodes += 1;

      const result = await backupStores.verifySecondaryStores(backupDir, stores, scratchBase);

      expect(result.stores.neo4j).toEqual({ status: 'failed', error: expect.stringContaining('contagem diferente do manifest') });
      expect(result.stores.influxdb).toEqual(VERIFIED.influxdb);
    });

    it('fails Neo4j when a relationship ends on a node the export does not hold', async () => {
      const { stores } = await exportBoth(false);
      writeNdjson('neo4j/relationships.ndjson', [{ id: '5:a:9', type: 'STORED_IN', start: '4:a:1', end: '4:a:404', props: {} }]);

      const result = await backupStores.verifySecondaryStores(backupDir, stores, scratchBase);

      expect(result.stores.neo4j).toEqual({ status: 'failed', error: expect.stringContaining('4:a:1 -> 4:a:404') });
    });

    it('fails Neo4j on a property its typed encoding could not have written', async () => {
      const badValues = [{ $t: 'int', v: '1.5' }, { $t: 'bigint', v: '1' }, 3, { $t: 'float', v: 1, extra: true }];
      for (const bad of badValues) {
        // eslint-disable-next-line no-await-in-loop
        const { stores } = await exportBoth(false);
        writeNdjson('neo4j/nodes.ndjson', [
          { id: '4:a:1', labels: ['Sample'], props: { bad } },
          { id: '4:a:2', labels: ['Box'], props: {} },
        ]);

        // eslint-disable-next-line no-await-in-loop
        const result = await backupStores.verifySecondaryStores(backupDir, stores, scratchBase);

        expect(result.stores.neo4j, JSON.stringify(bad)).toEqual({ status: 'failed', error: expect.stringContaining('nodes.ndjson linha 1') });
      }
    });

    it('fails InfluxDB on a value that does not match its value type', async () => {
      const badPoints = [{ valueType: 'long', value: 'abc' }, { valueType: 'double', value: '' }, { valueType: 'decimal', value: '1' }];
      for (const bad of badPoints) {
        // eslint-disable-next-line no-await-in-loop
        const { stores } = await exportBoth(false);
        writeNdjson('influxdb/points.ndjson', [
          { measurement: 'door', field: 'count', time: '2026-01-01T00:00:00Z', valueType: 'long', value: '1', tags: {} },
          { measurement: 'temperature', field: 'value', time: '2026-01-01T00:00:00Z', tags: {}, ...bad },
        ]);

        // eslint-disable-next-line no-await-in-loop
        const result = await backupStores.verifySecondaryStores(backupDir, stores, scratchBase);

        expect(result.stores.influxdb, JSON.stringify(bad)).toEqual({ status: 'failed', error: expect.stringContaining('points.ndjson linha 2') });
        expect(result.stores.neo4j).toEqual(VERIFIED.neo4j);
        expect(result.error).toMatch(/^Teste de restauração de InfluxDB falhou: /);
      }
    });

    it('fails Neo4j when its manifest file list is not exactly its own files', async () => {
      const { stores } = await exportBoth(false);
      const escaping = { ...stores.neo4j, files: [stores.neo4j.files[0], stores.neo4j.files[1], { file: '../escape.ndjson', encrypted: false }] };
      const short = { ...stores.neo4j, files: stores.neo4j.files.slice(0, 2) };
      const duplicated = { ...stores.neo4j, files: [stores.neo4j.files[0], stores.neo4j.files[0], stores.neo4j.files[1]] };

      for (const entry of [escaping, short, duplicated]) {
        // eslint-disable-next-line no-await-in-loop
        const result = await backupStores.verifySecondaryStores(backupDir, { ...stores, neo4j: entry }, scratchBase);

        expect(result.stores.neo4j).toEqual({ status: 'failed', error: expect.stringContaining('arquivos no manifest') });
      }
    });

    it('passes skipped stores through, reads no stores record as untested, and fails any other record without throwing', async () => {
      const skipped = { status: 'skipped', reason: 'not_configured' };
      await expect(backupStores.verifySecondaryStores(backupDir, { neo4j: skipped, influxdb: skipped }, scratchBase))
        .resolves.toEqual({ stores: { neo4j: skipped, influxdb: skipped }, error: null });
      expect(fs.existsSync(scratchBase)).toBe(false);

      await expect(backupStores.verifySecondaryStores(backupDir, undefined, scratchBase))
        .resolves.toEqual({ stores: null, error: null });

      const weird = await backupStores.verifySecondaryStores(backupDir, { neo4j: { status: 'weird' }, influxdb: skipped }, scratchBase);
      expect(weird.stores.neo4j.status).toBe('failed');
      expect(weird.stores.influxdb).toEqual(skipped);
      expect(weird.error).toContain('Neo4j');

      const notAnObject = await backupStores.verifySecondaryStores(backupDir, 'x', scratchBase);
      expect(notAnObject.stores.neo4j.status).toBe('failed');
      expect(notAnObject.stores.influxdb.status).toBe('failed');

      const missingKey = await backupStores.verifySecondaryStores(backupDir, { neo4j: skipped }, scratchBase);
      expect(missingKey.stores.influxdb.status).toBe('failed');
    });

    it('returns a failed store, never a throw, when a store file is missing', async () => {
      const { stores } = await exportBoth(true);
      fs.rmSync(path.join(backupDir, 'influxdb', 'points.ndjson'));

      const result = await backupStores.verifySecondaryStores(backupDir, stores, scratchBase);

      expect(result.stores.influxdb).toEqual({ status: 'failed', error: expect.stringContaining('ENOENT') });
      expect(result.stores.neo4j).toEqual(VERIFIED.neo4j);
      expect(fs.readdirSync(scratchBase)).toEqual([]);
    });
  });
});
