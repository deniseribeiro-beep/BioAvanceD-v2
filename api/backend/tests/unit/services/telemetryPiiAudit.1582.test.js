import { describe, it, expect, vi, afterEach } from 'vitest';

// RULE-025, RF009 AC8 (#1582): a payload carrying fields outside its path's
// reading contract writes one security AuditEvent at receipt, naming the
// listable field names and counting the rest, never a value.

const { auditStrippedFields, splitContractFields, IOT_API_READING_FIELDS } = require('../../../src/services/telemetryReadingContract');
const auditLogger = require('../../../src/utils/auditLogger');
const logger = require('../../../src/utils/logger');

afterEach(() => { vi.restoreAllMocks(); });

const PII_VALUE = 'Maria da Silva 123.456.789-09';

function fakeDb() {
  const collections = {};
  const collectionOf = (name) => {
    collections[name] = collections[name] || {
      collectionName: name,
      createIndex: vi.fn().mockResolvedValue('ok'),
      findOne: vi.fn().mockResolvedValue(null),
      find: vi.fn(() => ({ sort: () => ({ limit: () => ({ next: async () => null, toArray: async () => [] }) }), toArray: async () => [] })),
      insertOne: vi.fn().mockResolvedValue({ insertedId: `${name}-id` }),
      insertMany: vi.fn().mockResolvedValue({ insertedCount: 1 }),
      updateOne: vi.fn().mockResolvedValue({}),
      countDocuments: vi.fn().mockResolvedValue(0),
    };
    return collections[name];
  };
  return { db: { collection: vi.fn(collectionOf) }, collectionOf, collections };
}

describe('auditStrippedFields', () => {
  it('writes one warning AuditEvent naming the fields, never a value', async () => {
    const log = vi.spyOn(auditLogger, 'log').mockResolvedValue(undefined);
    const { db } = fakeDb();
    const { strippedFields } = splitContractFields({ sensorId: 's1', temperature: 4, patientName: PII_VALUE, 'e-mail': 'maria@example.org' }, IOT_API_READING_FIELDS);
    await expect(auditStrippedFields(db, { ingestionService: 'iot-api', strippedFields, sensorId: 's1' })).resolves.toBe(true);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toMatchObject({
      action: 'TELEMETRY_PII_STRIPPED', resourceType: 'TelemetryReading', resourceId: 's1', severity: 'warning', source: 'api',
      payload: { ingestionService: 'iot-api', fieldNames: ['patientName'], unlistedFieldCount: 1 },
    });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/Maria|maria@example|e-mail/);
  });

  it('control: no stripped field writes nothing', async () => {
    const log = vi.spyOn(auditLogger, 'log');
    const { db } = fakeDb();
    await expect(auditStrippedFields(db, { ingestionService: 'mqtt', strippedFields: [] })).resolves.toBe(false);
    expect(log).not.toHaveBeenCalled();
  });

  it('a real auditLogger row reaches the logs collection without the value', async () => {
    const { db, collections } = fakeDb();
    await auditStrippedFields(async () => db, { ingestionService: 'mqtt', strippedFields: ['cpf'], sensorId: 's1' });
    const rows = Object.values(collections).flatMap((c) => c.insertOne.mock.calls.map((call) => call[0]));
    const row = collections.logs?.insertOne.mock.calls[0]?.[0];
    expect(row).toMatchObject({ action: 'TELEMETRY_PII_STRIPPED', severity: 'warning', source: 'mqtt' });
    expect(JSON.stringify(rows)).not.toContain('123.456');
  });

  it('a failed write is logged and resolves false', async () => {
    vi.spyOn(auditLogger, 'log').mockRejectedValue(new Error('down'));
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    await expect(auditStrippedFields(async () => ({}), { ingestionService: 'mqtt', strippedFields: ['cpf'] })).resolves.toBe(false);
    expect(error).toHaveBeenCalledTimes(1);
  });
});
