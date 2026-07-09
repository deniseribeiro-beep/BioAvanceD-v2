import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const { ObjectId } = require('mongodb');
const analysisValidationService = require('../../src/services/analysisValidation.service');
const logger = require('../../src/utils/logger');

/**
 * Fake `db` exposing `.collection(name)` directly, bypassing getCollection's
 * internal destructured import (spying on collectionResolver's export after
 * the service already destructured it wouldn't work). listCollections is left
 * undefined so resolveCollectionName short-circuits straight to the preferred
 * canonical name ('samples' / 'patients').
 */
function createDb({ samples = {}, patients = {} } = {}) {
  const samplesCollection = { findOne: vi.fn(), ...samples };
  const patientsCollection = { findOne: vi.fn(), ...patients };

  const collection = vi.fn((name) => {
    if (name === 'samples') return samplesCollection;
    if (name === 'patients') return patientsCollection;
    throw new Error(`Unexpected collection name: ${name}`);
  });

  return {
    collection,
    listCollections: undefined,
    __samplesCollection: samplesCollection,
    __patientsCollection: patientsCollection
  };
}

describe('analysisValidationService.validateSampleExists', () => {
  it('finds a sample by ObjectId when the identifier is a valid ObjectId string', async () => {
    const oid = new ObjectId();
    const sampleDoc = { _id: oid, sampleID: '00001' };
    const findOne = vi.fn()
      .mockResolvedValueOnce(sampleDoc) // _id hit
      .mockResolvedValueOnce(null); // collision check: no other sample matches
    const db = createDb({ samples: { findOne } });

    const result = await analysisValidationService.validateSampleExists(db, oid.toString());

    expect(result).toEqual({ success: true, sample: sampleDoc });
    expect(findOne).toHaveBeenNthCalledWith(1, { _id: expect.any(ObjectId) });
    expect(findOne).toHaveBeenCalledTimes(2);
  });

  it('falls back to sampleID lookup when identifier is not a valid ObjectId', async () => {
    const sampleDoc = { _id: new ObjectId(), sampleID: '00001' };
    const findOne = vi.fn().mockResolvedValue(sampleDoc);
    const db = createDb({ samples: { findOne } });

    const result = await analysisValidationService.validateSampleExists(db, '00001');

    expect(result).toEqual({ success: true, sample: sampleDoc });
    // Only one call: the invalid-ObjectId branch must not attempt new ObjectId(...) at all.
    expect(findOne).toHaveBeenCalledTimes(1);
    expect(findOne).toHaveBeenCalledWith({ sampleID: '00001' });
  });

  it('falls back to barcode lookup as the third strategy when sampleID lookup misses', async () => {
    const sampleDoc = { _id: new ObjectId(), barcode: 'BR-2025-001' };
    const findOne = vi.fn()
      .mockResolvedValueOnce(null) // sampleID miss
      .mockResolvedValueOnce(sampleDoc); // barcode hit
    const db = createDb({ samples: { findOne } });

    const result = await analysisValidationService.validateSampleExists(db, 'BR-2025-001');

    expect(result).toEqual({ success: true, sample: sampleDoc });
    expect(findOne).toHaveBeenCalledTimes(2);
    expect(findOne).toHaveBeenNthCalledWith(1, { sampleID: 'BR-2025-001' });
    expect(findOne).toHaveBeenNthCalledWith(2, { barcode: 'BR-2025-001' });
  });

  it('tries ObjectId lookup first, then still falls through to sampleID/barcode if that misses', async () => {
    const oid = new ObjectId();
    const sampleDoc = { _id: new ObjectId(), barcode: oid.toString() };
    const findOne = vi.fn()
      .mockResolvedValueOnce(null) // ObjectId miss
      .mockResolvedValueOnce(null) // sampleID miss
      .mockResolvedValueOnce(sampleDoc); // barcode hit
    const db = createDb({ samples: { findOne } });

    // A 24-hex-char string is a valid ObjectId shape AND happens to be used as a barcode here.
    const result = await analysisValidationService.validateSampleExists(db, oid.toString());

    expect(result).toEqual({ success: true, sample: sampleDoc });
    expect(findOne).toHaveBeenCalledTimes(3);
  });

  it('fails closed instead of silently trusting the ObjectId match when the same identifier also matches a different sample by sampleID/barcode (issue #34)', async () => {
    const oid = new ObjectId();
    const idMatch = { _id: oid, sampleID: 'S-BY-ID' };
    const otherSample = { _id: new ObjectId(), barcode: oid.toString() };
    const findOne = vi.fn()
      .mockResolvedValueOnce(idMatch) // _id hit
      .mockResolvedValueOnce(otherSample); // collision check: a different sample matches by barcode/sampleID

    const db = createDb({ samples: { findOne } });

    const result = await analysisValidationService.validateSampleExists(db, oid.toString());

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/ambígu/i);
    expect(findOne).toHaveBeenCalledTimes(2);
  });

  it('returns a not-found failure (distinct message) when no strategy matches', async () => {
    const db = createDb({
      samples: { findOne: vi.fn().mockResolvedValue(null) }
    });

    const result = await analysisValidationService.validateSampleExists(db, 'nope');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Amostra "nope" não encontrada. Verifique o ID ou código de barras.');
  });

  it('returns a generic DB-error failure (distinct from not-found) when the collection throws', async () => {
    const errSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const db = createDb({
      samples: { findOne: vi.fn().mockRejectedValue(new Error('connection lost')) }
    });

    const result = await analysisValidationService.validateSampleExists(db, 'whatever');

    expect(result).toEqual({
      success: false,
      error: 'Erro ao validar amostra no banco de dados'
    });
    expect(result.error).not.toBe('Amostra "whatever" não encontrada. Verifique o ID ou código de barras.');
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe('analysisValidationService.validatePatientConsent', () => {
  it('short-circuits with no-patientID error and never touches the collection', async () => {
    const db = createDb();

    const result = await analysisValidationService.validatePatientConsent(db, { patientID: '' });

    expect(result).toEqual({
      success: false,
      error: 'Amostra não possui ID de paciente associado'
    });
    expect(db.collection).not.toHaveBeenCalled();
  });

  it('returns a not-found error including the patientID when patient is missing', async () => {
    const db = createDb({
      patients: { findOne: vi.fn().mockResolvedValue(null) }
    });

    const result = await analysisValidationService.validatePatientConsent(db, { patientID: 'P123' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Paciente P123 não encontrado no sistema');
  });

  it('rejects with wrong-status failure and defaults displayed status to NÃO DEFINIDO when status is missing', async () => {
    const db = createDb({
      patients: { findOne: vi.fn().mockResolvedValue({ patientID: 'P1' }) } // no status field
    });

    const result = await analysisValidationService.validatePatientConsent(db, { patientID: 'P1' });

    expect(result.success).toBe(false);
    expect(result.patientStatus).toBe('NÃO DEFINIDO');
    expect(result.error).toContain('NÃO DEFINIDO');
  });

  it('rejects with wrong-status failure reflecting the actual status when present but not ACCEPTED_CONSENT', async () => {
    const db = createDb({
      patients: { findOne: vi.fn().mockResolvedValue({ patientID: 'P1', status: 'PENDING' }) }
    });

    const result = await analysisValidationService.validatePatientConsent(db, { patientID: 'P1' });

    expect(result.success).toBe(false);
    expect(result.patientStatus).toBe('PENDING');
    expect(result.error).toContain('PENDING');
  });

  it('rejects with a distinct message when status is ACCEPTED_CONSENT but consentAcceptedAt is missing', async () => {
    const db = createDb({
      patients: { findOne: vi.fn().mockResolvedValue({ patientID: 'P1', status: 'ACCEPTED_CONSENT' }) }
    });

    const result = await analysisValidationService.validatePatientConsent(db, { patientID: 'P1' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Consentimento aceito mas data de aceitação não registrada. Contate o suporte.');
    expect(result.patientStatus).toBeUndefined();
  });

  it('succeeds with a reshaped patient subset when status is accepted and date is present', async () => {
    const rawPatient = {
      _id: new ObjectId(),
      patientID: 'P1',
      status: 'ACCEPTED_CONSENT',
      consentAcceptedAt: '2025-01-01T00:00:00Z',
      cpf: '123.456.789-00', // PII that must not leak into the reshaped output
      fullName: 'Jane Doe'
    };
    const db = createDb({
      patients: { findOne: vi.fn().mockResolvedValue(rawPatient) }
    });

    const result = await analysisValidationService.validatePatientConsent(db, { patientID: 'P1' });

    expect(result).toEqual({
      success: true,
      patient: {
        patientID: 'P1',
        consentStatus: 'ACCEPTED_CONSENT',
        consentAcceptedAt: '2025-01-01T00:00:00Z'
      }
    });
    expect(result.patient._id).toBeUndefined();
    expect(result.patient.cpf).toBeUndefined();
    expect(result.patient.fullName).toBeUndefined();
  });

  it('returns a generic error when the patients collection lookup throws', async () => {
    const errSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const db = createDb({
      patients: { findOne: vi.fn().mockRejectedValue(new Error('boom')) }
    });

    const result = await analysisValidationService.validatePatientConsent(db, { patientID: 'P1' });

    expect(result).toEqual({
      success: false,
      error: 'Erro ao validar consentimento do paciente'
    });
    errSpy.mockRestore();
  });
});

describe('analysisValidationService.validateUploadEligibility', () => {
  it('short-circuits and returns the sample-validation failure as-is when the sample is not found', async () => {
    const db = createDb({
      samples: { findOne: vi.fn().mockResolvedValue(null) },
      patients: { findOne: vi.fn() }
    });

    const result = await analysisValidationService.validateUploadEligibility(db, 'missing-sample');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Amostra "missing-sample" não encontrada. Verifique o ID ou código de barras.');
    // Patient lookup must never be attempted once sample validation fails.
    expect(db.__patientsCollection.findOne).not.toHaveBeenCalled();
  });

  it('short-circuits and returns the consent-validation failure as-is when consent is invalid', async () => {
    const sampleDoc = { _id: new ObjectId(), sampleID: '00001', patientID: 'P1' };
    const db = createDb({
      samples: { findOne: vi.fn().mockResolvedValue(sampleDoc) },
      patients: { findOne: vi.fn().mockResolvedValue({ patientID: 'P1', status: 'PENDING' }) }
    });

    const result = await analysisValidationService.validateUploadEligibility(db, '00001');

    expect(result.success).toBe(false);
    expect(result.patientStatus).toBe('PENDING');
    expect(result.eligible).toBeUndefined();
  });

  it('returns the full reshaped happy-path result with _id as a string, not an ObjectId instance', async () => {
    const oid = new ObjectId();
    const sampleDoc = {
      _id: oid,
      sampleID: '00001',
      barcode: 'BR-2025-001',
      patientID: 'P1',
      sampleType: 'blood',
      currentStatus: 'stored',
      extraField: 'should-not-leak'
    };
    const patientDoc = {
      _id: new ObjectId(),
      patientID: 'P1',
      status: 'ACCEPTED_CONSENT',
      consentAcceptedAt: '2025-01-01T00:00:00Z'
    };
    const db = createDb({
      samples: { findOne: vi.fn().mockResolvedValue(sampleDoc) },
      patients: { findOne: vi.fn().mockResolvedValue(patientDoc) }
    });

    const result = await analysisValidationService.validateUploadEligibility(db, '00001');

    expect(result.success).toBe(true);
    expect(result.eligible).toBe(true);
    expect(typeof result.sample._id).toBe('string');
    expect(result.sample._id).toBe(oid.toString());
    expect(result.sample).toEqual({
      _id: oid.toString(),
      sampleID: '00001',
      barcode: 'BR-2025-001',
      patientID: 'P1',
      sampleType: 'blood',
      currentStatus: 'stored'
    });
    expect(result.sample.extraField).toBeUndefined();
    expect(result.patient).toEqual({
      patientID: 'P1',
      consentStatus: 'ACCEPTED_CONSENT',
      consentAcceptedAt: '2025-01-01T00:00:00Z'
    });
  });
});
