import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';
import os from 'os';
import path from 'path';
import fs from 'fs';

const require2 = createRequire(import.meta.url);
const importService = require2('../../src/services/import.service');
const notificationService = require2('../../src/services/notification.service');

const tmpFiles = [];

function writeTmpFile(name, content) {
  const filePath = path.join(os.tmpdir(), `import-service-patients-${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`);
  fs.writeFileSync(filePath, content);
  tmpFiles.push(filePath);
  return filePath;
}

afterEach(() => {
  vi.restoreAllMocks();
  while (tmpFiles.length) {
    const f = tmpFiles.pop();
    try { fs.unlinkSync(f); } catch (_) { /* already gone */ }
  }
});

function makePatientsCollection({ existing = null } = {}) {
  const inserted = [];
  const updates = [];
  return {
    inserted,
    updates,
    findOne: async () => existing,
    insertOne: async (doc) => {
      inserted.push(doc);
      return { insertedId: 'patient-1' };
    },
    updateOne: async (query, update) => {
      updates.push({ query, update });
      return { modifiedCount: 1 };
    },
  };
}

const validPatient = (overrides = {}) => ({
  patientName: 'Maria Silva',
  birthDate: '1985-05-20',
  sex: 'F',
  email: 'maria@example.com',
  consentTemplateId: 'tcle-1',
  cpf: '12345678900',
  ...overrides,
});

describe('ImportService.importPatients (JSON)', () => {
  it('inserts a new patient without a patientID and does not attempt consent notification', async () => {
    const notifySpy = vi.spyOn(notificationService, 'enqueueConsentNotification');
    const filePath = writeTmpFile('new.json', JSON.stringify(validPatient()));
    const collection = makePatientsCollection();
    const db = { collection: () => collection };

    const result = await importService.importPatients(db, { path: filePath, originalname: 'new.json' });

    expect(result.success).toBe(1);
    expect(result.total).toBe(1);
    expect(result.errors).toEqual([]);
    expect(collection.inserted).toHaveLength(1);
    expect(collection.inserted[0].status).toBe('PENDING_CONSENT');
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it('enqueues a consent notification when the incoming patient has a patientID', async () => {
    const notifySpy = vi.spyOn(notificationService, 'enqueueConsentNotification').mockResolvedValue([{ channel: 'email', success: true }]);
    const filePath = writeTmpFile('with-id.json', JSON.stringify(validPatient({ patientID: 'P-001' })));
    const collection = makePatientsCollection();

    const result = await importService.importPatients({ collection: () => collection }, { path: filePath, originalname: 'with-id.json' });

    expect(result.success).toBe(1);
    expect(notifySpy).toHaveBeenCalledTimes(1);
    expect(collection.updates).toHaveLength(1);
    expect(collection.updates[0].update.$set.consentNotifiedAt).toBeInstanceOf(Date);
  });

  it('swallows notification errors and still counts the patient as successfully imported', async () => {
    vi.spyOn(notificationService, 'enqueueConsentNotification').mockRejectedValue(new Error('queue down'));
    const filePath = writeTmpFile('notify-fails.json', JSON.stringify(validPatient({ patientID: 'P-002' })));
    const collection = makePatientsCollection();

    const result = await importService.importPatients({ collection: () => collection }, { path: filePath, originalname: 'notify-fails.json' });

    expect(result.success).toBe(1);
    expect(result.errors).toEqual([]);
    expect(collection.updates).toHaveLength(0);
  });

  it('merges into an existing patient found by cpf', async () => {
    const filePath = writeTmpFile('merge.json', JSON.stringify(validPatient({ notes: 'Updated note' })));
    const collection = makePatientsCollection({ existing: { _id: 'existing-1', cpf: '12345678900', birthDate: '1985-05-20' } });

    const result = await importService.importPatients({ collection: () => collection }, { path: filePath, originalname: 'merge.json' });

    expect(result.success).toBe(1);
    expect(collection.updates).toHaveLength(1);
    expect(collection.updates[0].update.$set.notes).toBe('Updated note');
    expect(collection.updates[0].update.$set.updatedAt).toBeInstanceOf(Date);
  });

  it('records a merge error when birthDate conflicts with the existing record', async () => {
    const filePath = writeTmpFile('conflict.json', JSON.stringify(validPatient({ birthDate: '1999-01-01' })));
    const collection = makePatientsCollection({ existing: { _id: 'existing-1', cpf: '12345678900', birthDate: '1985-05-20' } });

    const result = await importService.importPatients({ collection: () => collection }, { path: filePath, originalname: 'conflict.json' });

    expect(result.success).toBe(0);
    expect(result.errors).toEqual([
      expect.objectContaining({ error: expect.stringContaining('Data de nascimento') }),
    ]);
    expect(collection.updates).toHaveLength(0);
  });

  it('skips a patient with neither cpf nor recordNumber, recording the reason as an error', async () => {
    const filePath = writeTmpFile('no-id.json', JSON.stringify(validPatient({ cpf: undefined })));
    const collection = makePatientsCollection();

    const result = await importService.importPatients({ collection: () => collection }, { path: filePath, originalname: 'no-id.json' });

    expect(result.success).toBe(0);
    expect(result.total).toBe(1);
    expect(result.errors).toEqual([
      expect.objectContaining({ error: expect.stringContaining('Sem identificador único') }),
    ]);
    expect(collection.inserted).toHaveLength(0);
  });

  // NOTE: `total` does NOT count this row (documenting a real bug, not asserting
  // desired behavior) - the `continue` on a validation failure skips the
  // `results.total++` at the bottom of the loop, same undercounting pattern
  // already filed for importTemperature (issue #79) and import-lgpd.service.js
  // (issue #65); filed separately for importPatients as issue #86.
  it('records a model-validation error and does not insert when required fields are missing (total undercounts due to a known bug)', async () => {
    const filePath = writeTmpFile('invalid.json', JSON.stringify({ patientName: '', sex: 'X' }));
    const collection = makePatientsCollection();

    const result = await importService.importPatients({ collection: () => collection }, { path: filePath, originalname: 'invalid.json' });

    expect(result.success).toBe(0);
    expect(result.total).toBe(0);
    expect(result.errors[0].errors.length).toBeGreaterThan(0);
    expect(collection.inserted).toHaveLength(0);
  });

  // NOTE: `total` ends at 1, not 2 - same known-bug undercounting as above (issue #86).
  it('imports an array of JSON patients, counting successes but total undercounts the invalid row (known bug)', async () => {
    const filePath = writeTmpFile('array.json', JSON.stringify([
      validPatient({ cpf: '11111111111' }),
      { patientName: '', sex: 'X' },
    ]));
    const collection = makePatientsCollection();

    const result = await importService.importPatients({ collection: () => collection }, { path: filePath, originalname: 'array.json' });

    expect(result.total).toBe(1);
    expect(result.success).toBe(1);
    expect(result.errors).toHaveLength(1);
  });
});

describe('ImportService.importPatients (CSV)', () => {
  it('successfully imports a CSV row with email/consentTemplateId/cpf mapped (fixed, issue #87)', async () => {
    const filePath = writeTmpFile('patients.csv', 'patientName,birthDate,sex,email,consentTemplateId,cpf\nJoão Souza,1990-01-01,M,joao@example.com,tcle-1,98765432100\n');
    const collection = makePatientsCollection();

    const result = await importService.importPatients({ collection: () => collection }, { path: filePath, originalname: 'patients.csv' });

    expect(result.success).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(collection.inserted).toHaveLength(1);
    expect(collection.inserted[0]).toMatchObject({
      email: 'joao@example.com',
      consentTemplateId: 'tcle-1',
      cpf: '98765432100',
    });
  });

  it('records an error for a CSV row that fails model validation', async () => {
    const filePath = writeTmpFile('patients-invalid.csv', 'patientName,birthDate,sex,email,consentTemplateId,cpf\n,1990-01-01,M,joao@example.com,tcle-1,98765432100\n');
    const collection = makePatientsCollection();

    const result = await importService.importPatients({ collection: () => collection }, { path: filePath, originalname: 'patients-invalid.csv' });

    expect(result.success).toBe(0);
    expect(result.errors).toHaveLength(1);
  });
});

describe('ImportService.importPatients (top-level error)', () => {
  it('rejects when the file does not exist', async () => {
    await expect(importService.importPatients({}, {
      path: path.join(os.tmpdir(), 'does-not-exist-patients.json'),
      originalname: 'does-not-exist-patients.json',
    })).rejects.toThrow();
  });
});
