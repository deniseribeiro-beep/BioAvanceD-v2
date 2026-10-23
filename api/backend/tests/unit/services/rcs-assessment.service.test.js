import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const logger = require('../../../src/utils/logger');
const RcsAssessmentModel = require('../../../src/models/RcsAssessment');
const {
  recordAssessment,
  getInputSnapshotById,
  getGovernanceEvidenceById,
  getAssessmentsForSpecimen,
  getAssessmentById,
  getCurrentAssessmentsForSpecimens,
  findSpecimenIdsWithCurrentAssessmentMatching,
} = require('../../../src/services/rcs-assessment.service');

/**
 * Real query-matching fake (exact-match filter + sort, plus $in for the
 * batched getCurrentAssessmentsForSpecimens path), not a canned stub —
 * proves getAssessmentsForSpecimen actually scopes by specimenId and orders
 * by recency, per this repo's native-only "real backend" proof bar.
 */
function createFakeCollection() {
  const docs = [];
  const matchesCondition = (value, condition) => {
    if (condition && typeof condition === 'object' && condition.$in) {
      return condition.$in.some((candidate) => String(value) === String(candidate));
    }
    return value === condition;
  };
  const matches = (doc, filter) => Object.keys(filter).every((key) => matchesCondition(doc[key], filter[key]));
  return {
    docs,
    async insertOne(doc) {
      // Mirrors the real MongoDB driver, which mutates the passed document
      // with the generated _id — recordAssessment's callers rely on this to
      // pin a sample to the returned snapshot's _id (#502).
      doc._id = `fake-${docs.length + 1}`;
      docs.push(doc);
      return { insertedId: doc._id };
    },
    async deleteOne(filter = {}) {
      const index = docs.findIndex((doc) => matches(doc, filter));
      if (index >= 0) docs.splice(index, 1);
      return { deletedCount: index >= 0 ? 1 : 0 };
    },
    async findOne(filter = {}) {
      return docs.find((doc) => matches(doc, filter)) || null;
    },
    find(filter = {}) {
      let current = docs.filter((doc) => matches(doc, filter));
      const cursor = {
        sort(criteria = {}) {
          const [[field, direction = 1]] = Object.entries(criteria);
          current = [...current].sort((a, b) => {
            const left = a?.[field]?.getTime ? a[field].getTime() : a?.[field];
            const right = b?.[field]?.getTime ? b[field].getTime() : b?.[field];
            if (left === right) return 0;
            return direction >= 0 ? (left > right ? 1 : -1) : (left > right ? -1 : 1);
          });
          return cursor;
        },
        async toArray() {
          return current;
        },
      };
      return cursor;
    },
  };
}

function createFakeDb() {
  const collections = {
    rcsAssessments: createFakeCollection(),
    rcsInputSnapshots: createFakeCollection(),
    rcsGovernanceEvidenceSnapshots: createFakeCollection(),
  };
  return {
    collections,
    collection(name) {
      if (!collections[name]) throw new Error(`unexpected collection: ${name}`);
      return collections[name];
    },
  };
}

describe('rcs-assessment.service', () => {
  describe('recordAssessment', () => {
    it('persists a versioned snapshot referenced by specimenId', async () => {
      const db = createFakeDb();

      const stored = await recordAssessment(db, 'SPEC-1', {
        model_version: 'RCS-GOV-1.0',
        matrix_type: 'fluid',
        governance_status: 1,
        rcs_score: 88,
        final_grade: 'B',
        axis_penalties: [],
        calculation_trace: {},
      });

      expect(stored.specimenId).toBe('SPEC-1');
      expect(stored.rcsScore).toBe(88);
      expect(db.collections.rcsAssessments.docs).toHaveLength(1);
      expect(db.collections.rcsAssessments.docs[0].specimenId).toBe('SPEC-1');
    });

    it('does not overwrite a prior snapshot — each call adds a new versioned record', async () => {
      const db = createFakeDb();

      await recordAssessment(db, 'SPEC-1', { rcs_score: 70, final_grade: 'C' });
      await recordAssessment(db, 'SPEC-1', { rcs_score: 95, final_grade: 'A' });

      expect(db.collections.rcsAssessments.docs).toHaveLength(2);
    });
  });

  // RF018 AC3 (#1320): the input the result was computed from is frozen in
  // one RCSInputSnapshot the assessment references by id, URI and hash.
  describe('recordAssessment input snapshot', () => {
    const certified = () => ({
      model_version: 'RCS-GOV-1.0',
      matrix_type: 'fluid',
      governance_status: 1,
      rcs_score: 93.75,
      final_grade: 'A',
      grade_route: 'Score-based certification',
      axis_penalties: [{ axis_code: 'Pstore', sprec_code: 'A', weight: 0.25, severity: 0.25, penalty: 6.25 }],
      calculation_trace: { model_code: 'RCS-GOV-1.0', sprec_version: '2.0', axes: [] },
      rcs_input: { matrix_type: 'fluid', sprec: { sampleType: 'PL1' }, secondCentrifugationRequired: false },
    });

    it('writes exactly one snapshot the assessment references by id, hash and URI, under the same rcsAssessmentId', async () => {
      const db = createFakeDb();
      const assessment = await recordAssessment(db, ' SPEC-1 ', certified());

      const snapshots = db.collections.rcsInputSnapshots.docs;
      expect(snapshots).toHaveLength(1);
      const [snapshot] = snapshots;
      expect(assessment.inputSnapshotId).toBe(snapshot.rcsInputSnapshotId);
      expect(assessment.inputSnapshotHash).toBe(snapshot.snapshotHash);
      expect(assessment.inputSnapshotUri).toBe(snapshot.snapshotUri);
      expect(snapshot.rcsAssessmentId).toBe(assessment.rcsAssessmentId);
      expect(snapshot).toMatchObject({ specimenId: 'SPEC-1', matrix: 'fluid', sprecVersion: '2.0', inputs: certified().rcs_input });
      expect(await getInputSnapshotById(db, assessment.inputSnapshotId)).toBe(snapshot);
    });

    it('keeps the score, grade, route, penalties and trace of the result on the assessment', async () => {
      const db = createFakeDb();
      const result = certified();
      const assessment = await recordAssessment(db, 'SPEC-1', result);
      expect(assessment).toMatchObject({
        rcsScore: result.rcs_score,
        finalGrade: result.final_grade,
        gradeRoute: result.grade_route,
        axisPenalties: result.axis_penalties,
        calculationTrace: result.calculation_trace,
      });
    });

    it('writes no snapshot and null refs for a result without rcs_input', async () => {
      const db = createFakeDb();
      const { rcs_input: _input, ...legacy } = certified();
      const assessment = await recordAssessment(db, 'SPEC-1', legacy);
      expect(db.collections.rcsInputSnapshots.docs).toHaveLength(0);
      expect(assessment).toMatchObject({ inputSnapshotId: null, inputSnapshotUri: null, inputSnapshotHash: null });
      expect(await getInputSnapshotById(db, null)).toBeNull();
    });

    // RF018 AC4 (#1320): the snapshot records the material and the matrix
    // mapping release only when the resolution's matrix is the result's.
    const plasmaCoding = { systemUri: 'urn:bioavanced:sprec-2.0:type-of-sample', code: 'PL1', version: 'SPREC-2.0', display: 'Plasma, single spun' };
    const { matrixMapping } = require('../../../src/services/rcs-reference-data');

    it('writes the PL1 Coding and a null release id for an explicit fluid matrix', async () => {
      const db = createFakeDb();
      await recordAssessment(db, 'SPEC-1', certified());
      expect(db.collections.rcsInputSnapshots.docs[0]).toMatchObject({ materialTypeCode: plasmaCoding, matrixMappingReleaseId: null });
    });

    it('writes the release id for a matrix the mapping release resolves', async () => {
      const db = createFakeDb();
      const rcs_input = { sampleType: 'plasma', sprec: { sampleType: 'PL1' } };
      await recordAssessment(db, 'SPEC-1', { ...certified(), matrix_type: 'fluid', rcs_input });
      expect(db.collections.rcsInputSnapshots.docs[0]).toMatchObject({
        materialTypeCode: plasmaCoding, matrixMappingReleaseId: matrixMapping.sprec_mapping_release_id,
      });
    });

    it('writes neither when the resolution disagrees with the result matrix', async () => {
      const db = createFakeDb();
      const rcs_input = { sampleType: 'plasma', sprec: { sampleType: 'PL1' } };
      await recordAssessment(db, 'SPEC-1', { ...certified(), matrix_type: 'solid', rcs_input });
      expect(db.collections.rcsInputSnapshots.docs[0]).toMatchObject({ materialTypeCode: null, matrixMappingReleaseId: null });
    });

    it('deletes the snapshot and rethrows when the assessment insert fails', async () => {
      const db = createFakeDb();
      db.collections.rcsAssessments.insertOne = async () => { throw new Error('write refused'); };
      await expect(recordAssessment(db, 'SPEC-1', certified())).rejects.toThrow('write refused');
      expect(db.collections.rcsInputSnapshots.docs).toHaveLength(0);
    });

    it('rethrows the insert error, not the compensating delete error, and logs the delete failure', async () => {
      const db = createFakeDb();
      db.collections.rcsAssessments.insertOne = async () => { throw new Error('write refused'); };
      db.collections.rcsInputSnapshots.deleteOne = async () => { throw new Error('delete refused'); };
      const logged = vi.spyOn(logger, 'error').mockImplementation(() => {});
      try {
        await expect(recordAssessment(db, 'SPEC-1', certified())).rejects.toThrow('write refused');
        expect(logged).toHaveBeenCalledWith(expect.any(String), 'delete refused');
      } finally {
        logged.mockRestore();
      }
    });

    it.each([null, undefined])('writes neither a snapshot nor an assessment for a %s specimenId', async (specimenId) => {
      const db = createFakeDb();
      await expect(recordAssessment(db, specimenId, certified())).rejects.toThrow();
      expect(db.collections.rcsInputSnapshots.docs).toHaveLength(0);
      expect(db.collections.rcsAssessments.docs).toHaveLength(0);
    });

    it('writes no snapshot when building the assessment throws', async () => {
      const db = createFakeDb();
      const build = vi.spyOn(RcsAssessmentModel, 'fromCertificationResult').mockImplementation(() => {
        throw new Error('build refused');
      });
      try {
        await expect(recordAssessment(db, 'SPEC-1', certified())).rejects.toThrow('build refused');
        expect(db.collections.rcsInputSnapshots.docs).toHaveLength(0);
      } finally {
        build.mockRestore();
      }
    });
  });

  // RF018 AC7 (#1320): the six governance criteria are kept in one
  // RCSGovernanceEvidenceSnapshot the input snapshot references.
  describe('recordAssessment governance evidence', () => {
    const rcsCertificationService = require('../../../src/services/rcs-certification.service');
    const certified = () => {
      const rcsInput = rcsCertificationService.readInput({
        matrix_type: 'fluid',
        sprec: {
          sampleType: 'PL1', primaryContainer: 'SST', preCentrifugation: 'A', centrifugation: 'A',
          secondCentrifugation: 'N', postCentrifugationDelay: 'A', longTermStorage: 'A',
        },
        secondCentrifugationRequired: false,
        documentationSufficient: false,
      });
      return { ...rcsCertificationService.certify(rcsInput), rcs_input: rcsInput };
    };

    it('writes one evidence row the snapshot references, resolvable by its id', async () => {
      const db = createFakeDb();
      const assessment = await recordAssessment(db, 'SPEC-1', certified());

      const [snapshot] = db.collections.rcsInputSnapshots.docs;
      const evidenceRows = db.collections.rcsGovernanceEvidenceSnapshots.docs;
      expect(evidenceRows).toHaveLength(1);
      const [evidence] = evidenceRows;
      expect(snapshot.rcsInputSnapshotId).toBe(assessment.inputSnapshotId);
      expect(evidence.snapshotId).toBe(snapshot.rcsInputSnapshotId);
      expect(snapshot.governanceEvidenceId).toBe(evidence.governanceEvidenceSnapshotId);
      expect(evidence).toMatchObject({
        metadataComplete: true, terminologyValid: true, documentationOk: false,
        traceabilityOk: null, monitoringOk: null, semanticCompatible: null,
        gateResult: 'fail', failureReasons: ['Insufficient documentation'], evidenceRefs: [],
        validationRuleSetVersion: 'RCS-GOV-1.0',
        validationRuleSetChecksum: rcsCertificationService.governanceRuleSet().checksum,
      });
      expect(evidence.evaluatedAt).toEqual(snapshot.capturedAt);
      expect(await getGovernanceEvidenceById(db, snapshot.governanceEvidenceId)).toBe(evidence);
      expect(await getGovernanceEvidenceById(db, null)).toBeNull();
    });

    it('keeps the score, grade, route, governance status, penalties and trace of the result', async () => {
      const db = createFakeDb();
      const result = certified();
      const assessment = await recordAssessment(db, 'SPEC-1', result);
      expect(assessment).toMatchObject({
        rcsScore: result.rcs_score,
        finalGrade: result.final_grade,
        gradeRoute: result.grade_route,
        governanceStatus: result.governance_status,
        axisPenalties: result.axis_penalties,
        calculationTrace: result.calculation_trace,
      });
    });

    it('writes no evidence for a result without rcs_input', async () => {
      const db = createFakeDb();
      const { rcs_input: _input, ...legacy } = certified();
      await recordAssessment(db, 'SPEC-1', legacy);
      expect(db.collections.rcsGovernanceEvidenceSnapshots.docs).toHaveLength(0);
    });

    it('deletes the snapshot and rethrows when the evidence insert fails', async () => {
      const db = createFakeDb();
      db.collections.rcsGovernanceEvidenceSnapshots.insertOne = async () => { throw new Error('evidence refused'); };
      await expect(recordAssessment(db, 'SPEC-1', certified())).rejects.toThrow('evidence refused');
      expect(db.collections.rcsInputSnapshots.docs).toHaveLength(0);
      expect(db.collections.rcsAssessments.docs).toHaveLength(0);
    });

    it('deletes the evidence and the snapshot and rethrows when the assessment insert fails', async () => {
      const db = createFakeDb();
      db.collections.rcsAssessments.insertOne = async () => { throw new Error('write refused'); };
      await expect(recordAssessment(db, 'SPEC-1', certified())).rejects.toThrow('write refused');
      expect(db.collections.rcsGovernanceEvidenceSnapshots.docs).toHaveLength(0);
      expect(db.collections.rcsInputSnapshots.docs).toHaveLength(0);
    });

    it('rethrows the insert error, not a compensating delete error, and logs each delete failure', async () => {
      const db = createFakeDb();
      db.collections.rcsAssessments.insertOne = async () => { throw new Error('write refused'); };
      db.collections.rcsGovernanceEvidenceSnapshots.deleteOne = async () => { throw new Error('evidence delete refused'); };
      db.collections.rcsInputSnapshots.deleteOne = async () => { throw new Error('delete refused'); };
      const logged = vi.spyOn(logger, 'error').mockImplementation(() => {});
      try {
        await expect(recordAssessment(db, 'SPEC-1', certified())).rejects.toThrow('write refused');
        expect(logged).toHaveBeenCalledWith(expect.any(String), 'evidence delete refused');
        expect(logged).toHaveBeenCalledWith(expect.any(String), 'delete refused');
      } finally {
        logged.mockRestore();
      }
    });
  });

  // RF018 AC6 and AC8 (#1320): the assessment keeps each axis's resolution
  // and the reasons for its route.
  describe('recordAssessment axis results and route reasons', () => {
    const rcsCertificationService = require('../../../src/services/rcs-certification.service');
    const sprec = {
      sampleType: 'PL1', primaryContainer: 'SST', preCentrifugation: 'A', centrifugation: 'A',
      secondCentrifugation: 'A', postCentrifugationDelay: 'A', longTermStorage: 'A',
    };
    const certified = (sprecEdit = {}) => {
      const rcsInput = rcsCertificationService.readInput({ matrix_type: 'fluid', sprec: { ...sprec, ...sprecEdit } });
      return { ...rcsCertificationService.certify(rcsInput), rcs_input: rcsInput };
    };

    it('writes five resolved axes and the score reasons for a scored input', async () => {
      const db = createFakeDb();
      const result = certified();
      expect(result.governance_status).toBe(1);
      const assessment = await recordAssessment(db, 'SPEC-1', result);
      expect(assessment.rcsAxisResults.map((entry) => [entry.axisCode, entry.resolutionStatus, entry.weightedPenalty]))
        .toEqual(result.axis_penalties.map((item) => [item.axis_code.replace(/^P/, 'P_'), 'resolved', item.penalty]));
      expect(assessment.routeReasons).toEqual(['no governance failure found', `score threshold ${result.score_based_grade}`]);
      expect(db.collections.rcsAssessments.docs[0]).toMatchObject({
        rcsAxisResults: assessment.rcsAxisResults, routeReasons: assessment.routeReasons,
      });
    });

    it('writes the failure reasons and the unresolved axis for a governance failure', async () => {
      const db = createFakeDb();
      const result = certified({ preCentrifugation: 'X' });
      expect(result.governance_status).toBe(0);
      const assessment = await recordAssessment(db, 'SPEC-1', result);
      expect(assessment.routeReasons).toEqual(['governance failure', 'Unknown SPREC code']);
      expect(assessment.rcsAxisResults).toHaveLength(5);
      expect(assessment.rcsAxisResults[0]).toMatchObject({
        axisCode: 'P_pre', sprecCode: 'X', resolutionStatus: 'unknown', severity: null, weightedPenalty: null,
      });
    });

    it('writes no axis but still the route reasons for a result without rcs_input', async () => {
      const db = createFakeDb();
      const { rcs_input: _input, ...legacy } = certified();
      const assessment = await recordAssessment(db, 'SPEC-1', legacy);
      expect(assessment.rcsAxisResults).toEqual([]);
      expect(assessment.routeReasons).toEqual(['no governance failure found', `score threshold ${legacy.score_based_grade}`]);
    });

    it('writes no axis when the input matrix disagrees with the result matrix', async () => {
      const db = createFakeDb();
      const assessment = await recordAssessment(db, 'SPEC-1', { ...certified(), matrix_type: 'solid' });
      expect(assessment.rcsAxisResults).toEqual([]);
    });
  });

  describe('getAssessmentsForSpecimen', () => {
    it('scopes results to the requested specimenId only', async () => {
      const db = createFakeDb();
      await recordAssessment(db, 'SPEC-1', { rcs_score: 70 });
      await recordAssessment(db, 'SPEC-2', { rcs_score: 40 });

      const assessments = await getAssessmentsForSpecimen(db, 'SPEC-1');

      expect(assessments).toHaveLength(1);
      expect(assessments[0].specimenId).toBe('SPEC-1');
    });

    it('returns snapshots newest-first', async () => {
      const db = createFakeDb();
      await recordAssessment(db, 'SPEC-1', { rcs_score: 70, calculation_trace: { assessedAt: '2026-01-01' } });
      await new Promise((resolve) => setTimeout(resolve, 2));
      await recordAssessment(db, 'SPEC-1', { rcs_score: 95, calculation_trace: { assessedAt: '2026-06-01' } });

      const assessments = await getAssessmentsForSpecimen(db, 'SPEC-1');

      expect(assessments.map((a) => a.rcsScore)).toEqual([95, 70]);
    });
  });

  describe('getAssessmentById', () => {
    it('resolves the exact snapshot by _id, not the newest one for its specimenId (#502)', async () => {
      const db = createFakeDb();
      const older = await recordAssessment(db, 'SPEC-1', { rcs_score: 70 });
      await recordAssessment(db, 'SPEC-1', { rcs_score: 95 });

      const resolved = await getAssessmentById(db, older._id);

      expect(resolved.rcsScore).toBe(70);
    });

    it('returns null for a null/undefined id instead of querying', async () => {
      const db = createFakeDb();
      expect(await getAssessmentById(db, null)).toBeNull();
    });
  });

  describe('getCurrentAssessmentsForSpecimens', () => {
    it('resolves the newest assessment per specimenId in one batched query (#525)', async () => {
      const db = createFakeDb();
      await recordAssessment(db, 'SPEC-1', { rcs_score: 70, calculation_trace: { assessedAt: '2026-01-01' } });
      await new Promise((resolve) => setTimeout(resolve, 2));
      await recordAssessment(db, 'SPEC-1', { rcs_score: 95, calculation_trace: { assessedAt: '2026-06-01' } });
      await recordAssessment(db, 'SPEC-2', { rcs_score: 40 });

      const result = await getCurrentAssessmentsForSpecimens(db, [
        { specimenId: 'SPEC-1' },
        { specimenId: 'SPEC-2' },
      ]);

      expect(result.get('SPEC-1').rcsScore).toBe(95);
      expect(result.get('SPEC-2').rcsScore).toBe(40);
    });

    it('resolves the sealed-pinned snapshot instead of the newest one when sealedRcsAssessmentId is set (#502 precedent)', async () => {
      const db = createFakeDb();
      const older = await recordAssessment(db, 'SPEC-1', { rcs_score: 70 });
      await recordAssessment(db, 'SPEC-1', { rcs_score: 95 });

      const result = await getCurrentAssessmentsForSpecimens(db, [
        { specimenId: 'SPEC-1', sealedRcsAssessmentId: older._id },
      ]);

      expect(result.get('SPEC-1').rcsScore).toBe(70);
    });

    it('maps a specimen with no recorded assessment to null rather than omitting the key', async () => {
      const db = createFakeDb();

      const result = await getCurrentAssessmentsForSpecimens(db, [{ specimenId: 'SPEC-NONE' }]);

      expect(result.has('SPEC-NONE')).toBe(true);
      expect(result.get('SPEC-NONE')).toBeNull();
    });

    it('returns an empty map without querying when given no samples', async () => {
      const db = createFakeDb();

      const result = await getCurrentAssessmentsForSpecimens(db, []);

      expect(result.size).toBe(0);
    });
  });

  describe('findSpecimenIdsWithCurrentAssessmentMatching', () => {
    it('matches on the newest assessment per specimenId, not a stale earlier one (#525)', async () => {
      const db = createFakeDb();
      await recordAssessment(db, 'SPEC-1', { final_grade: 'C', calculation_trace: { assessedAt: '2026-01-01' } });
      await new Promise((resolve) => setTimeout(resolve, 2));
      await recordAssessment(db, 'SPEC-1', { final_grade: 'A', calculation_trace: { assessedAt: '2026-06-01' } });
      await recordAssessment(db, 'SPEC-2', { final_grade: 'C' });

      const matches = await findSpecimenIdsWithCurrentAssessmentMatching(db, { finalGrade: 'A' });

      expect(matches).toEqual(['SPEC-1']);
    });

    it('returns null instead of scanning the collection when no field conditions are given', async () => {
      const db = createFakeDb();
      await recordAssessment(db, 'SPEC-1', { final_grade: 'A' });

      const matches = await findSpecimenIdsWithCurrentAssessmentMatching(db, {});

      expect(matches).toBeNull();
    });
  });
});
