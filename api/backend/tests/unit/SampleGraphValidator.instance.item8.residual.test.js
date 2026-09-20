import { describe, expect, it, vi } from 'vitest';
import { ObjectId } from 'mongodb';

const SampleGraphValidator = require('../../src/services/SampleGraphValidator');

describe('SampleGraphValidator instance residual branches', () => {
  it('covers ethics guards, lookup misses, participant mismatch and valid consent', async () => {
    const validator = new SampleGraphValidator({});

    await expect(validator._validateEthics({}, { findOne: vi.fn() })).resolves.toMatchObject({ valid: false });

    const miss = { findOne: vi.fn().mockResolvedValue(null) };
    await expect(validator._validateEthics({
      consentTemplateId: 'template-1',
      participantId: 'P-1',
    }, miss)).resolves.toMatchObject({ valid: false });
    expect(miss.findOne).toHaveBeenCalledWith({
      $or: [
        { _id: null },
        { consentTemplateId: 'template-1' },
      ],
    });

    const oid = new ObjectId();
    const inactive = { findOne: vi.fn().mockResolvedValue({ status: 'revoked', participantId: 'P-1' }) };
    await expect(validator._validateEthics({
      consentTemplateId: oid.toString(),
      participantId: 'P-1',
    }, inactive)).resolves.toMatchObject({ valid: false });
    expect(inactive.findOne.mock.calls[0][0].$or).toHaveLength(2);

    const mismatch = { findOne: vi.fn().mockResolvedValue({ status: 'ACTIVE', participantId: 'P-2' }) };
    await expect(validator._validateEthics({
      consentTemplateId: 'template-1',
      participantId: 'P-1',
    }, mismatch)).resolves.toMatchObject({ valid: false });

    const valid = { findOne: vi.fn().mockResolvedValue({ status: ' ACTIVE ', participantId: '' }) };
    await expect(validator._validateEthics({
      consentTemplateId: 'template-1',
      participantId: 'P-1',
    }, valid)).resolves.toEqual({
      valid: true,
      reason: 'Consentimento ativo e compatível com paciente',
    });
  });

  it('covers clinical required codes, biomarkers, MIABIS status and required pharmacology fields', () => {
    const validator = new SampleGraphValidator({});

    expect(validator._validateClinical({
      clinicalData: 'invalid',
      pharmacologyData: null,
    })).toMatchObject({ valid: false, reason: 'Dataset Clínico Incompleto' });

    const base = {
      clinicalData: { orphaCode: 'ORPHA:1', cid: 'A00', biomarkerValues: {} },
      pharmacologyData: { treatmentStatus: 'NAIVE' },
    };

    expect(validator._validateClinical(base, {
      miabis: { requireTreatmentStatus: false },
      biomarkers: { required: ['CRP'] },
      pharmacology: { required: [], treatmentStatuses: [] },
    })).toMatchObject({ valid: false, reason: expect.stringContaining('CRP') });

    expect(validator._validateClinical({
      ...base,
      clinicalData: { ...base.clinicalData, biomarkerValues: { crp: '1.5' } },
      pharmacologyData: {},
    }, {
      miabis: { requireTreatmentStatus: true },
      biomarkers: { required: ['CRP'] },
      pharmacology: { required: [], treatmentStatuses: ['NAIVE'] },
    })).toMatchObject({ valid: false, reason: expect.stringContaining('treatment_status') });

    expect(validator._validateClinical({
      ...base,
      pharmacologyData: { treatmentStatus: 'unexpected' },
    }, {
      miabis: { requireTreatmentStatus: true },
      biomarkers: { required: [] },
      pharmacology: { required: [], treatmentStatuses: ['NAIVE', 'TREATED'] },
    })).toMatchObject({ valid: false, reason: expect.stringContaining('inválido') });

    expect(validator._validateClinical({
      ...base,
      pharmacologyData: { treatmentStatus: 'NAIVE', medicationName: '' },
    }, {
      miabis: { requireTreatmentStatus: true },
      biomarkers: { required: 'not-an-array' },
      pharmacology: { required: ['medicationName'], treatmentStatuses: 'not-an-array' },
    })).toMatchObject({ valid: false, reason: expect.stringContaining('medicationName') });

    expect(validator._validateClinical(base, {
      miabis: { requireTreatmentStatus: true },
      biomarkers: { required: [] },
      pharmacology: { required: ['treatmentStatus'], treatmentStatuses: ['NAIVE'] },
    }, { name: 'Synthetic disease' })).toEqual({
      valid: true,
      reason: 'Dados clínicos e MIABIS essenciais presentes para Synthetic disease',
    });

    expect(validator._validateClinical(base, {
      miabis: { requireTreatmentStatus: true },
      biomarkers: { required: [] },
      pharmacology: { required: [], treatmentStatuses: [] },
    }, null)).toEqual({
      valid: true,
      reason: 'Dados clínicos e MIABIS essenciais presentes',
    });
  });

  it('covers pharmacology treatment guards and disease drug-class compatibility', async () => {
    const medicationCollection = {
      findOne: vi.fn(),
    };
    const db = {
      collection: vi.fn(() => medicationCollection),
    };
    const validator = new SampleGraphValidator(db);

    await expect(validator._validatePharmacology({
      pharmacologyData: {},
    }, {
      miabis: { requireTreatmentStatus: true },
    })).resolves.toMatchObject({ valid: false, reason: expect.stringContaining('treatment_status') });

    await expect(validator._validatePharmacology({
      pharmacologyData: { treatmentStatus: 'TREATED' },
    }, {
      miabis: { requireTreatmentStatus: true },
    })).resolves.toMatchObject({ valid: false, reason: expect.stringContaining('atc_code') });

    medicationCollection.findOne.mockResolvedValueOnce(null);
    await expect(validator._validatePharmacology({
      pharmacologyData: { treatmentStatus: 'TREATED', atcCode: 'ATC:A10' },
    }, {
      miabis: { requireTreatmentStatus: true },
    }, { drug_classes: ['class-a'] })).resolves.toMatchObject({ valid: true });

    medicationCollection.findOne.mockResolvedValueOnce({ drug_class: 'class-b' });
    await expect(validator._validatePharmacology({
      pharmacologyData: { treatmentStatus: 'ON_TREATMENT', atcCode: 'A10', atcClass: 'class-a' },
    }, {
      miabis: { requireTreatmentStatus: true },
    }, { drug_classes: [' class-a '] })).resolves.toMatchObject({
      valid: false,
      reason: expect.stringContaining('não coerente'),
    });

    medicationCollection.findOne.mockResolvedValueOnce({ drug_class: '' });
    await expect(validator._validatePharmacology({
      pharmacologyData: { treatmentStatus: 'TREATED', atcCode: 'A10', atcClass: '' },
    }, {
      miabis: { requireTreatmentStatus: false },
    }, { drug_classes: 'not-an-array' })).resolves.toEqual({
      valid: true,
      reason: 'Nó farmacológico válido',
    });

    await expect(validator._validatePharmacology({
      pharmacologyData: { treatmentStatus: 'NAIVE' },
    }, {
      miabis: { requireTreatmentStatus: false },
    })).resolves.toEqual({
      valid: true,
      reason: 'Nó farmacológico válido',
    });
  });
});
