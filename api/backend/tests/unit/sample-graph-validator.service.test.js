const { makeAuthToken, makeLegacyClaimsToken, buildAuthenticatedCollections, userForAccessType, TEST_USER_ACCOUNT_IDS } = require('../../factories/auth.factory');
import { describe, it, expect, beforeEach, vi } from 'vitest';
const { ObjectId } = require('mongodb');
const SampleGraphValidator = require('../../src/services/SampleGraphValidator');
const { generateSampleHash } = require('../../src/services/MerkleService');
const rcsReferenceData = require('../../src/services/rcs-reference-data');

function completeGovernanceEvidence(overrides = {}) {
  return Object.fromEntries(
    rcsReferenceData.governanceEvidenceCategories.map(({ key }) => [
      key,
      Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] : 'satisfied',
    ])
  );
}

function buildSample(overrides = {}) {
  const sample = {
    _id: '507f1f77bcf86cd799439011',
    specimenId: 'SPEC-0001',
    participantId: '12345678',
    consentTemplateId: 'tcle-001',
    quality_category: 'A',
    governanceEvidence: completeGovernanceEvidence(),
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
      insertOne: vi.fn().mockResolvedValue({ insertedId: TEST_USER_ACCOUNT_IDS[4] }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    };

    db = {
      listCollections: () => ({
        toArray: async () => ([{ name: 'samples' }, { name: 'consents' }]),
      }),
      collection: (name) => {
        if (name === 'specimens') return samplesCollection;
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

    const successReport = await validator.validateSampleCompliance(validSample.specimenId);
    expect(successReport.graphPath.ethics.valid).toBe(true);

    consentsCollection.findOne.mockResolvedValue({ status: 'REVOKED', participantId: '12345678' });
    const failReport = await validator.validateSampleCompliance(validSample.specimenId);
    expect(failReport.graphPath.ethics.valid).toBe(false);
  });

  it('valida o nó de Qualidade com sucesso e falha', async () => {
    const goodSample = buildSample({ quality_category: 'B' });
    samplesCollection.findOne.mockResolvedValue(goodSample);
    consentsCollection.findOne.mockResolvedValue({ status: 'ACTIVE', participantId: '12345678' });

    const successReport = await validator.validateSampleCompliance(goodSample.specimenId);
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
    const failReport = await validator.validateSampleCompliance(badSample.specimenId);
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

    const report = await validator.validateSampleCompliance(sample.specimenId);

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

    const report = await validator.validateSampleCompliance(sample.specimenId);

    expect(rcsAssessmentsCollection.findOne).toHaveBeenCalledWith({ _id: 'assessment-sealed' });
    expect(report.graphPath.integrity.valid).toBe(true);
  });

  it('valida o nó de Clínica com sucesso e falha em Fabry sem biomarcadores', async () => {
    const completeSample = buildSample();
    samplesCollection.findOne.mockResolvedValue(completeSample);
    consentsCollection.findOne.mockResolvedValue({ status: 'ACTIVE', participantId: '12345678' });

    const successReport = await validator.validateSampleCompliance(completeSample.specimenId);
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

    const failReport = await validator.validateSampleCompliance(incompleteFabrySample.specimenId);
    expect(failReport.graphPath.clinical.valid).toBe(false);
    expect(failReport.suggestedStatus).toBe('BLOCKED');
  });

  it('valida o nó de Integridade com sucesso e falha por tampering', async () => {
    const validSample = buildSample();
    samplesCollection.findOne.mockResolvedValue(validSample);
    consentsCollection.findOne.mockResolvedValue({ status: 'ACTIVE', participantId: '12345678' });

    const successReport = await validator.validateSampleCompliance(validSample.specimenId);
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

    const failReport = await validator.validateSampleCompliance(tampered.specimenId);
    expect(failReport.graphPath.integrity.valid).toBe(false);
    expect(failReport.suggestedStatus).toBe('BLOCKED');
  });

  describe('#1090/#804: canonical identifier resolution', () => {
    it('queries only the canonical specimenId for a non-ObjectId identifier', async () => {
      samplesCollection.findOne.mockResolvedValue(null);

      await expect(validator.validateSampleCompliance('SPX-CANONICAL-1'))
        .rejects.toThrow('Amostra não encontrada para validação de conformidade');

      const filter = samplesCollection.findOne.mock.calls[0][0];
      expect(filter).toEqual({ specimenId: 'SPX-CANONICAL-1' });
      expect(JSON.stringify(filter)).not.toContain('sampleID');
    });

    it('treats ObjectId-shaped strings as specimenId values, never as Mongo _id', async () => {
      samplesCollection.findOne.mockResolvedValue(null);

      await expect(validator.validateSampleCompliance('507f1f77bcf86cd799439011'))
        .rejects.toThrow('Amostra não encontrada para validação de conformidade');

      expect(samplesCollection.findOne.mock.calls[0][0]).toEqual({ specimenId: '507f1f77bcf86cd799439011' });
    });
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

      const report = await validator.validateSampleCompliance(sample.specimenId);

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

      const report = await validator.validateSampleCompliance(sample.specimenId);

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

      const report = await validator.validateSampleCompliance(sample.specimenId);

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

      const report = await validator.validateSampleCompliance(sample.specimenId);

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

      const report = await validator.validateSampleCompliance(sample.specimenId);

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

      const report = await validator.validateSampleCompliance(sample.specimenId);

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

      const report = await validator.validateSampleCompliance(sample.specimenId);

      expect(report.suggestedStatus).toBe('AVAILABLE');
      const [, update] = samplesCollection.updateOne.mock.calls[0];
      expect(update.$set.specimenStatus).toBeUndefined();
      expect(quarantineActionsCollection.updateOne).not.toHaveBeenCalled();
      expect(quarantineActionsCollection.insertOne).not.toHaveBeenCalled();
    });
  });

  describe('item 8 residual canonical branches', () => {
    it('covers database, ethics and consent identifier guard branches', async () => {
      await expect(new SampleGraphValidator(null).validateSampleCompliance('SPEC-NO-DB'))
        .rejects.toThrow('Database não inicializado para SampleGraphValidator');

      const missingIds = buildSample({ consentTemplateId: '', participantId: '' });
      samplesCollection.findOne.mockResolvedValue(missingIds);
      const missingIdsReport = await validator.validateSampleCompliance(missingIds.specimenId);
      expect(missingIdsReport.graphPath.ethics.valid).toBe(false);
      expect(consentsCollection.findOne).not.toHaveBeenCalled();

      const missingConsent = buildSample();
      samplesCollection.findOne.mockResolvedValue(missingConsent);
      consentsCollection.findOne.mockResolvedValueOnce(null);
      const missingConsentReport = await validator.validateSampleCompliance(missingConsent.specimenId);
      expect(missingConsentReport.graphPath.ethics.valid).toBe(false);

      const mismatchedParticipant = buildSample();
      samplesCollection.findOne.mockResolvedValue(mismatchedParticipant);
      consentsCollection.findOne.mockResolvedValueOnce({ status: 'ACTIVE', participantId: 'OTHER' });
      const mismatchReport = await validator.validateSampleCompliance(mismatchedParticipant.specimenId);
      expect(mismatchReport.graphPath.ethics.valid).toBe(false);

      const objectIdConsent = buildSample({ consentTemplateId: '507f1f77bcf86cd799439012' });
      samplesCollection.findOne.mockResolvedValue(objectIdConsent);
      consentsCollection.findOne.mockResolvedValueOnce({ status: 'ACTIVE', participantId: '12345678' });
      const objectIdReport = await validator.validateSampleCompliance(objectIdConsent.specimenId);
      expect(objectIdReport.graphPath.ethics.valid).toBe(true);
      expect(consentsCollection.findOne.mock.calls.at(-1)[0].$or[0]._id).toBeTruthy();
    });

    it('uses default disease requirements when ORPHA is absent or the dictionary has no active entry', async () => {
      const noOrpha = buildSample({
        clinicalData: { orphaCode: '', cid: 'E75.2', biomarkerValues: {} },
        pharmacologyData: { treatmentStatus: 'NAIVE' },
      });
      samplesCollection.findOne.mockResolvedValue(noOrpha);
      consentsCollection.findOne.mockResolvedValue({ status: 'ACTIVE', participantId: '12345678' });

      const noOrphaReport = await validator.validateSampleCompliance(noOrpha.specimenId);
      expect(noOrphaReport.disease).toBeNull();
      expect(noOrphaReport.orphaCode).toBe('');
      expect(diseaseDictionaryCollection.findOne).not.toHaveBeenCalled();

      const noDictionaryEntry = buildSample({
        pharmacologyData: { treatmentStatus: 'NAIVE' },
      });
      samplesCollection.findOne.mockResolvedValue(noDictionaryEntry);
      diseaseDictionaryCollection.findOne.mockResolvedValueOnce(null);

      const noDictionaryReport = await validator.validateSampleCompliance(noDictionaryEntry.specimenId);
      expect(noDictionaryReport.disease).toBeNull();
      expect(noDictionaryReport.graphPath.clinical.valid).toBe(true);
      expect(noDictionaryReport.graphPath.pharmacology.valid).toBe(true);
    });

    it('covers clinical requirement fallbacks, invalid treatment status and required pharmacology fields', async () => {
      consentsCollection.findOne.mockResolvedValue({ status: 'ACTIVE', participantId: '12345678' });

      diseaseDictionaryCollection.findOne.mockResolvedValueOnce({
        orpha_code: '324',
        validation_requirements: {
          miabis: { requireTreatmentStatus: true },
          biomarkers: { required: 'not-an-array' },
          pharmacology: { required: 'not-an-array', treatmentStatuses: 'not-an-array' },
        },
      });
      const fallbackArrays = buildSample({
        clinicalData: { biomarkerValues: 'not-an-object' },
        pharmacologyData: { treatmentStatus: 'NAIVE' },
      });
      samplesCollection.findOne.mockResolvedValue(fallbackArrays);
      const fallbackReport = await validator.validateSampleCompliance(fallbackArrays.specimenId);
      expect(fallbackReport.graphPath.clinical.valid).toBe(true);
      expect(fallbackReport.graphPath.clinical.reason).toBe('Dados clínicos e MIABIS essenciais presentes');

      const missingTreatment = buildSample({ pharmacologyData: { treatmentStatus: '' } });
      samplesCollection.findOne.mockResolvedValue(missingTreatment);
      const missingTreatmentReport = await validator.validateSampleCompliance(missingTreatment.specimenId);
      expect(missingTreatmentReport.graphPath.clinical.reason).toContain('treatment_status');
      expect(missingTreatmentReport.graphPath.pharmacology.reason).toContain('treatment_status');

      const invalidStatus = buildSample({ pharmacologyData: { treatmentStatus: 'INVALID' } });
      samplesCollection.findOne.mockResolvedValue(invalidStatus);
      const invalidStatusReport = await validator.validateSampleCompliance(invalidStatus.specimenId);
      expect(invalidStatusReport.graphPath.clinical.reason).toContain('inválido');

      diseaseDictionaryCollection.findOne.mockResolvedValueOnce({
        orpha_code: '324',
        validation_requirements: {
          miabis: { requireTreatmentStatus: false },
          biomarkers: { required: [] },
          pharmacology: { required: ['medicationName'], treatmentStatuses: ['NAIVE'] },
        },
      });
      const missingRequiredField = buildSample({
        pharmacologyData: { treatmentStatus: 'NAIVE', medicationName: '' },
      });
      samplesCollection.findOne.mockResolvedValue(missingRequiredField);
      const requiredFieldReport = await validator.validateSampleCompliance(missingRequiredField.specimenId);
      expect(requiredFieldReport.graphPath.clinical.reason).toContain('campo farmacológico obrigatório');
    });

    it('covers active-treatment ATC branches without inventing new pharmacology rules', async () => {
      consentsCollection.findOne.mockResolvedValue({ status: 'ACTIVE', participantId: '12345678' });

      const missingAtc = buildSample({
        pharmacologyData: { treatmentStatus: 'TREATED', atcCode: '' },
      });
      samplesCollection.findOne.mockResolvedValue(missingAtc);
      const missingAtcReport = await validator.validateSampleCompliance(missingAtc.specimenId);
      expect(missingAtcReport.graphPath.pharmacology.reason).toContain('exige atc_code');

      const unknownMedication = buildSample({
        pharmacologyData: { treatmentStatus: 'TREATED', atcCode: 'A16AX27' },
      });
      samplesCollection.findOne.mockResolvedValue(unknownMedication);
      medicationDictionaryCollection.findOne.mockResolvedValueOnce(null);
      const unknownMedicationReport = await validator.validateSampleCompliance(unknownMedication.specimenId);
      expect(unknownMedicationReport.graphPath.pharmacology.valid).toBe(true);

      diseaseDictionaryCollection.findOne.mockResolvedValueOnce({
        orpha_code: '324',
        drug_classes: 'not-an-array',
        validation_requirements: {
          miabis: { requireTreatmentStatus: true },
          biomarkers: { required: [] },
          pharmacology: { required: ['treatmentStatus'], treatmentStatuses: ['TREATED'] },
        },
      });
      medicationDictionaryCollection.findOne.mockResolvedValueOnce({
        atc_code: 'A16AX27',
        drug_class: '',
        active: true,
      });
      const noDiseaseClasses = buildSample({
        pharmacologyData: { treatmentStatus: 'TREATED', atcCode: 'ATC:A16AX27', atcClass: 'A' },
      });
      samplesCollection.findOne.mockResolvedValue(noDiseaseClasses);
      const noDiseaseClassesReport = await validator.validateSampleCompliance(noDiseaseClasses.specimenId);
      expect(noDiseaseClassesReport.graphPath.pharmacology.valid).toBe(true);
    });

    it('covers missing integrity seal and canonical multi-node quarantine reason codes', async () => {
      const missingRoot = buildSample();
      delete missingRoot.merkleRoot;
      samplesCollection.findOne.mockResolvedValue(missingRoot);
      consentsCollection.findOne.mockResolvedValue({ status: 'ACTIVE', participantId: '12345678' });

      const missingRootReport = await validator.validateSampleCompliance(missingRoot.specimenId);
      expect(missingRootReport.graphPath.integrity.valid).toBe(false);
      expect(missingRootReport.suggestedStatus).toBe('BLOCKED');

      const multiFailure = buildSample({
        consentTemplateId: '',
        clinicalData: { orphaCode: 'ORPHA:324', cid: '' },
        pharmacologyData: { treatmentStatus: '' },
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
      delete multiFailure.merkleRoot;
      samplesCollection.findOne.mockResolvedValue(multiFailure);

      const multiFailureReport = await validator.validateSampleCompliance(multiFailure.specimenId);
      expect(multiFailureReport.isReleasable).toBe(false);
      expect(quarantineActionsCollection.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          reasonCodes: expect.arrayContaining([
            'COMPLIANCE_GRAPH_ETHICS',
            'COMPLIANCE_GRAPH_CLINICAL',
            'COMPLIANCE_GRAPH_PHARMACOLOGY',
            'COMPLIANCE_GRAPH_INTEGRITY',
            'COMPLIANCE_GRAPH_QUALITY',
          ]),
        }),
        undefined
      );
    });

    it('releases a prior compliance-owned action before escalating to a stronger canonical block', async () => {
      const sample = buildSample({
        specimenStatus: 'quarantined',
        clinicalData: { orphaCode: 'ORPHA:324', cid: '' },
      });
      samplesCollection.findOne.mockResolvedValue(sample);
      consentsCollection.findOne.mockResolvedValue({ status: 'ACTIVE', participantId: '12345678' });
      quarantineActionsCollection.find.mockReturnValue({
        sort: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([
            {
              quarantineActionId: 'qa-owned',
              actionStatus: 'active',
              reasonCodes: ['COMPLIANCE_GRAPH_QUALITY'],
            },
          ]),
        }),
      });

      const report = await validator.validateSampleCompliance(sample.specimenId);
      expect(report.suggestedStatus).toBe('BLOCKED');
      expect(quarantineActionsCollection.updateOne).toHaveBeenCalledWith(
        { quarantineActionId: 'qa-owned' },
        expect.objectContaining({ $set: expect.objectContaining({ actionStatus: 'released' }) }),
        undefined
      );
      expect(quarantineActionsCollection.insertOne).toHaveBeenCalled();
    });

    it('preserves an existing stronger status when no active compliance-owned action authorizes downgrade', async () => {
      const sample = buildSample({ specimenStatus: 'unavailable' });
      samplesCollection.findOne.mockResolvedValue(sample);
      consentsCollection.findOne.mockResolvedValue({ status: 'ACTIVE', participantId: '12345678' });
      quarantineActionsCollection.find.mockReturnValue({
        sort: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([
            { quarantineActionId: 'released-old', actionStatus: 'released', reasonCodes: ['COMPLIANCE_GRAPH_QUALITY'] },
          ]),
        }),
      });

      const report = await validator.validateSampleCompliance(sample.specimenId);
      expect(report.suggestedStatus).toBe('AVAILABLE');
      const [, update] = samplesCollection.updateOne.mock.calls[0];
      expect(update.$set.specimenStatus).toBeUndefined();
    });

    it('uses the sample ATC class when the medication dictionary entry has no drug_class', async () => {
      consentsCollection.findOne.mockResolvedValue({ status: 'ACTIVE', participantId: '12345678' });
      diseaseDictionaryCollection.findOne.mockResolvedValueOnce({
        orpha_code: '324',
        drug_classes: ['A'],
        validation_requirements: {
          miabis: { requireTreatmentStatus: true },
          biomarkers: { required: [] },
          pharmacology: { required: ['treatmentStatus'], treatmentStatuses: ['TREATED'] },
        },
      });
      medicationDictionaryCollection.findOne.mockResolvedValueOnce({
        atc_code: 'A16AX27',
        drug_class: '',
        active: true,
      });
      const sample = buildSample({
        pharmacologyData: {
          treatmentStatus: 'TREATED',
          medicationName: 'Migalastat',
          atcCode: 'A16AX27',
          atcClass: 'A',
        },
      });
      samplesCollection.findOne.mockResolvedValue(sample);

      const report = await validator.validateSampleCompliance(sample.specimenId);

      expect(report.graphPath.pharmacology).toEqual({
        valid: true,
        reason: 'Nó farmacológico válido',
      });
      expect(medicationDictionaryCollection.findOne).toHaveBeenCalledWith({
        atc_code: 'A16AX27',
        active: { $ne: false },
      });

    });
  });


  describe('item 8 remaining executable branches', () => {
    it('ignores a biomarker key that normalizes to empty without invalidating otherwise complete clinical data', async () => {
      const sample = buildSample({
        clinicalData: {
          biomarkerValues: {
            '': 'synthetic-value',
            'Lyso-Gb3': '4.2',
            'Atividade de Alfa-galactosidase A': '2.1',
          },
        },
      });
      samplesCollection.findOne.mockResolvedValue(sample);
      consentsCollection.findOne.mockResolvedValue({ status: 'ACTIVE', participantId: '12345678' });

      const report = await validator.validateSampleCompliance(sample.specimenId);

      expect(report.graphPath.clinical.valid).toBe(true);
    });

    it('rejects a stored sample that lacks canonical specimenId', async () => {
      const sample = buildSample({ specimenId: '' });
      samplesCollection.findOne.mockResolvedValue(sample);

      await expect(validator.validateSampleCompliance('SPEC-MISSING-CANONICAL'))
        .rejects.toThrow('Amostra sem specimenId canônico');
      expect(sampleMovementsCollection.insertOne).not.toHaveBeenCalled();
    });

    it('prefers canonical specimenId over Mongo _id when sealing the compliance movement', async () => {
      const sample = buildSample({ specimenId: 'SPEC-CANONICAL-1' });
      samplesCollection.findOne.mockResolvedValue(sample);
      consentsCollection.findOne.mockResolvedValue({ status: 'ACTIVE', participantId: '12345678' });

      const report = await validator.validateSampleCompliance(sample.specimenId);

      expect(report.isReleasable).toBe(true);
      expect(sampleMovementsCollection.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({ specimenId: 'SPEC-CANONICAL-1' }),
        undefined
      );
    });

    it('uses canonical specimenId in the compliance report and rejects stored records without it', async () => {
      const canonical = buildSample({ _id: '', specimenId: 'SPEC-CANONICAL-REPORT' });
      samplesCollection.findOne.mockResolvedValue(canonical);
      consentsCollection.findOne.mockResolvedValue({ status: 'ACTIVE', participantId: '12345678' });

      const byCanonical = await validator.validateSampleCompliance('SPEC-LOOKUP-1');
      expect(byCanonical.specimenId).toBe('SPEC-CANONICAL-REPORT');

      const withoutCanonical = buildSample({
        _id: '',
        specimenId: '',
        clinicalData: { orphaCode: 'ORPHA:324', cid: '' },
      });
      samplesCollection.findOne.mockResolvedValue(withoutCanonical);

      await expect(validator.validateSampleCompliance('SPEC-LOOKUP-2'))
        .rejects.toThrow('Amostra sem specimenId canônico');
    });

    it('treats an unknown non-terminal specimenStatus as available for compliance-order comparison', async () => {
      const sample = buildSample({ specimenStatus: 'legacy_unknown_state' });
      samplesCollection.findOne.mockResolvedValue(sample);
      consentsCollection.findOne.mockResolvedValue({ status: 'ACTIVE', participantId: '12345678' });

      const report = await validator.validateSampleCompliance(sample.specimenId);

      expect(report.suggestedStatus).toBe('AVAILABLE');
      const [, update] = samplesCollection.updateOne.mock.calls[0];
      expect(update.$set.specimenStatus).toBeUndefined();
      expect(quarantineActionsCollection.find).not.toHaveBeenCalled();
    });
  });

});
