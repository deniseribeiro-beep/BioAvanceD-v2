import { describe, it, expect, beforeEach, vi } from 'vitest';
const SampleGraphValidator = require('../../src/services/SampleGraphValidator');
const { generateSampleHash } = require('../../src/services/MerkleService');

// #1337: the branches sample-graph-validator.service.test.js leaves
// uncovered -- each graph node's failure and fallback arms, the report's
// identifier fallbacks, and the specimenStatus merge's remaining arms.

const OBJECT_ID = '507f1f77bcf86cd799439011';

function buildSample(overrides = {}) {
  const sample = {
    _id: OBJECT_ID,
    sampleID: 'S-0001',
    participantId: '12345678',
    consentTemplateId: 'tcle-001',
    quality_category: 'A',
    sprec: {
      matrixType: 'fluid',
      sampleType: 'BLD',
      primaryContainer: 'SST',
      preCentrifugation: 'A',
      centrifugation: 'A',
      secondCentrifugation: 'A',
      postCentrifugationDelay: 'A',
      longTermStorage: 'C',
    },
    clinicalData: {
      orphaCode: 'ORPHA:324',
      cid: 'E75.2',
      biomarkerValues: { 'Lyso-Gb3': '4.2' },
    },
    pharmacologyData: {
      treatmentStatus: 'ON_TREATMENT',
      medicationName: 'Migalastat',
      atcCode: 'A16AX27',
      atcClass: 'A',
    },
  };

  const merged = {
    ...sample,
    ...overrides,
    clinicalData: { ...sample.clinicalData, ...(overrides.clinicalData || {}) },
    pharmacologyData: { ...sample.pharmacologyData, ...(overrides.pharmacologyData || {}) },
  };
  merged.merkleRoot = generateSampleHash(merged);
  return merged;
}

function reseal(sample) {
  sample.merkleRoot = generateSampleHash(sample);
  return sample;
}

function cursor(rows) {
  return { sort: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(rows) }) };
}

const FABRY = {
  orpha_code: '324',
  name: 'Doenca de Fabry',
  disease_category: 'Erros Inatos do Metabolismo',
  drug_classes: ['A'],
  validation_requirements: {
    miabis: { requireTreatmentStatus: true },
    pharmacology: {
      required: ['treatmentStatus'],
      recommended: [],
      treatmentStatuses: ['NAIVE', 'TREATED', 'ON_TREATMENT', 'WASHOUT'],
    },
  },
};

describe('SampleGraphValidator branches (#1337)', () => {
  let samples;
  let consents;
  let diseases;
  let medications;
  let movements;
  let quarantineActions;
  let decisions;
  let validator;

  beforeEach(() => {
    samples = {
      findOne: vi.fn(),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    };
    consents = {
      findOne: vi.fn().mockResolvedValue({ status: 'ACTIVE', participantId: '12345678' }),
    };
    diseases = { findOne: vi.fn().mockResolvedValue(FABRY) };
    medications = {
      findOne: vi.fn().mockResolvedValue({ atc_code: 'A16AX27', drug_class: 'A', active: true }),
    };
    movements = {
      find: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([]),
            next: vi.fn().mockResolvedValue(null),
          }),
        }),
      }),
      findOne: vi.fn().mockResolvedValue(null),
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'movement-1' }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
      createIndex: vi.fn().mockResolvedValue(undefined),
    };
    const counters = { findOneAndUpdate: vi.fn().mockResolvedValue({ value: { seq: 1 } }) };
    const empty = { find: vi.fn().mockReturnValue(cursor([])), findOne: vi.fn().mockResolvedValue(null) };
    quarantineActions = {
      find: vi.fn().mockReturnValue(cursor([])),
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'qa-1' }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    };
    decisions = { insertOne: vi.fn().mockResolvedValue({ insertedId: 'osd-1' }) };

    const db = {
      listCollections: () => ({ toArray: async () => ([{ name: 'samples' }, { name: 'consents' }]) }),
      collection: (name) => {
        if (name === 'samples') return samples;
        if (name === 'consents' || name === 'patientConsents') return consents;
        if (name === 'disease_dictionary' || name === 'diseaseDictionary') return diseases;
        if (name === 'medication_dictionary' || name === 'medicationDictionary') return medications;
        if (name === 'sample_movements' || name === 'sampleMovements') return movements;
        if (name === 'counters') return counters;
        if (name === 'rcsAssessments' || name === 'specimenPreanalytics') return empty;
        if (name === 'quarantineActions') return quarantineActions;
        if (name === 'operationalStateDecisions') return decisions;
        throw new Error(`Unexpected collection name: ${name}`);
      },
    };
    validator = new SampleGraphValidator(db);
  });

  async function evaluate(sample, id = OBJECT_ID) {
    samples.findOne.mockResolvedValue(sample);
    return validator.validateSampleCompliance(id);
  }

  it('refuses to run without a database', async () => {
    await expect(new SampleGraphValidator(null).validateSampleCompliance(OBJECT_ID))
      .rejects.toThrow('Database não inicializado para SampleGraphValidator');
  });

  describe('ethics node', () => {
    it('fails without querying consents when the sample has no participantId', async () => {
      const report = await evaluate(buildSample({ participantId: '' }));

      expect(report.graphPath.ethics).toEqual({ valid: false, reason: 'Consentimento Inválido ou Revogado' });
      expect(consents.findOne).not.toHaveBeenCalled();
      expect(report.suggestedStatus).toBe('BLOCKED');
    });

    it('looks an ObjectId consentTemplateId up by _id as well as by consentTemplateId', async () => {
      const tcleId = '507f1f77bcf86cd799439012';
      const report = await evaluate(buildSample({ consentTemplateId: tcleId }));

      const [query] = consents.findOne.mock.calls[0];
      expect(query.$or).toHaveLength(2);
      expect(String(query.$or[0]._id)).toBe(tcleId);
      expect(query.$or[1]).toEqual({ consentTemplateId: tcleId });
      expect(report.graphPath.ethics.valid).toBe(true);
    });

    it('fails when no consent matches the template', async () => {
      consents.findOne.mockResolvedValue(null);
      const report = await evaluate(buildSample());

      expect(report.graphPath.ethics).toEqual({ valid: false, reason: 'Consentimento Inválido ou Revogado' });
      expect(report.isReleasable).toBe(false);
    });

    it("scopes the consent lookup to the sample's participant, newest first (#1546)", async () => {
      await evaluate(buildSample());

      const [query, options] = consents.findOne.mock.calls[0];
      expect(query.participantId).toBe('12345678');
      expect(query.$or).toHaveLength(2);
      expect(options).toEqual({ sort: { signedAt: -1, updatedAt: -1, createdAt: -1 } });
    });
  });

  describe('disease requirements', () => {
    it('skips the disease lookup and fails clinical when the sample has no ORPHA code', async () => {
      const report = await evaluate(buildSample({ clinicalData: { orphaCode: '' } }));

      expect(diseases.findOne).not.toHaveBeenCalled();
      expect(report.disease).toBeNull();
      expect(report.orphaCode).toBe('');
      expect(report.graphPath.clinical).toEqual({ valid: false, reason: 'Dataset Clínico Incompleto' });
    });

    it('falls back to the default treatment statuses, which exclude ON_TREATMENT, when the disease has no validation_requirements', async () => {
      diseases.findOne.mockResolvedValue({ orpha_code: '324', name: 'Doenca de Fabry' });
      const report = await evaluate(buildSample());

      expect(report.graphPath.clinical).toEqual({
        valid: false,
        reason: 'Dataset Clínico Incompleto: treatment_status inválido (ON_TREATMENT)',
      });
      expect(report.suggestedStatus).toBe('BLOCKED');
    });

    it('releases a TREATED sample with no dictionary disease, naming no disease', async () => {
      diseases.findOne.mockResolvedValue(null);
      const report = await evaluate(buildSample({ pharmacologyData: { treatmentStatus: 'TREATED' } }));

      expect(report.disease).toBeNull();
      expect(report.graphPath.clinical).toEqual({ valid: true, reason: 'Dados clínicos e MIABIS essenciais presentes' });
      expect(report.graphPath.pharmacology.valid).toBe(true);
      expect(report.suggestedStatus).toBe('AVAILABLE');
    });

    it('accepts ON_TREATMENT from the built-in status list when the disease names no treatmentStatuses or required fields', async () => {
      diseases.findOne.mockResolvedValue({
        ...FABRY,
        validation_requirements: { miabis: { requireTreatmentStatus: false }, pharmacology: {} },
      });
      const report = await evaluate(buildSample({ pharmacologyData: { medicationName: '' } }));

      expect(report.graphPath.clinical).toEqual({
        valid: true,
        reason: 'Dados clínicos e MIABIS essenciais presentes para Doenca de Fabry',
      });
    });

    it('fails clinical when a pharmacology field the disease requires is blank', async () => {
      diseases.findOne.mockResolvedValue({
        ...FABRY,
        validation_requirements: {
          ...FABRY.validation_requirements,
          pharmacology: { ...FABRY.validation_requirements.pharmacology, required: ['treatmentStatus', 'medicationName'] },
        },
      });
      const report = await evaluate(buildSample({ pharmacologyData: { medicationName: '  ' } }));

      expect(report.graphPath.clinical).toEqual({
        valid: false,
        reason: 'Dataset Clínico Incompleto: campo farmacológico obrigatório (medicationName)',
      });
    });
  });

  describe('clinical and pharmacology nodes', () => {
    it('reads a non-object clinicalData and pharmacologyData as empty', async () => {
      const sample = buildSample();
      sample.clinicalData = 'not-an-object';
      sample.pharmacologyData = null;
      reseal(sample);

      const report = await evaluate(sample);

      expect(report.graphPath.clinical).toEqual({ valid: false, reason: 'Dataset Clínico Incompleto' });
      expect(report.graphPath.pharmacology).toEqual({
        valid: false,
        reason: 'INCOMPLETE: treatment_status (MIABIS) obrigatório',
      });
    });

    it('accepts a sample with no biomarkerValues, or only blank and symbol-only biomarker keys', async () => {
      const none = await evaluate(buildSample({ clinicalData: { biomarkerValues: undefined } }));
      expect(none.graphPath.clinical.valid).toBe(true);

      const blank = await evaluate(buildSample({ clinicalData: { biomarkerValues: { '': '1', '***': '2' } } }));
      expect(blank.graphPath.clinical.valid).toBe(true);
    });

    it('fails both nodes on a missing treatment status when MIABIS requires one', async () => {
      const report = await evaluate(buildSample({ pharmacologyData: { treatmentStatus: '' } }));

      expect(report.graphPath.clinical).toEqual({
        valid: false,
        reason: 'Dataset Clínico Incompleto: treatment_status (MIABIS) obrigatório',
      });
      expect(report.graphPath.pharmacology).toEqual({
        valid: false,
        reason: 'INCOMPLETE: treatment_status (MIABIS) obrigatório',
      });
    });

    it('does not consult the medication dictionary for an untreated (NAIVE) sample', async () => {
      const report = await evaluate(buildSample({ pharmacologyData: { treatmentStatus: 'NAIVE', atcCode: '' } }));

      expect(medications.findOne).not.toHaveBeenCalled();
      expect(report.graphPath.pharmacology).toEqual({ valid: true, reason: 'Nó farmacológico válido' });
    });

    it('fails pharmacology when an active treatment has no ATC code once the ATC: prefix is stripped', async () => {
      const report = await evaluate(buildSample({ pharmacologyData: { treatmentStatus: 'TREATED', atcCode: 'ATC:' } }));

      expect(report.graphPath.pharmacology).toEqual({
        valid: false,
        reason: 'INCOMPLETE: tratamento ativo exige atc_code',
      });
      expect(medications.findOne).not.toHaveBeenCalled();
    });

    it('passes pharmacology when the ATC code is not in the medication dictionary', async () => {
      medications.findOne.mockResolvedValue(null);
      const report = await evaluate(buildSample({ pharmacologyData: { atcClass: 'Z' } }));

      expect(report.graphPath.pharmacology.valid).toBe(true);
    });

    it("judges coherence by the sample's atcClass when the dictionary medication has no drug_class", async () => {
      medications.findOne.mockResolvedValue({ atc_code: 'A16AX27', active: true });

      const incoherent = await evaluate(buildSample({ pharmacologyData: { atcClass: 'Z' } }));
      expect(incoherent.graphPath.pharmacology).toEqual({
        valid: false,
        reason: 'INCOMPLETE: classe farmacológica ATC não coerente com a patologia ORPHA',
      });

      const coherent = await evaluate(buildSample({ pharmacologyData: { atcClass: 'a' } }));
      expect(coherent.graphPath.pharmacology.valid).toBe(true);
    });
  });

  it('fails integrity when the sample carries no merkleRoot', async () => {
    const sample = buildSample();
    sample.merkleRoot = '';

    const report = await evaluate(sample);

    expect(report.graphPath.integrity).toEqual({
      valid: false,
      reason: 'Violação de Integridade Criptográfica (Tampering)',
    });
    expect(report.suggestedStatus).toBe('BLOCKED');
  });

  describe('report identifier', () => {
    // A blocked sample already at unavailable: no status change and no seal,
    // so only the report's identifier fallbacks are exercised.
    const STILL_BLOCKED = { clinicalData: { cid: '' }, specimenStatus: 'unavailable' };

    it('falls back to sampleID when the sample has no _id', async () => {
      const sample = buildSample(STILL_BLOCKED);
      delete sample._id;
      reseal(sample);

      const report = await evaluate(sample, 'S-0001');

      expect(report.sampleId).toBe('S-0001');
      expect(report.suggestedStatus).toBe('BLOCKED');
    });

    it('falls back to the requested id when the sample has neither _id nor sampleID', async () => {
      const sample = buildSample(STILL_BLOCKED);
      delete sample._id;
      delete sample.sampleID;
      reseal(sample);

      const report = await evaluate(sample, 'SP-REQ');

      expect(report.sampleId).toBe('SP-REQ');
    });

    it('refuses to seal a releasable sample that has neither specimenId nor _id', async () => {
      const sample = buildSample();
      delete sample._id;
      reseal(sample);

      await expect(evaluate(sample, 'S-0001'))
        .rejects.toThrow('specimenId é obrigatório para registrar evento de ledger');
      expect(movements.insertOne).not.toHaveBeenCalled();
    });
  });

  describe('specimenStatus merge', () => {
    const BLOCKING = { clinicalData: { cid: '' } };

    it('reads an unrecognised stored specimenStatus as available and escalates it', async () => {
      const report = await evaluate(buildSample({ ...BLOCKING, specimenStatus: 'reserved' }));

      expect(report.suggestedStatus).toBe('BLOCKED');
      const [, update] = samples.updateOne.mock.calls[0];
      expect(update.$set.specimenStatus).toBe('unavailable');
      expect(decisions.insertOne.mock.calls[0][0]).toMatchObject({
        previousStatus: 'reserved',
        newStatus: 'unavailable',
      });
    });

    it('releases its own active action before opening the escalated one', async () => {
      quarantineActions.find.mockReturnValue(cursor([
        { quarantineActionId: 'qa-own', actionStatus: 'active', reasonCodes: ['COMPLIANCE_GRAPH_QUALITY'] },
      ]));

      const report = await evaluate(buildSample({ ...BLOCKING, specimenStatus: 'quarantined' }));

      expect(report.suggestedStatus).toBe('BLOCKED');
      expect(quarantineActions.updateOne).toHaveBeenCalledWith(
        { quarantineActionId: 'qa-own' },
        expect.objectContaining({ $set: expect.objectContaining({ actionStatus: 'released' }) }),
        undefined
      );
      expect(quarantineActions.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({ reasonCodes: ['COMPLIANCE_GRAPH_CLINICAL'] }),
        undefined
      );
      const opened = quarantineActions.insertOne.mock.calls[0][0];
      expect(decisions.insertOne.mock.calls[0][0]).toMatchObject({
        previousStatus: 'quarantined',
        newStatus: 'unavailable',
        triggerEventId: opened.quarantineActionId,
      });
    });

    it('records the downgrade under a fresh event id when its own action is gone by release time', async () => {
      quarantineActions.find
        .mockReturnValueOnce(cursor([
          { quarantineActionId: 'qa-own', actionStatus: 'active', reasonCodes: ['COMPLIANCE_GRAPH_QUALITY'] },
        ]))
        .mockReturnValueOnce(cursor([]));

      const report = await evaluate(buildSample({ specimenStatus: 'quarantined' }));

      expect(report.suggestedStatus).toBe('AVAILABLE');
      expect(quarantineActions.updateOne).not.toHaveBeenCalled();
      const [decision] = decisions.insertOne.mock.calls[0];
      expect(decision).toMatchObject({
        previousStatus: 'quarantined',
        newStatus: 'available',
        reasonCodes: ['COMPLIANCE_GRAPH_CLEARED'],
      });
      expect(decision.triggerEventId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });
  });
});

// #1505 (RF019 AC6): recordAction appends a QUARANTINE_APPLIED outbox event;
// this file's fake db has no outbox, and the event's contract is pinned in
// quarantine-action.service.test.js.
beforeEach(() => {
  const { GraphProjectionService } = require('../../src/services/graphProjection.service');
  vi.spyOn(GraphProjectionService.prototype, 'appendQuarantineApplyEvent').mockResolvedValue(null);
});
