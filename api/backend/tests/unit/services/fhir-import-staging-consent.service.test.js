/**
 * Unit tests for fhir-import-staging.service.js's consent-token and
 * external-document flows — validateImportConsentToken,
 * acceptImportConsentToken, getConsentStatus, attachExternalDocument.
 * These functions had zero coverage from the existing integration spec
 * (tests/integration/fhir-import.test.js), which never exercises the
 * token-accept or external-document-attach paths.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const jwt = require('jsonwebtoken');
const fhirImportStagingService = require('../../../src/services/fhir-import-staging.service');

function createCursor(items) {
  const current = [...items];
  return {
    sort: vi.fn(() => createCursor(current)),
    toArray: vi.fn(async () => current),
  };
}

// Mongo's semantics for the two shapes these services query with: a scalar
// matches an array field by membership, and { $in } matches any listed value.
// #1219 releases a QuarantineAction by { specimenIds: { $in: [...] } }.
function fieldMatches(docValue, value) {
  if (value && typeof value === 'object' && Array.isArray(value.$in)) {
    return value.$in.some((candidate) => fieldMatches(docValue, candidate));
  }
  if (Array.isArray(docValue)) return docValue.some((item) => String(item) === String(value));
  return String(docValue) === String(value);
}

function matchesFilter(doc, filter) {
  return Object.entries(filter).every(([key, value]) => fieldMatches(doc[key], value));
}

function createCollection() {
  const docs = [];
  return {
    docs,
    insertOne: vi.fn(async (doc) => {
      const inserted = { _id: doc._id || `id-${docs.length + 1}`, ...doc };
      docs.push(inserted);
      return { insertedId: inserted._id };
    }),
    insertMany: vi.fn(async (items) => {
      items.forEach((doc) => docs.push({ _id: doc._id || `id-${docs.length + 1}`, ...doc }));
      return { insertedCount: items.length };
    }),
    findOne: vi.fn(async (filter = {}) => docs.find((doc) => matchesFilter(doc, filter)) || null),
    find: vi.fn((filter = {}) => createCursor(docs.filter((doc) => matchesFilter(doc, filter)))),
    updateOne: vi.fn(async (filter = {}, update = {}, options = {}) => {
      let doc = docs.find((item) => matchesFilter(item, filter));
      if (!doc && options.upsert) {
        doc = { _id: `id-${docs.length + 1}`, ...filter };
        docs.push(doc);
      }
      if (!doc) return { matchedCount: 0, modifiedCount: 0 };
      Object.assign(doc, update.$setOnInsert || {}, update.$set || {});
      return { matchedCount: 1, modifiedCount: 1 };
    }),
  };
}

function createDb() {
  const collections = {
    import_batches: createCollection(),
    import_staging_records: createCollection(),
    patients: createCollection(),
    samples: createCollection(),
    audit_logs: createCollection(),
    quarantineActions: createCollection(),
  };
  return {
    collections,
    collection: (name) => collections[name] || (collections[name] = createCollection()),
  };
}

function signToken(payload) {
  return jwt.sign(payload, process.env.CONSENT_SECRET, { expiresIn: '2h' });
}

describe('fhir-import-staging.service — consent token & external document flows', () => {
  let db;

  beforeEach(() => {
    process.env.CONSENT_SECRET = 'test-consent-secret';
    db = createDb();
  });

  async function seedBatchAndRecord(recordOverrides = {}) {
    // #799: stageBundle stamps `type: 'FHIR_BUNDLE'` on every batch it writes,
    // and the readers now filter on it (import_batches is shared with the LGPD
    // quarantine path). An untyped batch is a shape no writer produces.
    const batch = await db.collection('import_batches').insertOne({ type: 'FHIR_BUNDLE', status: 'STAGED' });
    const record = await db.collection('import_staging_records').insertOne({
      batchId: batch.insertedId,
      rowNumber: 1,
      status: fhirImportStagingService.STATUS.VALID,
      normalized: { participantId: 'PART-1', patientEmail: 'p@example.com' },
      ...recordOverrides,
    });
    return { batchId: batch.insertedId, recordId: record.insertedId };
  }

  describe('validateImportConsentToken', () => {
    it('resolve batch/record quando token, batch e record coincidem', async () => {
      const { batchId, recordId } = await seedBatchAndRecord();
      const token = signToken({ scope: 'fhir-import-consent', batchId: String(batchId), recordId: String(recordId), participantId: 'PART-1' });

      const result = await fhirImportStagingService.validateImportConsentToken(db, token);

      expect(result.batch._id).toBe(batchId);
      expect(result.record._id).toBe(recordId);
      expect(result.tokenPayload.participantId).toBe('PART-1');
    });

    it('rejeita com 404 quando o batch não existe', async () => {
      const token = signToken({ scope: 'fhir-import-consent', batchId: 'missing-batch', recordId: 'missing-record', participantId: 'PART-1' });

      await expect(fhirImportStagingService.validateImportConsentToken(db, token)).rejects.toMatchObject({
        statusCode: 404,
      });
    });

    it('rejeita com 404 quando participantId do token não bate com o registro', async () => {
      const { batchId, recordId } = await seedBatchAndRecord();
      const token = signToken({ scope: 'fhir-import-consent', batchId: String(batchId), recordId: String(recordId), participantId: 'OUTRO-PARTICIPANTE' });

      await expect(fhirImportStagingService.validateImportConsentToken(db, token)).rejects.toMatchObject({
        statusCode: 404,
      });
    });
  });

  describe('acceptImportConsentToken', () => {
    it('assina o consentimento e libera o registro para commit', async () => {
      const { batchId, recordId } = await seedBatchAndRecord();
      const token = signToken({ scope: 'fhir-import-consent', batchId: String(batchId), recordId: String(recordId), participantId: 'PART-1' });

      const result = await fhirImportStagingService.acceptImportConsentToken(db, token);

      expect(result.updated).toBe(true);
      expect(result.record.normalized.consentSigned).toBe(true);
      expect(result.record.status).toBe(fhirImportStagingService.STATUS.READY_TO_COMMIT);
      expect(result.record.consentStatus).toBe('SIGNED');
      expect(result.record.quarantineStatus).toBe('RELEASED');
      expect(result.record.availabilityStatus).toBe('AVAILABLE');

      const auditLogs = db.collections.audit_logs.docs;
      expect(auditLogs.some((log) => log.action === 'FHIR_IMPORT_CONSENT_SIGNED')).toBe(true);
    });

    it('é idempotente quando o registro já está assinado e pronto para commit', async () => {
      const { batchId, recordId } = await seedBatchAndRecord({
        status: fhirImportStagingService.STATUS.READY_TO_COMMIT,
        normalized: { participantId: 'PART-1', patientEmail: 'p@example.com', consentSigned: true },
      });
      const token = signToken({ scope: 'fhir-import-consent', batchId: String(batchId), recordId: String(recordId), participantId: 'PART-1' });

      const result = await fhirImportStagingService.acceptImportConsentToken(db, token);

      expect(result.updated).toBe(false);
      expect(result.record.normalized.consentSigned).toBe(true);
    });

    it('remove o warning de consentimento pendente ao assinar', async () => {
      const { batchId, recordId } = await seedBatchAndRecord({
        warnings: [{ field: 'consent', message: 'TCLE ainda não enviado para assinatura.' }],
      });
      const token = signToken({ scope: 'fhir-import-consent', batchId: String(batchId), recordId: String(recordId), participantId: 'PART-1' });

      const result = await fhirImportStagingService.acceptImportConsentToken(db, token);

      expect(result.record.warnings).toEqual([]);
    });
  });

  describe('getConsentStatus', () => {
    it('mapeia registros do lote com status de consentimento persistido', async () => {
      const { batchId } = await seedBatchAndRecord({
        consentStatus: 'SIGNED',
        quarantineStatus: 'RELEASED',
        quarantineReason: null,
        availabilityStatus: 'AVAILABLE',
        workflowStatus: 'SIGNED',
        normalized: { participantId: 'PART-1', patientEmail: 'p@example.com', specimenId: 'SPEC-1', consentSigned: true },
        consentTracking: { sentAt: new Date() },
      });

      const result = await fhirImportStagingService.getConsentStatus(db, batchId);

      expect(result.batch._id).toBe(batchId);
      expect(result.records).toHaveLength(1);
      expect(result.records[0]).toMatchObject({
        specimenId: 'SPEC-1',
        participantId: 'PART-1',
        patientEmail: 'p@example.com',
        consentSigned: true,
        consentStatus: 'SIGNED',
        quarantineStatus: 'RELEASED',
        availabilityStatus: 'AVAILABLE',
      });
    });

    it('recalcula o status via workflow snapshot quando campos persistidos estão ausentes', async () => {
      const { batchId } = await seedBatchAndRecord({
        normalized: { participantId: 'PART-1', patientEmail: '', consentSigned: false },
      });

      const result = await fhirImportStagingService.getConsentStatus(db, batchId);

      expect(result.records[0].consentStatus).toBe('NOT_REQUIRED');
      expect(result.records[0].quarantineStatus).toBe('QUARANTINED');
      expect(result.records[0].availabilityStatus).toBe('BLOCKED');
      expect(result.records[0].workflowStatus).toBe('NEEDS_REVIEW');
    });
  });

  describe('commitBatch', () => {
    it('cria a amostra com specimenStatus available e sem QuarantineAction quando o consentimento foi assinado', async () => {
      const { batchId, recordId } = await seedBatchAndRecord({
        status: fhirImportStagingService.STATUS.READY_TO_COMMIT,
        normalized: {
          participantId: 'PART-1',
          patientEmail: 'p@example.com',
          specimenId: 'SPEC-COMMIT-1',
          sampleType: 'blood',
          consentSigned: true,
        },
      });

      const result = await fhirImportStagingService.commitBatch(db, batchId);

      expect(result.committed).toBe(1);
      const sample = db.collections.samples.docs.find((doc) => doc.specimenId === 'SPEC-COMMIT-1');
      expect(sample.specimenStatus).toBe('available');
      expect(db.collections.quarantineActions.docs).toHaveLength(0);

      const committedRecord = db.collections.import_staging_records.docs.find((doc) => doc._id === recordId);
      expect(committedRecord.status).toBe(fhirImportStagingService.STATUS.COMMITTED);
    });

    it('libera o QuarantineAction ativo quando uma amostra já quarentenada é comprometida como disponível', async () => {
      const { batchId } = await seedBatchAndRecord({
        status: fhirImportStagingService.STATUS.READY_TO_COMMIT,
        normalized: {
          participantId: 'PART-1',
          patientEmail: 'p@example.com',
          specimenId: 'SPEC-COMMIT-2',
          sampleType: 'blood',
          consentSigned: true,
        },
      });
      await db.collection('samples').insertOne({
        specimenId: 'SPEC-COMMIT-2',
        specimenStatus: 'quarantined',
        lifecycleStatus: 'QUARANTINED',
      });
      await db.collection('quarantineActions').insertOne({
        quarantineActionId: 'qa-commit-2',
        specimenIds: ['id-1'],
        actionStatus: 'active',
        startedAt: new Date(),
        authorizedBy: 'SYSTEM',
      });

      await fhirImportStagingService.commitBatch(db, batchId);

      const sample = db.collections.samples.docs.find((doc) => doc.specimenId === 'SPEC-COMMIT-2');
      expect(sample.specimenStatus).toBe('available');

      const releasedAction = db.collections.quarantineActions.docs.find((doc) => doc.quarantineActionId === 'qa-commit-2');
      expect(releasedAction.actionStatus).toBe('released');
    });
  });

  describe('attachExternalDocument', () => {
    it('anexa documentação externa, libera o registro e atualiza a amostra', async () => {
      const { batchId, recordId } = await seedBatchAndRecord({
        normalized: { participantId: 'PART-1', patientEmail: '', specimenId: 'SPEC-1' },
      });
      await db.collection('samples').insertOne({
        specimenId: 'SPEC-1',
        quarantineStatus: 'QUARANTINED',
        specimenStatus: 'quarantined',
        lifecycleStatus: 'QUARANTINED',
      });
      await db.collection('quarantineActions').insertOne({
        quarantineActionId: 'qa-1',
        specimenIds: ['id-1'],
        actionStatus: 'active',
        startedAt: new Date(),
        authorizedBy: 'SYSTEM',
      });

      const result = await fhirImportStagingService.attachExternalDocument(db, batchId, recordId, { userID: 'user-1', note: 'Documento validado manualmente' });

      const updatedRecord = db.collections.import_staging_records.docs.find((doc) => doc._id === recordId);
      expect(updatedRecord.status).toBe(fhirImportStagingService.STATUS.COMMITTED);
      expect(updatedRecord.consentStatus).toBe('EXTERNAL_ATTACHED');
      expect(updatedRecord.quarantineStatus).toBe('RELEASED');
      expect(updatedRecord.availabilityStatus).toBe('AVAILABLE');
      expect(updatedRecord.externalDocument).toMatchObject({
        attachedBy: 'user-1',
        validatedBy: 'user-1',
        note: 'Documento validado manualmente',
      });

      const updatedSample = db.collections.samples.docs.find((doc) => doc.specimenId === 'SPEC-1');
      expect(updatedSample.specimenStatus).toBe('available');

      const releasedAction = db.collections.quarantineActions.docs.find((doc) => doc.quarantineActionId === 'qa-1');
      expect(releasedAction.actionStatus).toBe('released');
      expect(releasedAction.authorizedBy).toBe('user-1');

      const auditLogs = db.collections.audit_logs.docs;
      expect(auditLogs.some((log) => log.action === 'FHIR_IMPORT_EXTERNAL_DOCUMENT_ATTACHED')).toBe(true);

      // attachExternalDocument returns getConsentStatus's shape
      expect(result.batch._id).toBe(batchId);
      expect(result.records[0].consentStatus).toBe('EXTERNAL_ATTACHED');
    });

    it('normaliza note ausente/vazia para null', async () => {
      const { batchId, recordId } = await seedBatchAndRecord({
        normalized: { participantId: 'PART-1', patientEmail: '', specimenId: 'SPEC-2' },
      });
      await db.collection('samples').insertOne({ specimenId: 'SPEC-2' });

      await fhirImportStagingService.attachExternalDocument(db, batchId, recordId, {});

      const updatedRecord = db.collections.import_staging_records.docs.find((doc) => doc._id === recordId);
      expect(updatedRecord.externalDocument.note).toBeNull();
      expect(updatedRecord.externalDocument.attachedBy).toBeNull();
    });

    it('rejeita com 404 quando o registro não é encontrado', async () => {
      const { batchId } = await seedBatchAndRecord();

      await expect(fhirImportStagingService.attachExternalDocument(db, batchId, 'registro-inexistente', {})).rejects.toMatchObject({
        statusCode: 404,
      });
    });
  });
});
