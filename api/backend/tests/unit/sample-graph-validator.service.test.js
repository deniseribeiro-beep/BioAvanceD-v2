import { describe, it, expect, beforeEach, vi } from 'vitest';
const SampleGraphValidator = require('../../src/services/SampleGraphValidator');
const { generateSampleHash } = require('../../src/services/MerkleService');

function buildSample(overrides = {}) {
  const sample = {
    _id: '507f1f77bcf86cd799439011',
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
      biomarkerValues: {
        'Lyso-Gb3': '4.2',
        'Atividade de Alfa-galactosidase A': '2.1',
      },
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
    clinicalData: {
      ...sample.clinicalData,
      ...(overrides.clinicalData || {}),
    },
    pharmacologyData: {
      ...sample.pharmacologyData,
      ...(overrides.pharmacologyData || {}),
    },
  };

  merged.merkleRoot = generateSampleHash(merged);
  return merged;
}

describe('SampleGraphValidator', () => {
  let db;
  let samplesCollection;
  let consentsCollection;
  let diseaseDictionaryCollection;
  let medicationDictionaryCollection;
  let sampleMovementsCollection;
  let rcsAssessmentsCollection;
  let specimenPreanalyticsCollection;
  let quarantineActionsCollection;
  let validator;

  beforeEach(() => {
    samplesCollection = {
      findOne: vi.fn(),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    };

    consentsCollection = {
      findOne: vi.fn(),
    };

    diseaseDictionaryCollection = {
      findOne: vi.fn().mockResolvedValue({
        orpha_code: '324',
        name: 'Doenca de Fabry',
        disease_category: 'Erros Inatos do Metabolismo',
        drug_classes: ['A'],
        validation_requirements: {
          miabis: { requireTreatmentStatus: true },
          biomarkers: {
            required: ['Lyso-Gb3', 'Atividade de Alfa-galactosidase A'],
            recommended: [],
          },
          pharmacology: {
            required: ['treatmentStatus'],
            recommended: [],
            treatmentStatuses: ['NAIVE', 'TREATED', 'ON_TREATMENT', 'WASHOUT'],
          },
        },
      }),
    };

    medicationDictionaryCollection = {
      findOne: vi.fn().mockResolvedValue({
        atc_code: 'A16AX27',
        drug_class: 'A',
        active: true,
      }),
    };

    sampleMovementsCollection = {
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

    const countersCollection = {
      findOneAndUpdate: vi.fn().mockResolvedValue({ value: { seq: 1 } }),
    };

    rcsAssessmentsCollection = {
      find: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([]),
        }),
      }),
      findOne: vi.fn().mockResolvedValue(null),
    };

    specimenPreanalyticsCollection = {
      find: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([]),
        }),
      }),
    };

    quarantineActionsCollection = {
      find: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([]),
        }),
      }),
      insertOne: vi.fn().mockResolvedValue({ insertedId: 'qa-1' }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    };

    db = {
      listCollections: () => ({
        toArray: async () => ([{ name: 'samples' }, { name: 'consents' }]),
      }),
      collection: (name) => {
        if (name === 'samples') return samplesCollection;
        if (name === 'consents' || name === 'patientConsents') return consentsCollection;
        if (name === 'disease_dictionary' || name === 'diseaseDictionary') return diseaseDictionaryCollection;
        if (name === 'medication_dictionary' || name === 'medicationDictionary') return medicationDictionaryCollection;
        if (name === 'sample_movements' || name === 'sampleMovements') return sampleMovementsCollection;
        if (name === 'counters') return countersCollection;
        if (name === 'rcsAssessments') return rcsAssessmentsCollection;
        if (name === 'specimenPreanalytics') return specimenPreanalyticsCollection;
        if (name === 'quarantineActions') return quarantineActionsCollection;
        throw new Error(`Unexpected collection name: ${name}`);
      },
    };

    validator = new SampleGraphValidator(db);
  });

  it('valida o nó de Ética com sucesso e falha', async () => {
    const validSample = buildSample();

    samplesCollection.findOne.mockResolvedValue(validSample);
    consentsCollection.findOne.mockResolvedValue({ status: 'ACTIVE', participantId: '12345678' });

    const successReport = await validator.validateSampleCompliance(validSample._id);
    expect(successReport.graphPath.ethics.valid).toBe(true);

    consentsCollection.findOne.mockResolvedValue({ status: 'REVOKED', participantId: '12345678' });
    const failReport = await validator.validateSampleCompliance(validSample._id);
    expect(failReport.graphPath.ethics.valid).toBe(false);
  });

  it('valida o nó de Qualidade com sucesso e falha', async () => {
    const goodSample = buildSample({ quality_category: 'B' });
    samplesCollection.findOne.mockResolvedValue(goodSample);
    consentsCollection.findOne.mockResolvedValue({ status: 'ACTIVE', participantId: '12345678' });

    const successReport = await validator.validateSampleCompliance(goodSample._id);
    expect(successReport.graphPath.quality.valid).toBe(true);

    const badSample = buildSample({
      sprec: {
        matrixType: 'fluid',
        sampleType: 'BLD',
        primaryContainer: 'SST',
        preCentrifugation: 'X',
        centrifugation: 'A',
        secondCentrifugation: 'A',
        postCentrifugationDelay: 'A',
        longTermStorage: 'C',
      },
    });
    samplesCollection.findOne.mockResolvedValue(badSample);
    const failReport = await validator.validateSampleCompliance(badSample._id);
    expect(failReport.graphPath.quality.valid).toBe(false);
    expect(failReport.suggestedStatus).toBe('QUARANTINE');
  });

  it('resolves quality through a referenced RcsAssessment snapshot when one is recorded for the sample, ignoring stale embedded legacy fields', async () => {
    const assessmentRecord = {
      specimenId: 'SPEC-001',
      governanceStatus: 0,
      finalGrade: 'E',
      rcsScore: 12,
      gradeRoute: 'Governance failure',
      axisPenalties: [],
      calculationTrace: {},
    };
    const sample = buildSample({ specimenId: 'SPEC-001', quality_category: 'A' });
    // MerkleService's integrity check also resolves through the referenced RcsAssessment
    // (#497) once specimenId is present, so the persisted root must reflect that same
    // resolved snapshot rather than the sample's legacy embedded (null) rcsScore fields.
    sample.merkleRoot = generateSampleHash({
      ...sample,
      rcsScore: assessmentRecord.rcsScore,
      finalGrade: assessmentRecord.finalGrade,
      calculationTrace: assessmentRecord.calculationTrace,
      axisPenalties: assessmentRecord.axisPenalties,
    });
    samplesCollection.findOne.mockResolvedValue(sample);
    consentsCollection.findOne.mockResolvedValue({ status: 'ACTIVE', participantId: '12345678' });

    rcsAssessmentsCollection.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([assessmentRecord]),
      }),
    });

    const report = await validator.validateSampleCompliance(sample._id);

    expect(rcsAssessmentsCollection.find).toHaveBeenCalledWith({ specimenId: 'SPEC-001' });
    expect(report.graphPath.quality.valid).toBe(false);
    expect(report.graphPath.quality.reason).toContain('bloqueado');
    expect(report.graphPath.integrity.valid).toBe(true);
    expect(report.suggestedStatus).toBe('QUARANTINE');
  });

  it('#502: pins integrity verification to the snapshot sealed at merkleRoot time, ignoring a newer snapshot recorded afterward', async () => {
    const sealedAssessment = {
      _id: 'assessment-sealed',
      specimenId: 'SPEC-002',
      governanceStatus: 1,
      finalGrade: 'A',
      rcsScore: 95,
      axisPenalties: [],
      calculationTrace: {},
    };
    // A later re-assessment for the same specimenId, recorded after sealing —
    // resolving "newest" instead of the pin would surface this one and
    // false-positive a tamper report.
    const laterAssessment = {
      _id: 'assessment-later',
      specimenId: 'SPEC-002',
      governanceStatus: 0,
      finalGrade: 'E',
      rcsScore: 10,
      axisPenalties: [],
      calculationTrace: {},
    };

    const sample = buildSample({ specimenId: 'SPEC-002', quality_category: 'A' });
    sample.sealedRcsAssessmentId = sealedAssessment._id;
    sample.merkleRoot = generateSampleHash({
      ...sample,
      rcsScore: sealedAssessment.rcsScore,
      finalGrade: sealedAssessment.finalGrade,
      calculationTrace: sealedAssessment.calculationTrace,
      axisPenalties: sealedAssessment.axisPenalties,
    });

    samplesCollection.findOne.mockResolvedValue(sample);
    consentsCollection.findOne.mockResolvedValue({ status: 'ACTIVE', participantId: '12345678' });

    // "newest first" would put laterAssessment ahead of sealedAssessment.
    rcsAssessmentsCollection.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([laterAssessment, sealedAssessment]),
      }),
    });
    rcsAssessmentsCollection.findOne.mockImplementation(async ({ _id }) => (
      [sealedAssessment, laterAssessment].find((a) => a._id === _id) || null
    ));

    const report = await validator.validateSampleCompliance(sample._id);

    expect(rcsAssessmentsCollection.findOne).toHaveBeenCalledWith({ _id: 'assessment-sealed' });
    expect(report.graphPath.integrity.valid).toBe(true);
  });

  it('valida o nó de Clínica com sucesso e falha em Fabry sem biomarcadores', async () => {
    const completeSample = buildSample();
    samplesCollection.findOne.mockResolvedValue(completeSample);
    consentsCollection.findOne.mockResolvedValue({ status: 'ACTIVE', participantId: '12345678' });

    const successReport = await validator.validateSampleCompliance(completeSample._id);
    expect(successReport.graphPath.clinical.valid).toBe(true);

    const incompleteFabrySample = buildSample({
      clinicalData: {
        orphaCode: 'ORPHA:324',
        cid: 'E75.2',
        biomarkerValues: {
          'Lyso-Gb3': 'n/a',
          'Atividade de Alfa-galactosidase A': '2.1',
        },
      },
    });
    samplesCollection.findOne.mockResolvedValue(incompleteFabrySample);

    const failReport = await validator.validateSampleCompliance(incompleteFabrySample._id);
    expect(failReport.graphPath.clinical.valid).toBe(false);
    expect(failReport.suggestedStatus).toBe('BLOCKED');
  });

  it('valida o nó de Integridade com sucesso e falha por tampering', async () => {
    const validSample = buildSample();
    samplesCollection.findOne.mockResolvedValue(validSample);
    consentsCollection.findOne.mockResolvedValue({ status: 'ACTIVE', participantId: '12345678' });

    const successReport = await validator.validateSampleCompliance(validSample._id);
    expect(successReport.graphPath.integrity.valid).toBe(true);

    const tampered = {
      ...validSample,
      clinicalData: {
        ...validSample.clinicalData,
        biomarkerValues: {
          ...validSample.clinicalData.biomarkerValues,
          'Lyso-Gb3': '99.9',
        },
      },
    };
    samplesCollection.findOne.mockResolvedValue(tampered);

    const failReport = await validator.validateSampleCompliance(tampered._id);
    expect(failReport.graphPath.integrity.valid).toBe(false);
    expect(failReport.suggestedStatus).toBe('BLOCKED');
  });

  describe('#532: writes specimenStatus/QuarantineAction instead of release_status', () => {
    function mockActiveAction(reasonCodes) {
      quarantineActionsCollection.find.mockReturnValue({
        sort: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([
            { quarantineActionId: 'qa-existing', actionStatus: 'active', reasonCodes },
          ]),
        }),
      });
    }

    it('does not touch specimenStatus or open a QuarantineAction when the graph is fully valid on a fresh (available) sample', async () => {
      const sample = buildSample();
      samplesCollection.findOne.mockResolvedValue(sample);
      consentsCollection.findOne.mockResolvedValue({ status: 'ACTIVE', participantId: '12345678' });

      const report = await validator.validateSampleCompliance(sample._id);

      expect(report.suggestedStatus).toBe('AVAILABLE');
      const [, update] = samplesCollection.updateOne.mock.calls[0];
      expect(update.$set.specimenStatus).toBeUndefined();
      expect(quarantineActionsCollection.insertOne).not.toHaveBeenCalled();
    });

    it('escalates specimenStatus to quarantined and records a COMPLIANCE_GRAPH_QUALITY action when only quality fails', async () => {
      const sample = buildSample({
        sprec: {
          matrixType: 'fluid',
          sampleType: 'BLD',
          primaryContainer: 'SST',
          preCentrifugation: 'X',
          centrifugation: 'A',
          secondCentrifugation: 'A',
          postCentrifugationDelay: 'A',
          longTermStorage: 'C',
        },
      });
      samplesCollection.findOne.mockResolvedValue(sample);
      consentsCollection.findOne.mockResolvedValue({ status: 'ACTIVE', participantId: '12345678' });

      const report = await validator.validateSampleCompliance(sample._id);

      expect(report.suggestedStatus).toBe('QUARANTINE');
      const [, update] = samplesCollection.updateOne.mock.calls[0];
      expect(update.$set.specimenStatus).toBe('quarantined');
      expect(quarantineActionsCollection.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({ reasonCodes: ['COMPLIANCE_GRAPH_QUALITY'] }),
        undefined
      );
    });

    it('escalates specimenStatus to unavailable when only pharmacology fails (#532: previously silently AVAILABLE)', async () => {
      const sample = buildSample({
        pharmacologyData: {
          treatmentStatus: 'ON_TREATMENT',
          medicationName: 'Migalastat',
          atcCode: 'Z99ZZ99',
          atcClass: 'Z',
        },
      });
      samplesCollection.findOne.mockResolvedValue(sample);
      consentsCollection.findOne.mockResolvedValue({ status: 'ACTIVE', participantId: '12345678' });
      // Disease's drug_classes default to ['A'] (diseaseDictionaryCollection
      // mock, above) — a found medication in an incoherent class fails the
      // pharmacology node's ATC-vs-ORPHA coherence check.
      medicationDictionaryCollection.findOne.mockResolvedValue({ atc_code: 'Z99ZZ99', drug_class: 'Z', active: true });

      const report = await validator.validateSampleCompliance(sample._id);

      expect(report.graphPath.pharmacology.valid).toBe(false);
      expect(report.isReleasable).toBe(false);
      expect(report.suggestedStatus).toBe('BLOCKED');
      const [, update] = samplesCollection.updateOne.mock.calls[0];
      expect(update.$set.specimenStatus).toBe('unavailable');
      expect(quarantineActionsCollection.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({ reasonCodes: expect.arrayContaining(['COMPLIANCE_GRAPH_PHARMACOLOGY']) }),
        undefined
      );
    });

    it('never overwrites a terminal specimenStatus (disposed/destroyed)', async () => {
      const sample = buildSample({
        specimenStatus: 'disposed',
        clinicalData: { orphaCode: 'ORPHA:324', cid: '' }, // fails clinical -> BLOCKED
      });
      samplesCollection.findOne.mockResolvedValue(sample);
      consentsCollection.findOne.mockResolvedValue({ status: 'ACTIVE', participantId: '12345678' });

      const report = await validator.validateSampleCompliance(sample._id);

      expect(report.suggestedStatus).toBe('BLOCKED');
      const [, update] = samplesCollection.updateOne.mock.calls[0];
      expect(update.$set.specimenStatus).toBeUndefined();
      expect(quarantineActionsCollection.insertOne).not.toHaveBeenCalled();
    });

    it('escalates over an active QuarantineAction from an unrelated source without releasing it', async () => {
      const sample = buildSample({
        specimenStatus: 'quarantined',
        clinicalData: { orphaCode: 'ORPHA:324', cid: '' }, // fails clinical -> BLOCKED
      });
      samplesCollection.findOne.mockResolvedValue(sample);
      consentsCollection.findOne.mockResolvedValue({ status: 'ACTIVE', participantId: '12345678' });
      mockActiveAction(['COLD_CHAIN_INCIDENT']);

      const report = await validator.validateSampleCompliance(sample._id);

      expect(report.suggestedStatus).toBe('BLOCKED');
      const [, update] = samplesCollection.updateOne.mock.calls[0];
      expect(update.$set.specimenStatus).toBe('unavailable');
      expect(quarantineActionsCollection.updateOne).not.toHaveBeenCalled();
      expect(quarantineActionsCollection.insertOne).toHaveBeenCalled();
    });

    it('releases its own prior action and downgrades specimenStatus when the graph clears', async () => {
      const sample = buildSample({ specimenStatus: 'quarantined' });
      samplesCollection.findOne.mockResolvedValue(sample);
      consentsCollection.findOne.mockResolvedValue({ status: 'ACTIVE', participantId: '12345678' });
      mockActiveAction(['COMPLIANCE_GRAPH_QUALITY']);

      const report = await validator.validateSampleCompliance(sample._id);

      expect(report.suggestedStatus).toBe('AVAILABLE');
      const [, update] = samplesCollection.updateOne.mock.calls[0];
      expect(update.$set.specimenStatus).toBe('available');
      expect(quarantineActionsCollection.updateOne).toHaveBeenCalledWith(
        { quarantineActionId: 'qa-existing' },
        expect.objectContaining({ $set: expect.objectContaining({ actionStatus: 'released' }) }),
        undefined
      );
      expect(quarantineActionsCollection.insertOne).not.toHaveBeenCalled();
    });

    it('does not downgrade specimenStatus when the active block belongs to an unrelated source', async () => {
      const sample = buildSample({ specimenStatus: 'quarantined' });
      samplesCollection.findOne.mockResolvedValue(sample);
      consentsCollection.findOne.mockResolvedValue({ status: 'ACTIVE', participantId: '12345678' });
      mockActiveAction(['COLD_CHAIN_INCIDENT']);

      const report = await validator.validateSampleCompliance(sample._id);

      expect(report.suggestedStatus).toBe('AVAILABLE');
      const [, update] = samplesCollection.updateOne.mock.calls[0];
      expect(update.$set.specimenStatus).toBeUndefined();
      expect(quarantineActionsCollection.updateOne).not.toHaveBeenCalled();
      expect(quarantineActionsCollection.insertOne).not.toHaveBeenCalled();
    });
  });
});
