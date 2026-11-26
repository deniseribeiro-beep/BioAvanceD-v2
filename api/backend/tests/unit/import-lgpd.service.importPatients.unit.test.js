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
const participantIdentityService = require('../../src/services/participantIdentity.service');
const { hashConsentToken } = require('../../src/utils/consentTokenHash');

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
  // RF005/RNF007 (#363/#563): create dual-writes ParticipantIdentity.
  const participantIdentitiesCollection = {
    insertOne: vi.fn().mockResolvedValue({ insertedId: 'identity-id-1' }),
  };
  // #814 (RNF011 AC#4): rejected rows are quarantined via the same
  // import_batches/import_staging_records pair #787 already uses for
  // importSamples, reached through the shared quarantineRejectedSampleRows.
  const importBatchesCollection = {
    insertOne: vi.fn().mockResolvedValue({ insertedId: 'batch-1' }),
  };
  const importStagingRecordsCollection = {
    insertMany: vi.fn().mockResolvedValue({ insertedCount: 1 }),
  };

  const collections = {
    patients: patientsCollection,
    consent_templates: consentTemplatesCollection,
    pacientes: pacientesCollection,
    participantIdentities: participantIdentitiesCollection,
    import_batches: importBatchesCollection,
    import_staging_records: importStagingRecordsCollection,
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

  return {
    db,
    patientsCollection,
    consentTemplatesCollection,
    pacientesCollection,
    participantIdentitiesCollection,
    importBatchesCollection,
    importStagingRecordsCollection,
  };
}

describe('ImportLGPDService.importPatients', () => {
  let db;
  let patientsCollection;
  let consentTemplatesCollection;
  let participantIdentitiesCollection;
  let importBatchesCollection;
  let importStagingRecordsCollection;

  beforeEach(() => {
    ({ db, patientsCollection, consentTemplatesCollection, participantIdentitiesCollection, importBatchesCollection, importStagingRecordsCollection } = makeDb());

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
    // A row rejected by field validation still counts toward total (#65) —
    // only the same shape as a row that throws or one that succeeds.
    expect(result.total).toBe(1);
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
    // #969: the counter is incremented at :691 but was dropped from the return
    // literal, so patient-worker read `undefined`. Still load-bearing after
    // #1007: import-worker now OMITS the field when the result lacks it, so an
    // absent key here would hide the LGPD "Duplicados" tile rather than
    // writing a constant 0.
    expect(result.duplicates).toBe(1);
  });

  it('#969: returns `duplicates` as a real key even when nothing was rejected, so the worker cannot read undefined', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([VALID_ROW]);

    const result = await service.importPatients(db, { path: '/x.csv', originalname: 'x.csv' });

    // `toHaveProperty` rather than `toBe(0)`: the defect was an ABSENT key,
    // and `expect(undefined).toBe(0)` and `expect(0).toBe(0)` are the only
    // two things that distinguish it. A missing key must fail here.
    expect(result).toHaveProperty('duplicates');
    expect(result.duplicates).toBe(0);
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
    expect(insertedPatient.participantId).toMatch(/^\d{8}$/);
    expect(insertedPatient.status).toBe('PENDING_CONSENT');
    // #1049: only the hash of the minted token is persisted.
    expect(insertedPatient.consentTokenHash).toBe(hashConsentToken('tok-1'));
    expect(insertedPatient.consentToken).toBeUndefined();

    expect(notificationService.enqueueConsentNotification).toHaveBeenCalledTimes(1);
    expect(patientsCollection.updateOne).toHaveBeenCalledWith(
      { _id: 'patient-id-1' },
      { $set: { consentNotifiedAt: expect.any(Date) } }
    );

    // RF005/RNF007 (#363/#563): create also dual-writes ParticipantIdentity.
    expect(participantIdentitiesCollection.insertOne).toHaveBeenCalledTimes(1);
    const insertedIdentity = participantIdentitiesCollection.insertOne.mock.calls[0][0];
    expect(insertedIdentity.participantId).toBe(insertedPatient.participantId);
    // #1104: ciphertext-only -- no plaintext at rest, recovered by decryption.
    const identityCrypto = require('../../src/services/participantIdentity.service');
    expect(insertedIdentity.patientName).toBeNull();
    expect(identityCrypto.decryptIdentity(insertedIdentity).patientName).toBe('Maria Silva');
  });

  // #1166 slice 3: the identity row is written after the Patient row, and it
  // can now be refused on its own (the phoneHash unique index). The Patient
  // row must not survive that with no identity.
  it('#1166: rolls back the Patient row when the identity insert fails', async () => {
    participantIdentitiesCollection.insertOne.mockRejectedValue(
      Object.assign(new Error('E11000 duplicate key'), { code: 11000, keyPattern: { phoneHash: 1 } })
    );
    patientsCollection.deleteOne = vi.fn().mockResolvedValue({ deletedCount: 1 });
    vi.spyOn(service, 'readFile').mockResolvedValue([VALID_ROW]);

    const result = await service.importPatients(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.success).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(patientsCollection.deleteOne).toHaveBeenCalledWith({ _id: 'patient-id-1' });
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

  // #1386: the record number is stored on ParticipantIdentity alone
  // (P1X-0355), as a string whatever type importPatients parsed it to
  // upstream, so a numeric-string input round-trips back to a string. A
  // blanked one leaves the identity with no number at all.
  const insertedRecordNumbers = () => participantIdentitiesCollection.insertOne.mock.calls.map(
    ([identity]) => participantIdentityService.decryptIdentity(identity).recordNumber
  );

  it('normalizes a numeric-string recordNumber to a string, and blanks an empty/placeholder one to null', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([
      { ...VALID_ROW, recordNumber: '123' },
      { ...VALID_ROW, recordNumber: 'null' },
    ]);
    const result = await service.importPatients(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.success).toBe(2);
    for (const [patient] of patientsCollection.insertOne.mock.calls) {
      expect(patient).not.toHaveProperty('recordNumber');
    }
    expect(insertedRecordNumbers()).toEqual(['123', undefined]);
    expect(participantIdentitiesCollection.insertOne.mock.calls[1][0]).not.toHaveProperty('recordNumberCiphertext');
  });

  it('blanks "undefined" and "NaN" placeholder recordNumber strings to null (same branch as the "null" placeholder)', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([
      { ...VALID_ROW, recordNumber: 'undefined' },
      { ...VALID_ROW, recordNumber: 'NaN' },
    ]);
    const result = await service.importPatients(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.success).toBe(2);
    expect(insertedRecordNumbers()).toEqual([undefined, undefined]);
    for (const [identity] of participantIdentitiesCollection.insertOne.mock.calls) {
      expect(identity).not.toHaveProperty('recordNumberCiphertext');
    }
  });

  it('keeps a non-numeric recordNumber string as-is', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([{ ...VALID_ROW, recordNumber: 'ABC-1' }]);
    const result = await service.importPatients(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.success).toBe(1);
    expect(patientsCollection.insertOne.mock.calls[0][0]).not.toHaveProperty('recordNumber');
    expect(insertedRecordNumbers()).toEqual(['ABC-1']);
  });

  // #1353: the tenancy key the scoped participant readers filter on.
  it('stamps the resolved organizationId as each imported participant\'s clinicalUnitId (#1353)', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([VALID_ROW]);
    const result = await service.importPatients(db, { path: '/x.csv', originalname: 'x.csv' }, { organizationId: 'ORG-OWN' });

    expect(result.success).toBe(1);
    expect(patientsCollection.insertOne.mock.calls[0][0].clinicalUnitId).toBe('ORG-OWN');
  });

  it('leaves clinicalUnitId unset when no organizationId was resolved (#1353)', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([VALID_ROW]);
    const result = await service.importPatients(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.success).toBe(1);
    expect(patientsCollection.insertOne.mock.calls[0][0].clinicalUnitId).toBeNull();
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

  // #1012: readCSV/readExcel drop a blank row before this array ever exists
  // (see the #1001 seeding test below), so a real reader can never hand
  // importPatients a `{}` row -- feeding one directly, as this test used to,
  // exercised a per-row isEmptyRow backstop that production input can't
  // reach. Seeded via rows.skippedCount instead, the same way the reader
  // reports it.
  it('skips a row that parses to no data at all without counting it (#1012)', async () => {
    const rows = [VALID_ROW];
    Object.defineProperty(rows, 'skippedCount', { value: 1, enumerable: false });
    vi.spyOn(service, 'readFile').mockResolvedValue(rows);
    const result = await service.importPatients(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.total).toBe(1);
    expect(result.success).toBe(1);
  });

  // #798: blank rows must be visible in the result, not just silently
  // excluded from `total` — otherwise a truncated upload (missing trailing
  // rows) is indistinguishable from a clean file that legitimately had
  // formatting artifacts. `skipped` is additive: it must not change what
  // total/success/errors already mean.
  // #1012: the three blank/whitespace-only rows this test used to append to
  // the mocked `readFile` result can't reach importPatients from a real
  // reader -- readCSV/readExcel already drop them before the array exists.
  // Seeded via rows.skippedCount on the same two real rows instead.
  it('reports a skipped count matching the number of blank rows, leaving total/success/errors identical to the same file without them (#798, #1012)', async () => {
    const rowWithBadEmail = { ...VALID_ROW, email: 'not-an-email' };

    // Baseline: the same two real rows (one success, one error), no blanks.
    vi.spyOn(service, 'readFile').mockResolvedValue([VALID_ROW, rowWithBadEmail]);
    const baseline = await service.importPatients(db, { path: '/baseline.csv', originalname: 'baseline.csv' });

    // Reset the db/mocks so the second run starts from the same state as the
    // first (fresh insertOne call count, no leftover duplicate-check state).
    ({ db, patientsCollection } = makeDb());
    vi.spyOn(notificationService, 'buildConsentMetadata').mockReturnValue({
      token: 'tok-1',
      createdAt: new Date('2026-01-01'),
      expiresAt: new Date('2026-02-01'),
    });
    vi.spyOn(notificationService, 'buildConsentLink').mockReturnValue('https://example.com/consent/tok-1');
    vi.spyOn(notificationService, 'enqueueConsentNotification').mockResolvedValue(undefined);
    vi.spyOn(patientService, 'checkDuplicatePatient').mockResolvedValue(null);

    // Same file; the reader reports three blank/whitespace-only trailing rows
    // it discarded (a spreadsheet export commonly appends them).
    const rowsWithBlanks = [VALID_ROW, rowWithBadEmail];
    Object.defineProperty(rowsWithBlanks, 'skippedCount', { value: 3, enumerable: false });
    vi.spyOn(service, 'readFile').mockResolvedValue(rowsWithBlanks);
    const withBlanks = await service.importPatients(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(withBlanks.skipped).toBe(3);
    // The invariant that matters most: presence of blank rows is additive,
    // not a reshaping of the existing counts.
    expect(withBlanks.total).toBe(baseline.total);
    expect(withBlanks.success).toBe(baseline.success);
    expect(withBlanks.errors).toHaveLength(baseline.errors.length);
  });

  it('reports skipped: 0 when a file has no blank rows', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([VALID_ROW]);
    const result = await service.importPatients(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.skipped).toBe(0);
  });

  // #1001: readCSV/readExcel now drop blank rows before this array ever
  // reaches importPatients, so this loop's own isEmptyRow guard can never
  // fire against a real file -- results.skipped must be seeded from what the
  // reader reports on `rows.skippedCount` (attached the same way readCSV/
  // readExcel do it for real, non-enumerably) rather than starting at 0.
  it('#1001: seeds results.skipped from the reader-reported skippedCount on the rows array readFile returns', async () => {
    const rows = [VALID_ROW];
    Object.defineProperty(rows, 'skippedCount', { value: 4, enumerable: false });
    vi.spyOn(service, 'readFile').mockResolvedValue(rows);

    const result = await service.importPatients(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.skipped).toBe(4);
    expect(result.total).toBe(1);
    expect(result.success).toBe(1);
  });

  it('reports "não informado" as the received value when a row leaves email blank (#1337)', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([VALID_ROW, { ...VALID_ROW, email: '' }]);
    const result = await service.importPatients(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.success).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].row).toBe(3);
    expect(result.errors[0].errors[0]).toMatch(/Email \(email\) é obrigatório.*Valor recebido: "não informado"/);
  });

  it('normalizes a recordNumber string the row parser hands over untouched: blank and "NaN" to null, numeric to a number, other text kept (#1337)', async () => {
    const parsePatientRow = service.parsePatientRow.bind(service);
    vi.spyOn(service, 'parsePatientRow').mockImplementation((row) => ({ ...parsePatientRow(row), recordNumber: row.recordNumber }));
    vi.spyOn(service, 'readFile').mockResolvedValue([
      { ...VALID_ROW, recordNumber: '   ' },
      { ...VALID_ROW, recordNumber: 'NaN' },
      { ...VALID_ROW, recordNumber: ' 42 ' },
      { ...VALID_ROW, recordNumber: 'PRT-9' },
    ]);
    const createSpy = vi.spyOn(PatientModel, 'create');

    const result = await service.importPatients(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.success).toBe(4);
    expect(createSpy.mock.calls.map(([data]) => data.recordNumber)).toEqual([null, null, 42, 'PRT-9']);
    expect(insertedRecordNumbers()).toEqual([undefined, undefined, '42', 'PRT-9']);
  });

  it('records the model validation errors, each prefixed with the row number, and inserts nothing (#1337)', async () => {
    vi.spyOn(PatientModel, 'validate').mockReturnValue({ isValid: false, errors: ['participantId inválido'] });
    vi.spyOn(service, 'readFile').mockResolvedValue([VALID_ROW]);

    const result = await service.importPatients(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.success).toBe(0);
    expect(result.errors[0].errors).toEqual(['Linha 2: participantId inválido']);
    expect(patientsCollection.insertOne).not.toHaveBeenCalled();
  });

  it('records a default row error when a row throws an error with no message (#1337)', async () => {
    patientService.checkDuplicatePatient.mockRejectedValueOnce(new Error(''));
    vi.spyOn(service, 'readFile').mockResolvedValue([VALID_ROW]);

    const result = await service.importPatients(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.total).toBe(1);
    expect(result.success).toBe(0);
    expect(result.errors[0].errors).toEqual(['Erro desconhecido ao processar linha']);
  });

  it('warns but still imports when a patientID column is present in the file (it is ignored)', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([{ ...VALID_ROW, patientID: '99999999' }]);
    const result = await service.importPatients(db, { path: '/x.csv', originalname: 'x.csv' });

    expect(result.success).toBe(1);
    expect(patientsCollection.insertOne.mock.calls[0][0].patientID).not.toBe('99999999');
  });

  // #814 (RNF011 AC#4 / RF029 AC#5-6): rejected participant rows are
  // quarantined the same way #787 already quarantines rejected sample rows,
  // via the shared quarantineRejectedSampleRows, with a distinct batch
  // `type` ('LGPD_PATIENT_CSV') so a patient batch never collides with a
  // sample batch in the shared import_batches collection.
  describe('#814: rejected rows are quarantined, not discarded', () => {
    it('stages a rejected row into import_staging_records under a batch, and returns stagingBatchId', async () => {
      vi.spyOn(service, 'readFile').mockResolvedValue([{ ...VALID_ROW, email: 'not-an-email' }]);

      const result = await service.importPatients(db, { path: '/x.csv', originalname: 'lote.csv' });

      expect(result.success).toBe(0);
      expect(result.errors).toHaveLength(1);

      expect(importBatchesCollection.insertOne).toHaveBeenCalledTimes(1);
      expect(importBatchesCollection.insertOne.mock.calls[0][0]).toMatchObject({
        type: 'LGPD_PATIENT_CSV',
        source: 'LGPD',
        status: 'QUARANTINED',
        fileName: 'lote.csv',
        counts: { total: 1, success: 0, errors: 1 },
      });

      expect(importStagingRecordsCollection.insertMany).toHaveBeenCalledTimes(1);
      const staged = importStagingRecordsCollection.insertMany.mock.calls[0][0];
      expect(staged).toHaveLength(1);
      // #1295: the rows carry the batch document's own id, generated before them.
      const batchId = importBatchesCollection.insertOne.mock.calls[0][0]._id;
      expect(staged[0]).toMatchObject({ batchId, rowNumber: 2, status: 'ERROR' });

      expect(result.stagingBatchId).toBe(batchId);
    });

    it('does not open a staging batch when every row imports cleanly', async () => {
      vi.spyOn(service, 'readFile').mockResolvedValue([VALID_ROW]);

      const result = await service.importPatients(db, { path: '/x.csv', originalname: 'x.csv' });

      expect(result.success).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(importBatchesCollection.insertOne).not.toHaveBeenCalled();
      expect(importStagingRecordsCollection.insertMany).not.toHaveBeenCalled();
      expect(result.stagingBatchId).toBeNull();
    });

    // The existing "sem dados sensíveis" posture (sanitizeRowForError, used
    // in every results.errors push above) is about the HTTP response, not
    // server-side persistence -- quarantining the row server-side is a
    // different thing and must not leak into what importPatients itself
    // returns to its caller.
    it('does not carry row data on the returned per-row error, even though the row is quarantined server-side', async () => {
      vi.spyOn(service, 'readFile').mockResolvedValue([{ ...VALID_ROW, email: 'not-an-email' }]);

      const result = await service.importPatients(db, { path: '/x.csv', originalname: 'x.csv' });

      expect(result.errors[0].data).toEqual({});
      expect(JSON.stringify(result.errors[0])).not.toMatch(/Maria Silva/);
    });

    it('records the acting user as createdBy on the quarantine batch', async () => {
      vi.spyOn(service, 'readFile').mockResolvedValue([{ ...VALID_ROW, email: 'not-an-email' }]);

      await service.importPatients(
        db,
        { path: '/x.csv', originalname: 'x.csv' },
        { actor: { userID: 'user-123', userId: 'user-123' } }
      );

      expect(importBatchesCollection.insertOne.mock.calls[0][0].createdBy).toBe('user-123');
    });
  });
});
