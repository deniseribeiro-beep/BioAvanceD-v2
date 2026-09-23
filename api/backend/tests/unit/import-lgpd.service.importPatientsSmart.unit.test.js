import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ──────────────────────────────────────────────────────────
// ImportLGPDService.importPatientsSmart / buildMappedPatientRow / cleanupFile
//
// Same mocking approach as import-lgpd.service.importPatients.unit.test.js:
// getCollection/generateUniquePatientID are destructured at module scope, so
// we drive them for real against a fake db.collection(); notificationService/
// patientService are required as module objects so vi.spyOn works normally.
// ──────────────────────────────────────────────────────────

vi.mock('../../src/services/PatientIdentityService', () => ({}));
vi.mock('../../src/services/DrugService', () => ({}));
vi.mock('../../src/services/SampleGraphValidator', () => ({ default: class {} }));
vi.mock('../../src/services/MerkleService', () => ({ generateSampleHash: vi.fn() }));
vi.mock('../../src/services/quality-domain.service', () => ({}));

const fs = require('fs');
const service = require('../../src/services/import-lgpd.service');
const notificationService = require('../../src/services/notification.service');
const patientService = require('../../src/services/patient.service');

const VALID_ROW = {
  patientName: 'Maria Silva',
  birthDate: '15/06/1985',
  sex: 'F',
  email: 'maria@example.com',
  consentTemplateId: '64d0f0f0f0f0f0f0f0f0f0f0',
};

const MAPPING = {
  Nome: 'patientName',
  Nascimento: 'birthDate',
  Sexo: 'sex',
  Email: 'email',
  Template: 'consentTemplateId',
};

function makeDb({ templateFound = true } = {}) {
  const patientsCollection = {
    insertOne: vi.fn().mockResolvedValue({ insertedId: 'patient-id-1' }),
    updateOne: vi.fn().mockResolvedValue({}),
  };
  const consentTemplatesCollection = {
    findOne: vi.fn().mockResolvedValue(templateFound ? { _id: 'tpl' } : null),
  };
  const pacientesCollection = {
    findOne: vi.fn().mockResolvedValue(null),
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

describe('ImportLGPDService.buildMappedPatientRow', () => {
  it('maps raw columns to target fields per the mapping', () => {
    const mapped = service.buildMappedPatientRow(
      { Nome: 'Maria Silva', Nascimento: '15/06/1985' },
      { Nome: 'patientName', Nascimento: 'birthDate' }
    );
    expect(mapped.patientName).toBe('Maria Silva');
    expect(mapped.birthDate).toBe('15/06/1985');
  });

  it('ignores mapping entries with an empty target field', () => {
    const mapped = service.buildMappedPatientRow(
      { Nome: 'Maria Silva' },
      { Nome: '' }
    );
    expect(mapped).toEqual({});
  });

  it('also fills known patient fields whose raw column name already matches the canonical target, without overwriting an explicit mapping', () => {
    const mapped = service.buildMappedPatientRow(
      { patientName: 'Direct Name', Nome: 'Mapped Name' },
      { Nome: 'patientName' }
    );
    // mapping already set patientName from "Nome" first key iterated ('Nome' comes
    // from the mapping loop, not the source-column loop) - explicit mapping wins.
    expect(mapped.patientName).toBe('Mapped Name');
  });

  it('canonicalizes accented/spaced source-column names to their target field when not already mapped', () => {
    const mapped = service.buildMappedPatientRow(
      { 'Data Nascimento': '15/06/1985', 'E-mail': 'x@example.com' },
      {}
    );
    expect(mapped.birthDate).toBe('15/06/1985');
    expect(mapped.email).toBe('x@example.com');
  });

  it('skips blank/whitespace-only raw values entirely', () => {
    const mapped = service.buildMappedPatientRow(
      { patientName: '   ' },
      {}
    );
    expect(mapped.patientName).toBeUndefined();
  });

  it('canonicalizes accented/spaced responsavel* column names straight to representativeName/representativeEmail (canonicalHeaderMap path)', () => {
    const mapped = service.buildMappedPatientRow(
      { responsavelnome: 'João', responsavelemail: 'joao@example.com' },
      {}
    );
    expect(mapped.representativeName).toBe('João');
    expect(mapped.representativeEmail).toBe('joao@example.com');
  });

  it('falls back an explicit mapping target of responsavelNome/responsavelEmail into representativeName/representativeEmail when those are unset', () => {
    const mapped = service.buildMappedPatientRow(
      { RespCol: 'João', RespEmailCol: 'joao@example.com' },
      { RespCol: 'responsavelNome', RespEmailCol: 'responsavelEmail' }
    );
    expect(mapped.representativeName).toBe('João');
    expect(mapped.representativeEmail).toBe('joao@example.com');
  });

  it('does not overwrite an already-mapped representativeName/representativeEmail with the responsavelNome/responsavelEmail fallback', () => {
    const mapped = service.buildMappedPatientRow(
      { NameCol: 'Explicit Name', EmailCol: 'explicit@example.com', RespCol: 'João', RespEmailCol: 'joao@example.com' },
      { NameCol: 'representativeName', EmailCol: 'representativeEmail', RespCol: 'responsavelNome', RespEmailCol: 'responsavelEmail' }
    );
    expect(mapped.representativeName).toBe('Explicit Name');
    expect(mapped.representativeEmail).toBe('explicit@example.com');
  });
});

describe('ImportLGPDService.importPatientsSmart', () => {
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

  function rowFromValid(overrides = {}) {
    return { Nome: 'Maria Silva', Nascimento: '15/06/1985', Sexo: 'F', Email: 'maria@example.com', Template: '64d0f0f0f0f0f0f0f0f0f0f0', ...overrides };
  }

  it('throws when mapping is missing or empty', async () => {
    await expect(
      service.importPatientsSmart(db, { path: '/x.csv', originalname: 'x.csv' }, {})
    ).rejects.toThrow('Mapeamento inteligente é obrigatório');

    await expect(
      service.importPatientsSmart(db, { path: '/x.csv', originalname: 'x.csv' }, { mapping: {} })
    ).rejects.toThrow('Mapeamento inteligente é obrigatório');
  });

  it('imports a valid row end-to-end: generates an ID, uppercases the name, sets PENDING_CONSENT, inserts, and enqueues a consent notification', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([rowFromValid()]);

    const result = await service.importPatientsSmart(
      db,
      { path: '/x.csv', originalname: 'x.csv' },
      { mapping: MAPPING }
    );

    expect(result.success).toBe(1);
    expect(result.total).toBe(1);
    expect(result.errors).toHaveLength(0);

    expect(patientsCollection.insertOne).toHaveBeenCalledTimes(1);
    const insertedPatient = patientsCollection.insertOne.mock.calls[0][0];
    // RF005/RNF007 (#575): patientName is civil identity — never on
    // Patient, only on the ParticipantIdentity assertion below.
    expect(insertedPatient.patientName).toBeUndefined();
    expect(insertedPatient.participantId).toMatch(/^\d{8}$/);
    expect(insertedPatient.status).toBe('PENDING_CONSENT');
    expect(notificationService.enqueueConsentNotification).toHaveBeenCalledTimes(1);

    // RF005/RNF007 (#363/#563): create also dual-writes ParticipantIdentity.
    expect(participantIdentitiesCollection.insertOne).toHaveBeenCalledTimes(1);
    const insertedIdentity = participantIdentitiesCollection.insertOne.mock.calls[0][0];
    expect(insertedIdentity.participantId).toBe(insertedPatient.participantId);
    // #1104: ciphertext-only -- no plaintext at rest, recovered by decryption.
    const identityCrypto = require('../../src/services/participantIdentity.service');
    expect(insertedIdentity.patientName).toBeNull();
    expect(identityCrypto.decryptIdentity(insertedIdentity).patientName).toBe('MARIA SILVA');
  });

  // #1166 slice 3: same rollback as importPatients -- a refused identity
  // insert must not leave the Patient row behind with no identity.
  it('#1166: rolls back the Patient row when the identity insert fails', async () => {
    participantIdentitiesCollection.insertOne.mockRejectedValue(
      Object.assign(new Error('E11000 duplicate key'), { code: 11000, keyPattern: { phoneHash: 1 } })
    );
    patientsCollection.deleteOne = vi.fn().mockResolvedValue({ deletedCount: 1 });
    vi.spyOn(service, 'readFile').mockResolvedValue([rowFromValid()]);

    const result = await service.importPatientsSmart(
      db,
      { path: '/x.csv', originalname: 'x.csv' },
      { mapping: MAPPING }
    );

    expect(result.success).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(patientsCollection.deleteOne).toHaveBeenCalledWith({ _id: 'patient-id-1' });
  });

  it('records a per-row error and does not insert when patientName is missing', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([rowFromValid({ Nome: '' })]);
    const result = await service.importPatientsSmart(db, { path: '/x.csv', originalname: 'x.csv' }, { mapping: MAPPING });

    expect(result.success).toBe(0);
    expect(result.errors[0].errors[0]).toMatch(/Nome do paciente é obrigatório/);
    expect(patientsCollection.insertOne).not.toHaveBeenCalled();
  });

  it('records a per-row error when email is missing/invalid', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([rowFromValid({ Email: 'not-an-email' })]);
    const result = await service.importPatientsSmart(db, { path: '/x.csv', originalname: 'x.csv' }, { mapping: MAPPING });

    expect(result.errors[0].errors[0]).toMatch(/Email inválido/);
  });

  // #1012: readCSV/readExcel drop a trailing blank row before this array
  // ever reaches importPatientsSmart (see the #1001 seeding test below), so
  // feeding a `{}` row directly -- as this test used to -- exercised a
  // per-row isEmptyRow backstop that no real reader output can reach.
  // Seeded via rows.skippedCount instead.
  it('skips a trailing blank row without counting or rejecting it (#790, #1012)', async () => {
    const rows = [rowFromValid()];
    Object.defineProperty(rows, 'skippedCount', { value: 1, enumerable: false });
    vi.spyOn(service, 'readFile').mockResolvedValue(rows);

    const result = await service.importPatientsSmart(db, { path: '/x.csv', originalname: 'x.csv' }, { mapping: MAPPING });

    expect(result.errors).toHaveLength(0);
    expect(result.success).toBe(1);
    expect(result.total).toBe(1);
  });

  // #1012: same reasoning as above -- readExcel's whitespace-only-row filter
  // drops this row before importPatientsSmart ever sees it.
  it('skips a whitespace-only row, not just a structurally empty one (#790, #1012)', async () => {
    const rows = [rowFromValid()];
    Object.defineProperty(rows, 'skippedCount', { value: 1, enumerable: false });
    vi.spyOn(service, 'readFile').mockResolvedValue(rows);

    const result = await service.importPatientsSmart(db, { path: '/x.csv', originalname: 'x.csv' }, { mapping: MAPPING });

    expect(result.errors).toHaveLength(0);
    expect(result.total).toBe(1);
  });

  // #798: a `skipped` count makes a truncated upload distinguishable from a
  // clean file that happened to have trailing formatting artifacts. It must
  // be purely additive -- total/success/errors have to come out identical to
  // the same file without the blank rows.
  // #1012: the three blank rows this test used to append to the mocked
  // `readFile` result can't reach importPatientsSmart from a real reader --
  // readCSV/readExcel already drop them before the array exists. Seeded via
  // rows.skippedCount on the same two real rows instead.
  it('reports a skipped count matching the number of blank rows, leaving total/success/errors identical to the same file without them (#798, #1012)', async () => {
    const invalidRow = rowFromValid({ Email: 'not-an-email' });

    vi.spyOn(service, 'readFile').mockResolvedValue([rowFromValid(), invalidRow]);
    const baseline = await service.importPatientsSmart(db, { path: '/baseline.csv', originalname: 'baseline.csv' }, { mapping: MAPPING });

    ({ db, patientsCollection } = makeDb());
    vi.spyOn(notificationService, 'buildConsentMetadata').mockReturnValue({
      token: 'tok-1',
      createdAt: new Date('2026-01-01'),
      expiresAt: new Date('2026-02-01'),
    });
    vi.spyOn(notificationService, 'buildConsentLink').mockReturnValue('https://example.com/consent/tok-1');
    vi.spyOn(notificationService, 'enqueueConsentNotification').mockResolvedValue(undefined);
    vi.spyOn(patientService, 'checkDuplicatePatient').mockResolvedValue(null);

    const rowsWithBlanks = [rowFromValid(), invalidRow];
    Object.defineProperty(rowsWithBlanks, 'skippedCount', { value: 3, enumerable: false });
    vi.spyOn(service, 'readFile').mockResolvedValue(rowsWithBlanks);
    const withBlanks = await service.importPatientsSmart(db, { path: '/x.csv', originalname: 'x.csv' }, { mapping: MAPPING });

    expect(withBlanks.skipped).toBe(3);
    expect(withBlanks.total).toBe(baseline.total);
    expect(withBlanks.success).toBe(baseline.success);
    expect(withBlanks.errors).toHaveLength(baseline.errors.length);
  });

  it('reports skipped: 0 when a file has no blank rows', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([rowFromValid()]);
    const result = await service.importPatientsSmart(db, { path: '/x.csv', originalname: 'x.csv' }, { mapping: MAPPING });

    expect(result.skipped).toBe(0);
  });

  // #1001: same seeding as importPatients/importSamples -- readCSV/readExcel
  // now drop blank rows before this array reaches importPatientsSmart, so
  // results.skipped must come from the reader's `rows.skippedCount`, not
  // start at 0.
  it('#1001: seeds results.skipped from the reader-reported skippedCount on the rows array readFile returns', async () => {
    const rows = [rowFromValid()];
    Object.defineProperty(rows, 'skippedCount', { value: 5, enumerable: false });
    vi.spyOn(service, 'readFile').mockResolvedValue(rows);

    const result = await service.importPatientsSmart(db, { path: '/x.csv', originalname: 'x.csv' }, { mapping: MAPPING });

    expect(result.skipped).toBe(5);
    expect(result.total).toBe(1);
    expect(result.success).toBe(1);
  });

  it('records a per-row error when cpf is present and invalid', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([rowFromValid({ cpf: '00000000000' })]);
    const result = await service.importPatientsSmart(
      db,
      { path: '/x.csv', originalname: 'x.csv' },
      { mapping: { ...MAPPING, cpf: 'cpf' } }
    );

    expect(result.errors[0].errors[0]).toMatch(/CPF inválido/);
  });

  it('records a per-row error when birthDate is missing/unparseable', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([rowFromValid({ Nascimento: 'not-a-date' })]);
    const result = await service.importPatientsSmart(db, { path: '/x.csv', originalname: 'x.csv' }, { mapping: MAPPING });

    expect(result.errors[0].errors[0]).toMatch(/Data de nascimento inválida/);
  });

  it('records a per-row error when birthDate is in the future', async () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const day = String(future.getDate()).padStart(2, '0');
    const month = String(future.getMonth() + 1).padStart(2, '0');
    vi.spyOn(service, 'readFile').mockResolvedValue([rowFromValid({ Nascimento: `${day}/${month}/${future.getFullYear()}` })]);

    const result = await service.importPatientsSmart(db, { path: '/x.csv', originalname: 'x.csv' }, { mapping: MAPPING });

    expect(result.errors[0].errors[0]).toMatch(/Data de nascimento futura/);
  });

  it('records a per-row error when consentTemplateId is missing or not a valid ObjectId, and does not query the collection for an invalid id', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([rowFromValid({ Template: 'not-an-id' })]);
    const result = await service.importPatientsSmart(db, { path: '/x.csv', originalname: 'x.csv' }, { mapping: MAPPING });

    expect(result.errors[0].errors[0]).toMatch(/consentTemplateId inválido ou ausente/);
    expect(consentTemplatesCollection.findOne).not.toHaveBeenCalled();
  });

  it('honors a groupFields.consentTemplateId fallback when the row omits its own', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([rowFromValid({ Template: '' })]);
    const result = await service.importPatientsSmart(
      db,
      { path: '/x.csv', originalname: 'x.csv' },
      { mapping: MAPPING, groupFields: { consentTemplateId: '64d0f0f0f0f0f0f0f0f0f0f0' } }
    );

    expect(result.success).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  it('records a per-row error when the consent template does not exist', async () => {
    ({ db, patientsCollection, consentTemplatesCollection } = makeDb({ templateFound: false }));
    vi.spyOn(service, 'readFile').mockResolvedValue([rowFromValid()]);

    const result = await service.importPatientsSmart(db, { path: '/x.csv', originalname: 'x.csv' }, { mapping: MAPPING });

    expect(result.errors[0].errors[0]).toMatch(/Template de consentimento não encontrado/);
    expect(patientsCollection.insertOne).not.toHaveBeenCalled();
  });

  it('requires representative name+email for a deceased patient, and validates the representative email format', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([rowFromValid({ isDeceased: 'true' })]);
    const missingRep = await service.importPatientsSmart(
      db,
      { path: '/x.csv', originalname: 'x.csv' },
      { mapping: { ...MAPPING, isDeceased: 'isDeceased' } }
    );
    expect(missingRep.errors[0].errors[0]).toMatch(/responsável \(nome e email\) é obrigatório/);

    vi.spyOn(service, 'readFile').mockResolvedValue([
      rowFromValid({ isDeceased: 'true', representativeName: 'João', representativeEmail: 'bad-email' }),
    ]);
    const badRepEmail = await service.importPatientsSmart(
      db,
      { path: '/x.csv', originalname: 'x.csv' },
      { mapping: { ...MAPPING, isDeceased: 'isDeceased', representativeName: 'representativeName', representativeEmail: 'representativeEmail' } }
    );
    expect(badRepEmail.errors[0].errors[0]).toMatch(/Email do responsável inválido/);
  });

  it('records a per-row error and skips insert when the patient is a duplicate', async () => {
    patientService.checkDuplicatePatient.mockResolvedValue({ _id: 'existing' });
    vi.spyOn(service, 'readFile').mockResolvedValue([rowFromValid()]);

    const result = await service.importPatientsSmart(db, { path: '/x.csv', originalname: 'x.csv' }, { mapping: MAPPING });

    expect(result.success).toBe(0);
    expect(result.errors[0].errors[0]).toMatch(/Paciente duplicado/);
    expect(patientsCollection.insertOne).not.toHaveBeenCalled();
  });

  it('still counts the row as a success when notification enqueueing fails (the failure is logged, not fatal)', async () => {
    notificationService.enqueueConsentNotification.mockRejectedValue(new Error('queue down'));
    vi.spyOn(service, 'readFile').mockResolvedValue([rowFromValid()]);

    const result = await service.importPatientsSmart(db, { path: '/x.csv', originalname: 'x.csv' }, { mapping: MAPPING });

    expect(result.success).toBe(1);
    expect(patientsCollection.updateOne).not.toHaveBeenCalled();
  });

  it('catches a row-level exception, logs it and records it as a row error rather than aborting the whole import', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([rowFromValid(), rowFromValid()]);
    patientService.checkDuplicatePatient
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('db exploded'));

    const result = await service.importPatientsSmart(db, { path: '/x.csv', originalname: 'x.csv' }, { mapping: MAPPING });

    expect(result.total).toBe(2);
    expect(result.success).toBe(1);
    expect(result.errors[0].errors[0]).toMatch(/db exploded/);
  });

  it('fills unitAcronym from clinicalUnit via PatientModel.fillAcronym when clinicalUnit is present', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([rowFromValid({ UnidadeClinica: 'Unidade De Oncologia' })]);

    const result = await service.importPatientsSmart(
      db,
      { path: '/x.csv', originalname: 'x.csv' },
      { mapping: { ...MAPPING, UnidadeClinica: 'clinicalUnit' } }
    );

    expect(result.success).toBe(1);
    const insertedPatient = patientsCollection.insertOne.mock.calls[0][0];
    expect(insertedPatient.clinicalUnit).toBe('UNIDADE DE ONCOLOGIA');
    expect(insertedPatient.unitAcronym).toBe('UO');
  });

  it('records a per-row error when PatientModel.validate rejects the built patient (e.g. sex missing)', async () => {
    vi.spyOn(service, 'readFile').mockResolvedValue([rowFromValid({ Sexo: '' })]);

    const result = await service.importPatientsSmart(
      db,
      { path: '/x.csv', originalname: 'x.csv' },
      { mapping: MAPPING }
    );

    expect(result.success).toBe(0);
    expect(result.errors[0].errors[0]).toMatch(/sex é obrigatório/);
    expect(patientsCollection.insertOne).not.toHaveBeenCalled();
  });

  it('propagates the underlying error (and never reaches the DB) when reading the file fails', async () => {
    vi.spyOn(service, 'readFile').mockRejectedValue(new Error('Arquivo não encontrado'));

    await expect(
      service.importPatientsSmart(db, { path: '/missing.csv', originalname: 'missing.csv' }, { mapping: MAPPING })
    ).rejects.toThrow('Arquivo não encontrado');
    expect(db.collection).not.toHaveBeenCalled();
  });

  // #814 (RNF011 AC#4 / RF029 AC#5-6): same quarantine reuse as
  // importPatients (see import-lgpd.service.importPatients.unit.test.js),
  // reached through the shared quarantineRejectedSampleRows with the same
  // distinct 'LGPD_PATIENT_CSV' batch type.
  describe('#814: rejected rows are quarantined, not discarded', () => {
    it('stages a rejected row into import_staging_records under a batch, and returns stagingBatchId', async () => {
      vi.spyOn(service, 'readFile').mockResolvedValue([rowFromValid({ Email: 'not-an-email' })]);

      const result = await service.importPatientsSmart(
        db,
        { path: '/x.csv', originalname: 'lote.csv' },
        { mapping: MAPPING }
      );

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
      expect(staged[0]).toMatchObject({ batchId: 'batch-1', rowNumber: 2, status: 'ERROR' });

      expect(result.stagingBatchId).toBe('batch-1');
    });

    it('does not open a staging batch when every row imports cleanly', async () => {
      vi.spyOn(service, 'readFile').mockResolvedValue([rowFromValid()]);

      const result = await service.importPatientsSmart(db, { path: '/x.csv', originalname: 'x.csv' }, { mapping: MAPPING });

      expect(result.success).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(importBatchesCollection.insertOne).not.toHaveBeenCalled();
      expect(importStagingRecordsCollection.insertMany).not.toHaveBeenCalled();
      expect(result.stagingBatchId).toBeNull();
    });

    it('does not carry row data on the returned per-row error, even though the row is quarantined server-side', async () => {
      vi.spyOn(service, 'readFile').mockResolvedValue([rowFromValid({ Email: 'not-an-email' })]);

      const result = await service.importPatientsSmart(db, { path: '/x.csv', originalname: 'x.csv' }, { mapping: MAPPING });

      expect(result.errors[0].data).toBeUndefined();
      expect(JSON.stringify(result.errors[0])).not.toMatch(/Maria Silva/);
    });

    it('records the acting user as createdBy on the quarantine batch', async () => {
      vi.spyOn(service, 'readFile').mockResolvedValue([rowFromValid({ Email: 'not-an-email' })]);

      await service.importPatientsSmart(
        db,
        { path: '/x.csv', originalname: 'x.csv' },
        { mapping: MAPPING, actor: { userID: 'user-123', userId: 'user-123' } }
      );

      expect(importBatchesCollection.insertOne.mock.calls[0][0].createdBy).toBe('user-123');
    });
  });
});

describe('ImportLGPDService.cleanupFile', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('deletes the file when it exists', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

    service.cleanupFile('/tmp/upload.csv');

    expect(unlinkSpy).toHaveBeenCalledWith('/tmp/upload.csv');
  });

  it('does nothing when the file does not exist', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    const unlinkSpy = vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

    service.cleanupFile('/tmp/missing.csv');

    expect(unlinkSpy).not.toHaveBeenCalled();
  });

  it('swallows an error thrown by unlinkSync instead of propagating it', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {
      throw new Error('EBUSY: file locked');
    });

    expect(() => service.cleanupFile('/tmp/locked.csv')).not.toThrow();
  });
});
