import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ──────────────────────────────────────────────────────────
// ImportLGPDService.importPatients — DB-backed method
//
// getCollection/generateUniquePatientID are destructured at module scope in
// import-lgpd.service.js, so vi.spyOn on their exporting modules would
// silently no-op (see testing-conventions' "vi.spyOn also silently fails if
// the source file destructures the import"). Instead we drive them for real
// against a fake `db.collection()` — both are thin wrappers that just call
// db.collection(name) when db has no `listCollections`.
//
// notificationService/patientService are required as module objects (not
// destructured), so vi.spyOn on the real singletons works normally.
// ──────────────────────────────────────────────────────────

vi.mock('../../src/services/PatientIdentityService', () => ({}));
vi.mock('../../src/services/DrugService', () => ({}));
vi.mock('../../src/services/SampleGraphValidator', () => ({ default: class {} }));
vi.mock('../../src/services/MerkleService', () => ({ generateSampleHash: vi.fn() }));
vi.mock('../../src/services/quality-domain.service', () => ({}));

const service = require('../../src/services/import-lgpd.service');
const notificationService = require('../../src/services/notification.service');
const patientService = require('../../src/services/patient.service');
const PatientModel = require('../../src/models/Patient');

const VALID_ROW = {
  patientName: 'Maria Silva',
  birthDate: '15/06/1985',
  sex: 'F',
  email: 'maria@example.com',
  consentTemplateId: '64d0f0f0f0f0f0f0f0f0f0f0',
};

function makeDb({ templateFound = true } = {}) {
  const patientsCollection = {
    insertOne: vi.fn().mockResolvedValue({ insertedId: 'patient-id-1' }),
    updateOne: vi.fn().mockResolvedValue({}),
  };
  const consentTemplatesCollection = {
    findOne: vi.fn().mockResolvedValue(templateFound ? { _id: 'tpl' } : null),
  };
  // generateUniquePatientID looks up db.collection('pacientes').findOne({patientID})
  const pacientesCollection = {
    findOne: vi.fn().mockResolvedValue(null), // no collision -> first generated ID wins
  };

  const collections = {
    patients: patientsCollection,
    consent_templates: consentTemplatesCollection,
    pacientes: pacientesCollection,
  };

  const db = {
    // No listCollections -> getCollection's resolveCollectionName short-circuits
    // to the canonical/requested name and just calls db.collection(name).
    collection: vi.fn((name) => {
      if (!collections[name]) {
        throw new Error(`unexpected collection requested: ${name}`);
      }
      return collections[name];
    }),
  };

  return { db, patientsCollection, consentTemplatesCollection, pacientesCollection };
}

describe('ImportLGPDService.importPatients', () => {
  let db;
  let patientsCollection;
  let consentTemplatesCollection;

  beforeEach(() => {
    ({ db, patientsCollection, consentTemplatesCollection } = makeDb());

    vi.spyOn(notificationService, 'buildConsentMetadata').mockReturnValue({
      token: 'tok-1',
      createdAt: new Date('2026-01-01'),
      expiresAt: new Date('2026-02-01'),
    });
    vi.spyOn(notificationService, 'buildConsentLink').mockReturnValue('https://example.com/consent/tok-1');
    vi.spyOn(notificationService, 'enqueueConsentNotification').mockResolvedValue(undefined);
    vi.spyOn(patientService, 'checkDuplicatePatient').mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws when readFile returns no rows', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([]);
    await expect(
      service.importPatients(db, { path: '/x.csv', originalname: 'x.csv' })
    ).rejects.toThrow('Arquivo está vazio ou não contém dados válidos');
  });

  it('throws when every row is an empty object (no usable headers)', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([{}]);
    await expect(
      service.importPatients(db, { path: '/x.csv', originalname: 'x.csv' })
    ).rejects.toThrow('Arquivo não contém dados válidos');
  });

  it('throws when required headers are missing', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([{ patientName: 'Only Name' }]);
    await expect(
      service.importPatients(db, { path: '/x.csv', originalname: 'x.csv' })
    ).rejects.toThrow(/Campos obrigatórios ausentes/);
  });

  it('records a per-row error when email is missing/invalid, and continues', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([{ ...VALID_ROW, email: 'not-an-email' }]);
    const result = await service.importPatients(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.success).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].errors[0]).toMatch(/Email/);
    expect(patientsCollection.insertOne).not.toHaveBeenCalled();
    // Confirmed bug (see wrap-up/issue): `results.total++` sits after the row's
    // try block, so the `continue` on an early per-field rejection skips it —
    // `total` under-counts any row that fails field validation, unlike a row
    // that throws (caught by the outer catch, which falls through to the
    // increment) or one that succeeds.
    expect(result.total).toBe(0);
  });

  it('records a per-row error when consentTemplateId is missing', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([{ ...VALID_ROW, consentTemplateId: '' }]);
    const result = await service.importPatients(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.success).toBe(0);
    expect(result.errors[0].errors[0]).toMatch(/Template de consentimento .* é obrigatório/);
  });

  it('records a per-row error when consentTemplateId is not a valid ObjectId', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([{ ...VALID_ROW, consentTemplateId: 'not-an-id' }]);
    const result = await service.importPatients(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.errors[0].errors[0]).toMatch(/consentTemplateId inválido/);
    expect(consentTemplatesCollection.findOne).not.toHaveBeenCalled();
  });

  it('records a per-row error when the consent template does not exist', async () => {
    ({ db, patientsCollection, consentTemplatesCollection } = makeDb({ templateFound: false }));
    vi.spyOn(service, 'readFile').mockResolvedValue([VALID_ROW]);

    const result = await service.importPatients(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.errors[0].errors[0]).toMatch(/Template de consentimento não encontrado/);
    expect(patientsCollection.insertOne).not.toHaveBeenCalled();
  });

  it('records a per-row error and skips insert when the patient is a duplicate', async () => {
    patientService.checkDuplicatePatient.mockResolvedValue({ _id: 'existing' });
    vi.spyOn(service, 'readFile').mockResolvedValue([VALID_ROW]);

    const result = await service.importPatients(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.success).toBe(0);
    expect(result.errors[0].errors[0]).toMatch(/Paciente duplicado/);
    expect(patientsCollection.insertOne).not.toHaveBeenCalled();
  });

  it('imports a valid row end-to-end: generates an ID, sets PENDING_CONSENT, inserts, and enqueues a consent notification', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([VALID_ROW]);

    const result = await service.importPatients(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.success).toBe(1);
    expect(result.total).toBe(1);
    expect(result.errors).toHaveLength(0);
    // LGPD: generated patient IDs must never be echoed back in the response
    expect(result.generatedIDs).toBeUndefined();

    expect(patientsCollection.insertOne).toHaveBeenCalledTimes(1);
    const insertedPatient = patientsCollection.insertOne.mock.calls[0][0];
    expect(insertedPatient.patientID).toMatch(/^\d{8}$/);
    expect(insertedPatient.status).toBe('PENDING_CONSENT');
    expect(insertedPatient.consentToken).toBe('tok-1');

    expect(notificationService.enqueueConsentNotification).toHaveBeenCalledTimes(1);
    expect(patientsCollection.updateOne).toHaveBeenCalledWith(
      { _id: 'patient-id-1' },
      { $set: { consentNotifiedAt: expect.any(Date) } }
    );
  });

  it('still counts the row as a success when notification enqueueing fails (the failure is logged, not fatal)', async () => {
    notificationService.enqueueConsentNotification.mockRejectedValue(new Error('queue down'));
    vi.spyOn(service, 'readFile').mockResolvedValue([VALID_ROW]);

    const result = await service.importPatients(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.success).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(patientsCollection.updateOne).not.toHaveBeenCalled();
  });

  it('honors a groupFields.consentTemplateId fallback when the row omits its own', async () => {
    const rowWithoutTemplate = { ...VALID_ROW };
    delete rowWithoutTemplate.consentTemplateId;
    vi.spyOn(service, 'readFile').mockResolvedValue([rowWithoutTemplate]);

    const result = await service.importPatients(
      db,
      { path: '/x.csv', originalname: 'x.csv' },
      { groupFields: { consentTemplateId: '64d0f0f0f0f0f0f0f0f0f0f0' } }
    );

    expect(result.success).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  it('propagates the underlying error (and never reaches the DB) when reading the file fails', async () => {
    vi.spyOn(service, 'readFile').mockRejectedValue(new Error('Arquivo não encontrado'));

    await expect(
      service.importPatients(db, { path: '/missing.csv', originalname: 'missing.csv' })
    ).rejects.toThrow('Arquivo não encontrado');
    expect(db.collection).not.toHaveBeenCalled();
  });

  it('records a per-row error when patientName is blank', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([{ ...VALID_ROW, patientName: '   ' }]);
    const result = await service.importPatients(db, { path: '/x.csv', originalname: 'x.csv' });
    expect(result.errors[0].errors[0]).toMatch(/Nome do paciente .* obrigatório/);
  });

  it('records a per-row error when birthDate does not parse', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([{ ...VALID_ROW, birthDate: 'not-a-date' }]);
    const result = await service.importPatients(db, { path: '/x.csv', originalname: 'x.csv' });
    expect(result.errors[0].errors[0]).toMatch(/Data de nascimento .* obrigatória/);
  });

  it('records a per-row error when sex is missing/invalid', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([{ ...VALID_ROW, sex: 'X' }]);
    const result = await service.importPatients(db, { path: '/x.csv', originalname: 'x.csv' });
    expect(result.errors[0].errors[0]).toMatch(/Sexo .* obrigatório/);
  });

  it('normalizes a numeric-string recordNumber to a number, and blanks an empty/placeholder one to null', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([
      { ...VALID_ROW, recordNumber: '123' },
      { ...VALID_ROW, recordNumber: 'null' },
    ]);
    const result = await service.importPatients(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.success).toBe(2);
    const [first, second] = patientsCollection.insertOne.mock.calls;
    expect(first[0].recordNumber).toBe(123);
    expect(second[0].recordNumber).toBeNull();
  });

  it('keeps a non-numeric recordNumber string as-is', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([{ ...VALID_ROW, recordNumber: 'ABC-1' }]);
    const result = await service.importPatients(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.success).toBe(1);
    expect(patientsCollection.insertOne.mock.calls[0][0].recordNumber).toBe('ABC-1');
  });

  it('generates a clinicalUnit acronym when clinicalUnit is provided without one', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([{ ...VALID_ROW, clinicalUnit: 'Hospital das Clinicas' }]);
    const result = await service.importPatients(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.success).toBe(1);
    expect(patientsCollection.insertOne.mock.calls[0][0].unitAcronym).toBeTruthy();
  });

  it('records a per-row error when clinicalUnit fails PatientModel.validateUnit (defensive branch: validateUnit currently always passes any truthy string, so this is only reachable by forcing it)', async () => {
    vi.spyOn(PatientModel, 'validateUnit').mockReturnValue(false);
    vi.spyOn(service, 'readFile').mockResolvedValue([{ ...VALID_ROW, clinicalUnit: 'Some Unit' }]);

    const result = await service.importPatients(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.errors[0].errors[0]).toMatch(/Unidade clínica inválida/);
    PatientModel.validateUnit.mockRestore();
  });

  it('formats a Date birthDate into pt-BR for the duplicate-patient error message', async () => {
    patientService.checkDuplicatePatient.mockResolvedValue({ _id: 'existing' });
    vi.spyOn(service, 'readFile').mockResolvedValue([VALID_ROW]);

    const result = await service.importPatients(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.errors[0].errors[0]).toMatch(/Paciente duplicado.*\d{2}\/\d{2}\/\d{4}/);
  });

  it('catches a row-level exception, logs it, and records it as a row error rather than aborting the whole import', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([VALID_ROW, VALID_ROW]);
    patientService.checkDuplicatePatient
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('db exploded'));

    const result = await service.importPatients(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.total).toBe(2);
    expect(result.success).toBe(1);
    expect(result.errors[0].errors[0]).toMatch(/db exploded/);
  });

  it('skips a row that parses to no data at all (all fields blank) without counting it', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([{}, VALID_ROW]);
    const result = await service.importPatients(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.total).toBe(1);
    expect(result.success).toBe(1);
  });

  it('warns but still imports when a patientID column is present in the file (it is ignored)', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([{ ...VALID_ROW, patientID: '99999999' }]);
    const result = await service.importPatients(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.success).toBe(1);
    expect(patientsCollection.insertOne.mock.calls[0][0].patientID).not.toBe('99999999');
  });
});
