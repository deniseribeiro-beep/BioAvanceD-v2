import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const env = require('../../../src/config/env');
const logger = require('../../../src/utils/logger');
const { uploadBackupRunOffsite } = require('../../../src/services/backup-offsite.service');

const sha256Hex = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

const BUCKET = 'biobank-backups';
const ACCESS_KEY_ID = 'TESTACCESSKEY';
const SECRET = 'test-secret-key-never-logged';
const SETTING_NAMES = [
  'BACKUP_OFFSITE_S3_ENDPOINT',
  'BACKUP_OFFSITE_S3_BUCKET',
  'BACKUP_OFFSITE_S3_REGION',
  'BACKUP_OFFSITE_S3_ACCESS_KEY_ID',
  'BACKUP_OFFSITE_S3_SECRET_ACCESS_KEY'
];
const RUN_FILES = {
  'biobank/samples.bson': 'encrypted-bson-bytes',
  'biobank/samples.metadata.json': 'encrypted-metadata-bytes',
  'neo4j/nodes.ndjson': 'encrypted-neo4j-bytes',
  // Accounts for every other file, as a mongodump run's manifest does.
  'manifest.json': JSON.stringify({
    type: 'mongodump',
    encrypted: true,
    encryptedFiles: [{ file: 'biobank/samples.bson' }, { file: 'biobank/samples.metadata.json' }],
    stores: {
      neo4j: { status: 'exported', files: [{ file: 'neo4j/nodes.ndjson' }] },
      influxdb: { status: 'skipped', reason: 'not_configured' }
    }
  })
};

// An in-process fake S3: path-style objects in a Map, every request logged.
function createFakeS3() {
  const objects = new Map();
  const log = [];
  const fake = { objects, log, failWith: null, server: null, endpoint: null };

  fake.server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const entry = { method: req.method, path: req.url, headers: req.headers, body };
      log.push(entry);
      const answer = (status, payload) => {
        entry.status = status;
        res.statusCode = status;
        res.end(payload);
      };
      if (fake.failWith) return answer(fake.failWith);
      if (req.method === 'PUT') {
        if (objects.has(req.url) && req.headers['if-none-match'] === '*') return answer(412);
        objects.set(req.url, body);
        return answer(200);
      }
      if (req.method === 'GET') {
        return objects.has(req.url) ? answer(200, objects.get(req.url)) : answer(404);
      }
      return answer(405);
    });
  });
  return fake;
}

describe('uploadBackupRunOffsite (#1325, RNF010 C1)', () => {
  let fake;
  let tmpRoot;
  let backupDir;
  const originalSettings = {};

  beforeAll(async () => {
    fake = createFakeS3();
    await new Promise((resolve) => fake.server.listen(0, '127.0.0.1', resolve));
    fake.endpoint = `http://127.0.0.1:${fake.server.address().port}`;
  });
  afterAll(async () => {
    await new Promise((resolve) => fake.server.close(resolve));
  });
  beforeEach(() => {
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    for (const name of SETTING_NAMES) {
      originalSettings[name] = env[name];
      env[name] = undefined;
    }
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-offsite-'));
    backupDir = path.join(tmpRoot, '2026-10-29');
    for (const [rel, content] of Object.entries(RUN_FILES)) {
      const filePath = path.join(backupDir, ...rel.split('/'));
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content);
    }
  });
  afterEach(() => {
    vi.restoreAllMocks();
    for (const name of SETTING_NAMES) env[name] = originalSettings[name];
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fake.objects.clear();
    fake.log.length = 0;
    fake.failWith = null;
  });

  function configure(overrides = {}) {
    env.BACKUP_OFFSITE_S3_ENDPOINT = fake.endpoint;
    env.BACKUP_OFFSITE_S3_BUCKET = BUCKET;
    env.BACKUP_OFFSITE_S3_ACCESS_KEY_ID = ACCESS_KEY_ID;
    env.BACKUP_OFFSITE_S3_SECRET_ACCESS_KEY = SECRET;
    Object.assign(env, overrides);
  }

  it('skips with not_configured and sends nothing when no setting is set', async () => {
    await expect(uploadBackupRunOffsite(backupDir, true)).resolves.toEqual({ status: 'skipped', reason: 'not_configured' });
    expect(fake.log).toHaveLength(0);
  });

  it('fails naming the missing settings when only some are set', async () => {
    env.BACKUP_OFFSITE_S3_BUCKET = BUCKET;
    env.BACKUP_OFFSITE_S3_SECRET_ACCESS_KEY = '';

    const error = await uploadBackupRunOffsite(backupDir, true).catch((e) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toMatch(/^Cópia off-site falhou: configuração parcial: /);
    expect(error.message).toContain('BACKUP_OFFSITE_S3_ENDPOINT');
    expect(error.message).toContain('BACKUP_OFFSITE_S3_ACCESS_KEY_ID');
    expect(error.message).toContain('BACKUP_OFFSITE_S3_SECRET_ACCESS_KEY');
    expect(fake.log).toHaveLength(0);
  });

  it('skips with not_encrypted and sends nothing for a plaintext run', async () => {
    configure();

    await expect(uploadBackupRunOffsite(backupDir, false)).resolves.toEqual({ status: 'skipped', reason: 'not_encrypted' });
    expect(fake.log).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('uploads every file with manifest.json last', async () => {
    configure();

    const result = await uploadBackupRunOffsite(backupDir, true);

    const prefix = `/${BUCKET}/backups/2026-10-29/`;
    const order = ['biobank/samples.bson', 'biobank/samples.metadata.json', 'neo4j/nodes.ndjson', 'manifest.json'];
    expect(fake.log.map((e) => [e.method, e.path])).toEqual(order.map((rel) => ['PUT', `${prefix}${rel}`]));
    for (const rel of order) {
      expect(fake.objects.get(`${prefix}${rel}`).equals(Buffer.from(RUN_FILES[rel]))).toBe(true);
    }
    expect(result).toEqual({ status: 'uploaded', bucket: BUCKET, prefix: 'backups/2026-10-29/', files: 4 });
  });

  it('signs each PUT and sends the body hash and if-none-match', async () => {
    configure();

    await uploadBackupRunOffsite(backupDir, true);

    expect(fake.log).toHaveLength(4);
    for (const entry of fake.log) {
      expect(entry.headers.authorization.startsWith(`AWS4-HMAC-SHA256 Credential=${ACCESS_KEY_ID}/`)).toBe(true);
      expect(entry.headers.authorization).toContain('/us-east-1/s3/aws4_request');
      expect(entry.headers['x-amz-content-sha256']).toBe(sha256Hex(entry.body));
      expect(entry.headers['if-none-match']).toBe('*');
    }
  });

  it('uses BACKUP_OFFSITE_S3_REGION in the credential scope', async () => {
    configure({ BACKUP_OFFSITE_S3_REGION: 'sa-east-1' });

    await uploadBackupRunOffsite(backupDir, true);

    expect(fake.log).toHaveLength(4);
    for (const entry of fake.log) {
      expect(entry.headers.authorization).toContain('/sa-east-1/s3/aws4_request');
    }
  });

  it('fails at the first refused PUT without naming the secret', async () => {
    configure();
    fake.failWith = 500;

    const error = await uploadBackupRunOffsite(backupDir, true).catch((e) => e);

    expect(error.message).toBe('Cópia off-site falhou: PUT de biobank/samples.bson respondeu 500.');
    expect(fake.log).toHaveLength(1);
    expect(error.message).not.toContain(SECRET);
    expect(error.message).not.toContain(ACCESS_KEY_ID);
  });

  it('never overwrites an object that already exists', async () => {
    configure();
    await uploadBackupRunOffsite(backupDir, true);
    const key = `/${BUCKET}/backups/2026-10-29/biobank/samples.bson`;
    fs.writeFileSync(path.join(backupDir, 'biobank', 'samples.bson'), 'changed-bytes');

    await expect(uploadBackupRunOffsite(backupDir, true))
      .rejects.toThrow('Cópia off-site falhou: PUT de biobank/samples.bson respondeu 412.');
    expect(fake.objects.get(key).equals(Buffer.from(RUN_FILES['biobank/samples.bson']))).toBe(true);
  });

  it('refuses an endpoint carrying credentials without printing it', async () => {
    const endpoint = 'http://user:pw@127.0.0.1:9';
    configure({ BACKUP_OFFSITE_S3_ENDPOINT: endpoint });

    const error = await uploadBackupRunOffsite(backupDir, true).catch((e) => e);

    expect(error.message).toBe('Cópia off-site falhou: BACKUP_OFFSITE_S3_ENDPOINT inválido.');
    expect(error.message).not.toContain('pw');
    expect(error.message).not.toContain(endpoint);
    expect(fake.log).toHaveLength(0);
  });

  it('fails before any request when manifest.json is missing', async () => {
    configure();
    fs.rmSync(path.join(backupDir, 'manifest.json'));

    await expect(uploadBackupRunOffsite(backupDir, true)).rejects.toThrow('Cópia off-site falhou: manifest.json ausente.');
    expect(fake.log).toHaveLength(0);
  });

  it('refuses a file the manifest does not account for and sends nothing', async () => {
    configure();
    fs.writeFileSync(path.join(backupDir, 'biobank', 'patients.bson'), 'PLAINTEXT-PATIENT-RECORD');

    await expect(uploadBackupRunOffsite(backupDir, true))
      .rejects.toThrow('Cópia off-site falhou: biobank/patients.bson não consta do manifest.json.');
    expect(fake.log).toHaveLength(0);
  });
});
