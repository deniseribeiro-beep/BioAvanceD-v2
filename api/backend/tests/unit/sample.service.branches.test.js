import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// #1337: the sample service's remaining branch arms, each pinned by the
// behaviour it decides. The service and every collaborator load with
// `require`, as the neighbouring sample service tests do.
const sampleService = require('../../src/services/sample.service');
const { SampleModel } = require('../../src/models/Sample');
const SampleMovementModel = require('../../src/models/SampleMovement');
const qualityDomain = require('../../src/services/quality-domain.service');
const rcsAssessmentService = require('../../src/services/rcs-assessment.service');
const specimenPreanalyticsService = require('../../src/services/specimen-preanalytics.service');
const collectionGovernanceService = require('../../src/services/collectionGovernance.service');
const legalHoldService = require('../../src/services/legalHold.service');
const operationalStateDecisionService = require('../../src/services/operationalStateDecision.service');
const physicalChain = require('../../src/services/physicalChain.service');
const AllocateSampleUseCase = require('../../src/core/use-cases/AllocateSampleUseCase');
const MongoStorageRepository = require('../../src/infrastructure/persistence/mongo/MongoStorageRepository');
const logger = require('../../src/utils/logger');
const { ObjectId, MongoServerError } = require('mongodb');

afterEach(() => {
  vi.restoreAllMocks();
});

function makeCursor(docs = []) {
  const cursor = {
    sort: vi.fn(() => cursor),
    skip: vi.fn(() => cursor),
    limit: vi.fn(() => cursor),
    project: vi.fn(() => cursor),
    toArray: vi.fn().mockResolvedValue(docs),
    next: vi.fn().mockResolvedValue(docs[0] || null),
  };
  return cursor;
}

function makeCollection(name) {
  return {
    collectionName: name,
    findOne: vi.fn().mockResolvedValue(null),
    find: vi.fn(() => makeCursor([])),
    insertOne: vi.fn().mockResolvedValue({ insertedId: 'generated-id' }),
    updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
    countDocuments: vi.fn().mockResolvedValue(0),
    findOneAndUpdate: vi.fn().mockResolvedValue({ seq: 1 }),
    createIndex: vi.fn().mockResolvedValue(true),
  };
}

// A db whose client answers `hello` as a replica set runs the service's
// writes in a transaction; one without `client.db` runs them in sequence.
function makeDb({ transactional = false } = {}) {
  const collections = {};
  const session = {
    withTransaction: vi.fn(async (body) => body()),
    endSession: vi.fn().mockResolvedValue(undefined),
  };
  const client = { startSession: vi.fn(() => session) };
  if (transactional) {
    client.db = vi.fn(() => ({ command: vi.fn().mockResolvedValue({ setName: 'rs0' }) }));
  }
  return {
    collections,
    session,
    client,
    collection: vi.fn((name) => collections[name] || (collections[name] = makeCollection(name))),
  };
}

const BOX_ID = new ObjectId();
const DRAWER_ID = new ObjectId();
const RACK_ID = new ObjectId();
const SHELF_ID = new ObjectId();
const FREEZER_ID = new ObjectId();

// The box -> rack -> shelf -> freezer chain a create resolves, with the
// freezer's equipment and an operational sensor. `containers` replaces or
// adds chain levels by id.
function seedStorage(db, { box, containers = {}, equipment, sensor } = {}) {
  db.collection('patients').findOne.mockResolvedValue({ participantId: '12345678' });
  db.collection('storageBoxes').findOne.mockResolvedValue(box || { _id: BOX_ID, parent_id: RACK_ID });
  const chain = {
    [String(RACK_ID)]: { _id: RACK_ID, containerType: 'RACK', parent_id: SHELF_ID },
    [String(SHELF_ID)]: { _id: SHELF_ID, containerType: 'SHELF', parent_id: FREEZER_ID },
    [String(FREEZER_ID)]: { _id: FREEZER_ID, containerType: 'FREEZER', containerID: 'EQ-1', parent_id: null },
    ...containers,
  };
  db.collection('storageContainers').findOne.mockImplementation(async (query) => chain[String(query._id)] || null);
  db.collection('equipment').findOne.mockResolvedValue(equipment === undefined ? { equipmentID: 'EQ-1' } : equipment);
  db.collection('sensors').findOne.mockResolvedValue(sensor === undefined ? { status: 'ok' } : sensor);
}

// The allocation, the placement echo and the label's container lookup are
// other modules' work; each case that reaches them fixes their answer.
function stubPlacement() {
  vi.spyOn(SampleMovementModel, 'generateMovementID').mockResolvedValue('MOV-1');
  const execute = vi.spyOn(AllocateSampleUseCase.prototype, 'execute').mockResolvedValue({ success: true });
  vi.spyOn(MongoStorageRepository.prototype, 'findCurrentStorageAssignment').mockResolvedValue(null);
  const openLoad = vi.spyOn(physicalChain, 'openSpecimenAssignment').mockResolvedValue({ containerId: 'CNT-1' });
  return { execute, openLoad };
}

function sampleData(overrides = {}) {
  return {
    participantId: '12345678',
    sampleType: 'PLASMA',
    sampleOrigin: 'VENOUS_BLOOD',
    extractionProtocol: 'TUBE_EDTA',
    quantity: 10,
    quality: 'GOOD',
    linkedProject: 'ProjectX',
    barcode: 'BR-BRANCH-001',
    specimenId: 'SP-BRANCH-1',
    boxId: BOX_ID.toString(),
    positionCode: 'A1',
    registeredAt: new Date('2024-01-01'),
    ...overrides,
  };
}

const birthMovement = (db) => db.collection('sample_movements').insertOne.mock.calls[0]?.[0];

describe('sample.service branch arms (#1337)', () => {
  describe('createSample: storage placement', () => {
    it('accepts a boxId given as an ObjectId, not a string', async () => {
      const db = makeDb();
      seedStorage(db);
      stubPlacement();

      const result = await sampleService.createSample(db, sampleData({ boxId: BOX_ID }));

      expect(String(result.storageLocation.boxId)).toBe(String(BOX_ID));
      expect(result.storageLocation.position).toBe('A1');
    });

    it('refuses a positionCode that is not a string', async () => {
      const db = makeDb();
      seedStorage(db);

      await expect(sampleService.createSample(db, sampleData({ positionCode: 5 })))
        .rejects.toMatchObject({ statusCode: 422, message: expect.stringMatching(/positionCode é obrigatório/) });
    });

    it('refuses a box with no parent as an incomplete hierarchy, without walking the chain', async () => {
      const db = makeDb();
      seedStorage(db, { box: { _id: BOX_ID, parent_id: null } });

      await expect(sampleService.createSample(db, sampleData()))
        .rejects.toMatchObject({ statusCode: 422, message: expect.stringMatching(/hierarquia de armazenamento incompleta/) });
      expect(db.collection('storageContainers').findOne).not.toHaveBeenCalled();
    });

    it('walks through a DRAWER to the rack above it', async () => {
      const db = makeDb();
      seedStorage(db, {
        box: { _id: BOX_ID, parent_id: DRAWER_ID },
        containers: { [String(DRAWER_ID)]: { _id: DRAWER_ID, containerType: 'DRAWER', parent_id: RACK_ID } },
      });
      stubPlacement();

      const result = await sampleService.createSample(db, sampleData());

      expect(result._id).toBe('generated-id');
      const walked = db.collection('storageContainers').findOne.mock.calls.map(([query]) => String(query._id));
      expect(walked).toEqual([String(DRAWER_ID), String(RACK_ID), String(SHELF_ID), String(FREEZER_ID)]);
    });

    it('refuses a DRAWER with no parent as an incomplete hierarchy', async () => {
      const db = makeDb();
      seedStorage(db, {
        box: { _id: BOX_ID, parent_id: DRAWER_ID },
        containers: { [String(DRAWER_ID)]: { _id: DRAWER_ID, containerType: 'DRAWER', parent_id: null } },
      });

      await expect(sampleService.createSample(db, sampleData()))
        .rejects.toThrow(/hierarquia de armazenamento incompleta/);
      expect(db.collection('storageContainers').findOne).toHaveBeenCalledTimes(1);
    });

    it('looks up no equipment id for a freezer with no containerID, and refuses the create', async () => {
      const db = makeDb();
      seedStorage(db, {
        containers: { [String(FREEZER_ID)]: { _id: FREEZER_ID, containerType: 'FREEZER', parent_id: null } },
        equipment: null,
      });

      await expect(sampleService.createSample(db, sampleData()))
        .rejects.toThrow('Equipamento vinculado à localização física não está cadastrado');
      expect(db.collection('equipment').findOne).toHaveBeenCalledWith({ equipmentID: { $in: [] } });
    });

    it('matches a numeric containerID as both its string and its number', async () => {
      const db = makeDb();
      seedStorage(db, {
        containers: { [String(FREEZER_ID)]: { _id: FREEZER_ID, containerType: 'FREEZER', containerID: '42', parent_id: null } },
        equipment: null,
      });

      await expect(sampleService.createSample(db, sampleData())).rejects.toThrow(/não está cadastrado/);
      expect(db.collection('equipment').findOne).toHaveBeenCalledWith({ equipmentID: { $in: ['42', 42] } });
    });
  });

  describe('createSample: the sensor gate', () => {
    it('reads a sensor maintenanceStatus when it has no status', async () => {
      const db = makeDb();
      seedStorage(db, { sensor: { maintenanceStatus: 'ok' } });
      stubPlacement();

      await expect(sampleService.createSample(db, sampleData())).resolves.toMatchObject({ _id: 'generated-id' });
    });

    it('refuses a sensor whose operationalStatus is offline', async () => {
      const db = makeDb();
      seedStorage(db, { sensor: { operationalStatus: 'offline' } });

      await expect(sampleService.createSample(db, sampleData()))
        .rejects.toThrow('Localização física sem sensor operacional associado. Sensor atual está em status offline.');
    });

    it('treats a sensor with no status field at all as operational', async () => {
      const db = makeDb();
      seedStorage(db, { sensor: { sensorId: 'S-1' } });
      stubPlacement();

      await expect(sampleService.createSample(db, sampleData())).resolves.toMatchObject({ _id: 'generated-id' });
    });
  });

  describe('createSample: validation and references', () => {
    it('answers the generic message and empty details for an invalid model with no error list', async () => {
      const db = makeDb();
      seedStorage(db);
      vi.spyOn(SampleModel, 'validate').mockReturnValue({ isValid: false });

      await expect(sampleService.createSample(db, sampleData())).rejects.toMatchObject({
        statusCode: 422,
        message: 'Dados da amostra inválidos conforme modelo MIABIS/BioAvanceD',
        details: [],
      });
    });

    it('answers 404 for a studyId that names no study', async () => {
      const db = makeDb();
      seedStorage(db);

      await expect(sampleService.createSample(db, sampleData({ studyId: 'STU-9' })))
        .rejects.toMatchObject({ statusCode: 404, message: 'studyId STU-9 não encontrado' });
    });

    it('answers 404 for a protocolId that names no protocol', async () => {
      const db = makeDb();
      seedStorage(db);

      await expect(sampleService.createSample(db, sampleData({ protocolId: 'PRO-9' })))
        .rejects.toMatchObject({ statusCode: 404, message: 'protocolId PRO-9 não encontrado' });
    });

    it('answers 404 for a collectionId that names no collection', async () => {
      const db = makeDb();
      seedStorage(db);

      await expect(sampleService.createSample(db, sampleData({ collectionId: 'COL-9' })))
        .rejects.toMatchObject({ statusCode: 404, message: 'collectionId COL-9 não encontrado' });
    });

    it('does not hold a biobank specimen to the context study, which only a biorepository does', async () => {
      const db = makeDb();
      seedStorage(db);
      stubPlacement();
      db.collection('collections').findOne.mockResolvedValue({
        collectionId: 'COL-1',
        governanceRegime: 'biobank',
        governanceContext: { studyId: 'STU-1', protocolId: 'PRO-1' },
      });
      db.collection('studies').findOne.mockResolvedValue({ studyId: 'STU-2', studyStatus: 'active' });
      vi.spyOn(collectionGovernanceService, 'registrationRefusal').mockResolvedValue(null);

      const result = await sampleService.createSample(db, sampleData({ collectionId: 'COL-1', studyId: 'STU-2' }));

      expect(result).toMatchObject({ collectionId: 'COL-1', studyId: 'STU-2' });
    });
  });

  describe('createSample: the birth movement and best-effort records', () => {
    it('records a birth quantity from quantity when currentQuantity is sent as null, and no linked project when none is sent', async () => {
      const db = makeDb();
      seedStorage(db);
      stubPlacement();

      await sampleService.createSample(db, sampleData({ currentQuantity: null, linkedProject: undefined }));

      expect(birthMovement(db)).toMatchObject({ type: 'create', quantity: 10, newQuantity: 10, linkedProject: null });
    });

    it('stores an empty finalGrade when the RCS assessment has none', async () => {
      const db = makeDb();
      seedStorage(db);
      stubPlacement();
      vi.spyOn(qualityDomain, 'resolveMethodologicalQuality').mockReturnValue({ model_version: 'rcs-test', final_grade: null });
      vi.spyOn(rcsAssessmentService, 'recordAssessment').mockResolvedValue({ _id: 'RCS-1' });
      vi.spyOn(specimenPreanalyticsService, 'recordProfile').mockResolvedValue({ _id: 'SPP-1' });

      const result = await sampleService.createSample(db, sampleData({ sprec: { matrixType: 'PLASMA' } }));

      expect(result.finalGrade).toBe('');
      expect(result.sealedRcsAssessmentId).toBe('RCS-1');
    });

    it('logs a non-Error RcsAssessment or SpecimenPreanalytics failure as given, and keeps the sample', async () => {
      const db = makeDb();
      seedStorage(db);
      stubPlacement();
      vi.spyOn(qualityDomain, 'resolveMethodologicalQuality').mockReturnValue({ model_version: 'rcs-test', final_grade: 'A' });
      vi.spyOn(rcsAssessmentService, 'recordAssessment').mockRejectedValue('rcs store down');
      vi.spyOn(specimenPreanalyticsService, 'recordProfile').mockRejectedValue('sprec store down');
      const logError = vi.spyOn(logger, 'error');

      const result = await sampleService.createSample(db, sampleData({ sprec: { matrixType: 'PLASMA' } }));

      expect(result._id).toBe('generated-id');
      expect(logError).toHaveBeenCalledWith('Falha ao registrar RcsAssessment para a amostra:', 'rcs store down');
      expect(logError).toHaveBeenCalledWith('Falha ao registrar SpecimenPreanalytics para a amostra:', 'sprec store down');
    });
  });

  describe('createSample: failures without a transaction', () => {
    it('wraps a non-Error ledger failure by its value and deletes the inserted sample', async () => {
      const db = makeDb();
      seedStorage(db);
      stubPlacement();
      db.collection('sample_movements').insertOne.mockRejectedValue('ledger down');

      await expect(sampleService.createSample(db, sampleData()))
        .rejects.toThrow('Falha ao registrar cadeia de custódia no nascimento da amostra: ledger down');
      expect(db.collection('samples').deleteOne).toHaveBeenCalledWith({ _id: 'generated-id' });
    });

    it('answers 422 for a non-Error allocation failure, naming its value', async () => {
      const db = makeDb();
      seedStorage(db);
      const { execute } = stubPlacement();
      execute.mockRejectedValue('allocator offline');

      await expect(sampleService.createSample(db, sampleData())).rejects.toMatchObject({
        statusCode: 422,
        message: 'Falha ao alocar amostra na posição de armazenamento: allocator offline',
      });
      expect(db.collection('samples').deleteOne).toHaveBeenCalledWith({ _id: 'generated-id' });
    });

    it('answers 409 for an allocation that collides with an occupied position', async () => {
      const db = makeDb();
      seedStorage(db);
      const { execute } = stubPlacement();
      execute.mockRejectedValue(new Error('STORAGE_COLLISION: A1 occupied'));

      await expect(sampleService.createSample(db, sampleData())).rejects.toMatchObject({ statusCode: 409 });
    });

    it('answers 422 for a non-Error label failure, naming its value, and deletes the inserted sample', async () => {
      const db = makeDb();
      seedStorage(db);
      const { openLoad } = stubPlacement();
      openLoad.mockRejectedValue('chain down');

      await expect(sampleService.createSample(db, sampleData())).rejects.toMatchObject({
        statusCode: 422,
        message: 'Falha ao emitir a etiqueta da amostra: chain down',
      });
      expect(db.collection('samples').deleteOne).toHaveBeenCalledWith({ _id: 'generated-id' });
    });
  });

  describe('createSample: failures inside a transaction', () => {
    it('wraps a ledger failure that is not transient', async () => {
      const db = makeDb({ transactional: true });
      seedStorage(db);
      stubPlacement();
      db.collection('sample_movements').insertOne.mockRejectedValue(new Error('disk full'));

      await expect(sampleService.createSample(db, sampleData()))
        .rejects.toThrow('Falha ao registrar cadeia de custódia no nascimento da amostra: disk full');
      expect(db.session.withTransaction).toHaveBeenCalledTimes(1);
    });

    it('rethrows a transient label failure unwrapped, so the transaction can retry it', async () => {
      const db = makeDb({ transactional: true });
      seedStorage(db);
      const { openLoad } = stubPlacement();
      const transient = new MongoServerError({ message: 'WriteConflict', code: 112, errorLabels: ['TransientTransactionError'] });
      openLoad.mockRejectedValue(transient);

      await expect(sampleService.createSample(db, sampleData())).rejects.toBe(transient);
    });
  });

  describe('withdrawSample', () => {
    const withdrawal = (overrides = {}) => ({
      withdrawalType: 'Parcial',
      withdrawalResponsible: 'Ana Souza',
      linkedProject: 'ProjectX',
      withdrawalQuantity: 4,
      ...overrides,
    });

    function withdrawDb(sample) {
      const db = makeDb();
      db.collection('samples').findOne.mockResolvedValue(sample);
      vi.spyOn(legalHoldService, 'specimenHoldRefusal').mockResolvedValue(null);
      vi.spyOn(SampleMovementModel, 'generateMovementID').mockResolvedValue('MOV-W');
      return db;
    }

    it('withdraws from quantity when there is no currentQuantity, in µL, and logs the _id when there is no barcode', async () => {
      const id = new ObjectId();
      const db = withdrawDb({ _id: id, specimenId: 'SP-1', quantity: 10 });
      const logInfo = vi.spyOn(logger, 'info');

      const result = await sampleService.withdrawSample(db, 'SP-1', withdrawal());

      expect(result).toMatchObject({ withdrawnQuantity: 4, remainingQuantity: 6, quantityStatus: 'partial' });
      expect(birthMovement(db)).toMatchObject({ type: 'withdraw', unit: 'µL', previousQuantity: 10, newQuantity: 6 });
      expect(logInfo).toHaveBeenCalledWith(`Retirada registrada: Sample ${id}, Qtd: 4, Novo saldo: 6`);
    });

    it('names µL for a depleted sample with no unit', async () => {
      const db = withdrawDb({ _id: new ObjectId(), specimenId: 'SP-1', quantity: 10, currentQuantity: 0 });

      await expect(sampleService.withdrawSample(db, 'SP-1', withdrawal()))
        .rejects.toThrow('Quantidade indisponível. Disponível: 0 µL');
    });

    it('names µL when a partial withdrawal exceeds a sample with no unit', async () => {
      const db = withdrawDb({ _id: new ObjectId(), specimenId: 'SP-1', quantity: 10, currentQuantity: 10 });

      await expect(sampleService.withdrawSample(db, 'SP-1', withdrawal({ withdrawalQuantity: 20 })))
        .rejects.toThrow('Quantidade indisponível. Disponível: 10 µL');
    });
  });

  describe('updateSample', () => {
    it('derives quantityStatus from a sent initialQuantity', async () => {
      const db = makeDb();
      db.collection('samples').findOne.mockResolvedValue({ _id: new ObjectId(), specimenId: 'SP-1', specimenStatus: 'available', quantity: 10, currentQuantity: 10 });

      await sampleService.updateSample(db, 'SP-1', { initialQuantity: 20 });

      const [, update] = db.collection('samples').updateOne.mock.calls[0];
      // RF006 AC4 (#1531): before any movement the correction re-derives the balance.
      expect(update.$set).toMatchObject({ initialQuantity: 20, currentQuantity: 20, quantityStatus: 'full' });
    });

    it('records no status change for a stored status that folds to empty when the edit sends none', async () => {
      const db = makeDb();
      db.collection('samples').findOne.mockResolvedValue({ _id: new ObjectId(), specimenId: 'SP-1', specimenStatus: '   ', quantity: 10 });
      const record = vi.spyOn(operationalStateDecisionService, 'recordStatusChange');

      await sampleService.updateSample(db, 'SP-1', { notes: 'relabelled' });

      const [, update] = db.collection('samples').updateOne.mock.calls[0];
      expect(update.$set).not.toHaveProperty('specimenStatus');
      expect(update.$set.notes).toBe('relabelled');
      expect(record).not.toHaveBeenCalled();
    });

    it('writes a status change in the transaction and keys a sample with no specimenId by its _id', async () => {
      const id = new ObjectId();
      const db = makeDb({ transactional: true });
      db.collection('samples').findOne.mockResolvedValue({ _id: id, specimenStatus: 'available', quantity: 10 });
      const record = vi.spyOn(operationalStateDecisionService, 'recordStatusChange').mockResolvedValue({});

      await sampleService.updateSample(db, String(id), { specimenStatus: 'reserved' });

      expect(db.collection('samples').updateOne.mock.calls[0][2]).toEqual({ session: db.session });
      expect(record).toHaveBeenCalledWith(db, expect.objectContaining({
        specimenId: String(id), previousStatus: 'available', newStatus: 'reserved',
      }), { session: db.session });
    });
  });

  describe('getSampleByBarcode', () => {
    it('tries a numeric barcode as a number, then by pattern, and answers no sample', async () => {
      const db = makeDb();

      const result = await sampleService.getSampleByBarcode(db, '12345');

      expect(result).toEqual({ sample: null, participant: null });
      expect(db.collection('samples').findOne).toHaveBeenCalledWith({ barcode: 12345 });
      expect(db.collection('samples').findOne).toHaveBeenCalledWith({ barcode: { $regex: /^12345$/i } });
    });

    it('answers no participant when the sample names a participant with no patient record', async () => {
      const db = makeDb();
      db.collection('samples').findOne.mockResolvedValue({ _id: 'S-1', barcode: 'BC-1', participantId: '12345678' });

      const result = await sampleService.getSampleByBarcode(db, 'BC-1');

      expect(result.sample.barcode).toBe('BC-1');
      expect(result.participant).toBeNull();
    });

    it('masks the name and answers no record number when the participant has no identity record', async () => {
      const db = makeDb();
      db.collection('samples').findOne.mockResolvedValue({ _id: 'S-1', barcode: 'BC-1', participantId: '12345678' });
      db.collection('patients').findOne.mockResolvedValue({ participantId: '12345678' });

      const result = await sampleService.getSampleByBarcode(db, 'BC-1');

      expect(result.participant).toEqual({ participantId: '12345678', patientName: '***', recordNumber: null });
    });
  });

  describe('returnSample', () => {
    const returnData = (overrides = {}) => ({
      returnResponsible: 'Ana Souza',
      condition: 'intact',
      returnType: 'Parcial',
      returnQuantity: 2,
      ...overrides,
    });

    function returnDb(sample) {
      const db = makeDb();
      db.collection('samples').findOne.mockResolvedValue(sample);
      vi.spyOn(SampleMovementModel, 'generateMovementID').mockResolvedValue('MOV-R');
      return db;
    }

    it('refuses a sample with no totalWithdrawn as having nothing pending', async () => {
      const db = returnDb({ _id: new ObjectId(), specimenId: 'SP-1', quantity: 10, currentQuantity: 10 });

      await expect(sampleService.returnSample(db, 'SP-1', returnData()))
        .rejects.toThrow('Não há quantidade pendente de devolução para esta amostra');
    });

    it('names µL when a return exceeds what is pending on a sample with no unit', async () => {
      const db = returnDb({ _id: new ObjectId(), specimenId: 'SP-1', quantity: 10, currentQuantity: 5, totalWithdrawn: 5 });

      await expect(sampleService.returnSample(db, 'SP-1', returnData({ returnQuantity: 8 })))
        .rejects.toThrow('Quantidade excede o pendente de devolução. Pendente: 5 µL');
    });

    it('returns in full against quantity when there is no initialQuantity, in µL, and logs the _id when there is no barcode', async () => {
      const id = new ObjectId();
      const db = returnDb({ _id: id, specimenId: 'SP-1', quantity: 10, currentQuantity: 5, totalWithdrawn: 5 });
      const logInfo = vi.spyOn(logger, 'info');

      const result = await sampleService.returnSample(db, 'SP-1', returnData({ returnType: 'Total' }));

      expect(result).toMatchObject({ returnedQuantity: 5, newAvailableQuantity: 10, quantityStatus: 'full' });
      expect(birthMovement(db)).toMatchObject({ type: 'return', unit: 'µL', previousQuantity: 5, newQuantity: 10 });
      expect(logInfo).toHaveBeenCalledWith(`Devolução registrada: Sample ${id}, Qtd: 5, Condição: intact, Novo saldo: 10`);
    });
  });

  describe('closeSpecimen', () => {
    it('keys a sample with no specimenId by its _id, and answers no decision id when the record has none', async () => {
      const id = new ObjectId();
      const db = makeDb();
      db.collection('samples').findOne.mockResolvedValue({ _id: id, quantity: 10, currentQuantity: 0 });
      vi.spyOn(operationalStateDecisionService, 'recordStatusChange').mockResolvedValue({});

      const result = await sampleService.closeSpecimen(db, String(id));

      expect(result).toMatchObject({ specimenId: String(id), specimenStatus: 'closed', operationalStateDecisionId: null });
      expect(db.collection('samples').updateOne.mock.calls[0][2]).toBeUndefined();
    });

    it('writes the close with the transaction session where one runs', async () => {
      const db = makeDb({ transactional: true });
      db.collection('samples').findOne.mockResolvedValue({ _id: new ObjectId(), specimenId: 'SP-1', specimenStatus: 'available', quantity: 10, currentQuantity: 0 });
      vi.spyOn(operationalStateDecisionService, 'recordStatusChange').mockResolvedValue({ operationalStateDecisionId: 'OSD-1' });

      const result = await sampleService.closeSpecimen(db, 'SP-1');

      expect(result.operationalStateDecisionId).toBe('OSD-1');
      expect(db.collection('samples').updateOne.mock.calls[0][2]).toEqual({ session: db.session });
    });

    it('answers 409 when the sample changed between the read and the write', async () => {
      const db = makeDb();
      db.collection('samples').findOne.mockResolvedValue({ _id: new ObjectId(), specimenId: 'SP-1', specimenStatus: 'available', quantity: 10, currentQuantity: 0 });
      db.collection('samples').updateOne.mockResolvedValue({ matchedCount: 0 });
      const record = vi.spyOn(operationalStateDecisionService, 'recordStatusChange');

      await expect(sampleService.closeSpecimen(db, 'SP-1'))
        .rejects.toMatchObject({ statusCode: 409, message: 'Amostra alterada concorrentemente; leia-a de novo' });
      expect(record).not.toHaveBeenCalled();
    });
  });
});
