import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import os from 'os';
import path from 'path';
import fs from 'fs';

const require2 = createRequire(import.meta.url);
const importService = require2('../../src/services/import.service');
const influxTelemetryWriteRepository = require2('../../src/infrastructure/persistence/influxdb/InfluxTelemetryWriteRepository');
const auditLogger = require2('../../src/utils/auditLogger');
const logger = require2('../../src/utils/logger');

const PERSISTED_AT = new Date('2026-10-17T12:00:00.000Z');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const tmpFiles = [];

function writeTmpFile(name, content) {
  const filePath = path.join(os.tmpdir(), `import-service-${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`);
  fs.writeFileSync(filePath, content);
  tmpFiles.push(filePath);
  return filePath;
}

afterEach(() => {
  while (tmpFiles.length) {
    const f = tmpFiles.pop();
    try { fs.unlinkSync(f); } catch (_) { /* already gone */ }
  }
});

describe('ImportService.importLocations (disabled, #466)', () => {
  it('always rejects, since the legacy locations collection is read-only during the transition (#457)', async () => {
    await expect(importService.importLocations()).rejects.toThrow(/desativada/);
  });
});

// Every collection the import reaches records what is inserted into it, by
// name. InfluxDB is the reading's only store (RF009 AC1, #1391), so the
// retired `temperatures` copy is never named.
function importDb() {
  const inserted = {};
  const db = {
    collection: vi.fn((name) => ({
      insertOne: async (doc) => { (inserted[name] ||= []).push(doc); return { insertedId: `${name}-id` }; },
      insertMany: async (docs) => { (inserted[name] ||= []).push(...docs); return { insertedCount: docs.length }; },
    })),
  };
  return { db, inserted };
}

describe('ImportService.importTemperature', () => {
  let write;

  beforeEach(() => {
    write = vi.spyOn(influxTelemetryWriteRepository, 'writeTemperatureReadingNow').mockResolvedValue(PERSISTED_AT);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // #1175: .pipe() does not forward the SOURCE stream's 'error', so a missing
  // file was an uncaught exception that crashed the process (or the
  // temperature worker) instead of this rejection.
  it('rejects when the CSV file does not exist (#1175)', async () => {
    const missingPath = path.join(os.tmpdir(), `import-service-missing-${Date.now()}-temps.csv`);
    const { db } = importDb();

    await expect(importService.importTemperature(db, { path: missingPath, originalname: 'temps.csv' }))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('imports a valid temperature CSV row', async () => {
    const filePath = writeTmpFile('temps.csv', 'sensorId,temperatureValue\nS1,-20\n');
    const { db } = importDb();

    const result = await importService.importTemperature(db, { path: filePath, originalname: 'temps.csv' });

    expect(result).toEqual({ success: 1, errors: [], total: 1 });
    expect(write.mock.calls[0][0].sensorId).toBe('S1');
    expect(write.mock.calls[0][0].temperatureValue).toBe(-20);
  });

  it('records a validation error for a row missing sensorId and still counts it in total', async () => {
    const filePath = writeTmpFile('temps-missing-sensor.csv', 'sensorId,temperatureValue\n,-5\n');
    const { db } = importDb();

    const result = await importService.importTemperature(db, { path: filePath, originalname: 'temps-missing-sensor.csv' });

    expect(result.success).toBe(0);
    expect(result.total).toBe(1);
    expect(result.errors).toEqual([
      expect.objectContaining({ errors: expect.arrayContaining(['sensorId é obrigatório']) }),
    ]);
    expect(write).not.toHaveBeenCalled();
  });

  it('rejects a garbage temperatureValue instead of silently inserting NaN (issue #77)', async () => {
    const filePath = writeTmpFile('temps-garbage-value.csv', 'sensorId,temperatureValue\nS1,not-a-number\n');
    const { db } = importDb();

    const result = await importService.importTemperature(db, { path: filePath, originalname: 'temps-garbage-value.csv' });

    expect(result.success).toBe(0);
    expect(result.errors[0].errors).toEqual(
      expect.arrayContaining(['temperatureValue é obrigatório e deve ser number'])
    );
    expect(write).not.toHaveBeenCalled();
  });

  it('rejects an invalid temperatureUnit', async () => {
    const filePath = writeTmpFile('temps-bad-unit.csv', 'sensorId,temperatureValue,temperatureUnit\nS1,10,X\n');
    const { db } = importDb();

    const result = await importService.importTemperature(db, { path: filePath, originalname: 'temps-bad-unit.csv' });

    expect(result.success).toBe(0);
    expect(result.errors[0].errors).toEqual(expect.arrayContaining(['temperatureUnit deve ser °C, °F ou K']));
    expect(write).not.toHaveBeenCalled();
  });

  it('counts a success and a validation failure, both included in total', async () => {
    const filePath = writeTmpFile('temps-mixed.csv', 'sensorId,temperatureValue\nS1,10\n,20\n');
    const { db } = importDb();

    const result = await importService.importTemperature(db, { path: filePath, originalname: 'temps-mixed.csv' });

    expect(result.total).toBe(2);
    expect(result.success).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(write).toHaveBeenCalledTimes(1);
  });

  // #1317 (RF009 AC1): an imported reading goes through the reading contract
  // and the confirmed InfluxDB write, so the stale check, the report and the
  // history, which read InfluxDB, see it.
  it('writes each imported reading to InfluxDB with the reading contract\'s identity', async () => {
    const observedAt = new Date().toISOString();
    const filePath = writeTmpFile('temps-influx.csv', `sensorId,temperatureValue,temperatureUnit,timestamp\nS1,-20,°C,${observedAt}\n`);
    const { db } = importDb();

    const result = await importService.importTemperature(db, { path: filePath, originalname: 'temps-influx.csv' });

    expect(result).toEqual({ success: 1, errors: [], total: 1 });
    expect(write).toHaveBeenCalledTimes(1);
    const written = write.mock.calls[0][0];
    expect(written).toMatchObject({ sensorId: 'S1', temperatureValue: -20, ingestionService: 'temperature-import' });
    expect(written.telemetryReadingId).toMatch(UUID);
    expect(written.observedAt.toISOString()).toBe(observedAt);
    expect(written.persistedAt).toBe(PERSISTED_AT);
  });

  it('writes no Mongo temperatures copy', async () => {
    const filePath = writeTmpFile('temps-no-copy.csv', 'sensorId,temperatureValue\nS1,-20\n');
    const { db, inserted } = importDb();

    const result = await importService.importTemperature(db, { path: filePath, originalname: 'temps-no-copy.csv' });

    expect(result.success).toBe(1);
    expect(db.collection).not.toHaveBeenCalledWith('temperatures');
    expect(inserted.temperatures).toBeUndefined();
  });

  it('an InfluxDB write failure is a row error', async () => {
    const filePath = writeTmpFile('temps-influx-down.csv', 'sensorId,temperatureValue\nS1,-20\n');
    write.mockRejectedValue(new Error('influx down'));
    const { db } = importDb();

    const result = await importService.importTemperature(db, { path: filePath, originalname: 'temps-influx-down.csv' });

    expect(result).toMatchObject({ success: 0, total: 1 });
    expect(result.errors[0].error).toContain('InfluxDB');
    expect(result.errors[0].error).toContain('influx down');
    expect(db.collection).not.toHaveBeenCalledWith('temperatures');
  });

  it('a reading the contract finds implausible is a row error and is written nowhere', async () => {
    const filePath = writeTmpFile('temps-implausible.csv', 'sensorId,temperatureValue\nS1,9999\n');
    const { db, inserted } = importDb();

    const result = await importService.importTemperature(db, { path: filePath, originalname: 'temps-implausible.csv' });

    expect(result.success).toBe(0);
    expect(result.errors[0].error).toMatch(/plausível/);
    expect(write).not.toHaveBeenCalled();
    expect(Object.values(inserted).flat().filter((doc) => doc.temperatureValue !== undefined)).toHaveLength(0);
  });

  it('a historic timestamp keeps its observedAt and is recorded with clockStatus unknown, not drift', async () => {
    const filePath = writeTmpFile('temps-historic.csv', 'sensorId,temperatureValue,temperatureUnit,timestamp\nS1,-20,°C,2020-01-01T00:00:00Z\n');
    const { db } = importDb();

    const result = await importService.importTemperature(db, { path: filePath, originalname: 'temps-historic.csv' });

    const written = write.mock.calls[0][0];
    expect(written.clockStatus).toBe('unknown');
    expect(written.observedAt.toISOString()).toBe('2020-01-01T00:00:00.000Z');
    expect(result.success).toBe(1);
  });
});

// RULE-025 (#1582): a row's cells outside the import's contract are stripped
// before hash, screen and store; a trustworthy row is imported and flagged,
// an untrustworthy one is still refused whole, and each row with such a cell
// writes one security audit naming the column, never its value. A blank cell
// carries no value and flags nothing.
describe('RULE-025 on the temperature import (#1582)', () => {
  const PII_NAME = 'Maria da Silva 123.456.789-09';
  let write;
  let logSpy;

  beforeEach(() => {
    write = vi.spyOn(influxTelemetryWriteRepository, 'writeTemperatureReadingNow').mockResolvedValue(PERSISTED_AT);
    vi.spyOn(auditLogger, 'init').mockImplementation(() => {});
    logSpy = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const strippedAudits = () => logSpy.mock.calls
    .map(([entry]) => entry)
    .filter((entry) => entry && entry.action === 'TELEMETRY_PII_STRIPPED');

  it('(a) imports a valid row with an extra column and audits it', async () => {
    const filePath = writeTmpFile('temps-pii.csv', `sensorId,temperatureValue,patientName\nS1,-20,${PII_NAME}\n`);
    const { db, inserted } = importDb();

    const result = await importService.importTemperature(db, { path: filePath, originalname: 'temps-pii.csv' });

    expect(result).toEqual({ success: 1, errors: [], total: 1 });
    expect(write).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(write.mock.calls[0][0])).not.toContain('Maria');
    expect(strippedAudits()).toEqual([expect.objectContaining({
      resourceType: 'TelemetryReading',
      resourceId: 'S1',
      source: 'worker',
      payload: { ingestionService: 'temperature-import', fieldNames: ['patientName'], unlistedFieldCount: 0 },
    })]);
    expect((inserted.telemetryValidationIssues || []).filter((issue) => issue.issueCode === 'personal_data_stripped'))
      .toEqual([expect.objectContaining({ fieldPath: 'patientName', disposition: 'quarantined' })]);
  });

  it('(b) refuses an implausible row whole and still audits its extra column', async () => {
    const filePath = writeTmpFile('temps-pii-implausible.csv', `sensorId,temperatureValue,patientName\nS1,900,${PII_NAME}\n`);
    const { db } = importDb();

    const result = await importService.importTemperature(db, { path: filePath, originalname: 'temps-pii-implausible.csv' });

    expect(result.success).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(write).not.toHaveBeenCalled();
    expect(strippedAudits()).toHaveLength(1);
  });

  it('(c) a blank extra column flags nothing', async () => {
    const filePath = writeTmpFile('temps-blank-extra.csv', 'sensorId,temperatureValue,notes,remark\nS1,-20,,   \n');
    const { db, inserted } = importDb();

    const result = await importService.importTemperature(db, { path: filePath, originalname: 'temps-blank-extra.csv' });

    expect(result.success).toBe(1);
    expect(strippedAudits()).toHaveLength(0);
    expect((inserted.telemetryValidationIssues || []).filter((issue) => issue.issueCode === 'personal_data_stripped')).toHaveLength(0);
  });

  it('(d) no extra cell value reaches a row error or a log', async () => {
    const logCalls = Object.keys(logger)
      .filter((name) => typeof logger[name] === 'function')
      .map((name) => vi.spyOn(logger, name).mockImplementation(() => {}));
    const filePath = writeTmpFile('temps-pii-mixed.csv', `sensorId,temperatureValue,patientName,cpf\nS1,-20,${PII_NAME},12345678909\nS1,900,${PII_NAME},12345678909\n`);
    const { db } = importDb();

    const result = await importService.importTemperature(db, { path: filePath, originalname: 'temps-pii-mixed.csv' });

    expect(result).toMatchObject({ success: 1, total: 2 });
    expect(result.errors).toHaveLength(1);
    const seen = JSON.stringify([result.errors, ...logCalls.flatMap((spy) => spy.mock.calls), logSpy.mock.calls]);
    expect(seen).not.toContain('Maria');
    expect(seen).not.toContain('12345678909');
  });

  // Only an extra column's blank cell goes uncounted: a whitespace-only
  // contract cell reaches the parser as received and is refused as before,
  // never replaced by the parser's default.
  it('(e) a whitespace-only timestamp cell is still a row error', async () => {
    const filePath = writeTmpFile('temps-blank-timestamp.csv', 'sensorId,temperatureValue,timestamp\nS1,-20,   \n');
    const { db } = importDb();

    const result = await importService.importTemperature(db, { path: filePath, originalname: 'temps-blank-timestamp.csv' });

    expect(result).toMatchObject({ success: 0, total: 1 });
    expect(result.errors).toEqual([expect.objectContaining({ row: 1, error: expect.stringMatching(/timestamp deve ser uma data ISO 8601/) })]);
    expect(write).not.toHaveBeenCalled();
  });

  it('(f) a whitespace-only temperatureUnit cell is still a row error', async () => {
    const filePath = writeTmpFile('temps-blank-unit.csv', 'sensorId,temperatureValue,temperatureUnit\nS1,-20,  \n');
    const { db } = importDb();

    const result = await importService.importTemperature(db, { path: filePath, originalname: 'temps-blank-unit.csv' });

    expect(result).toMatchObject({ success: 0, total: 1 });
    expect(result.errors).toEqual([expect.objectContaining({ row: 1, errors: expect.arrayContaining([expect.stringMatching(/temperatureUnit/)]) })]);
    expect(write).not.toHaveBeenCalled();
  });
});
