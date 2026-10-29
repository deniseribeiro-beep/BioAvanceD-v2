import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  createDiagnosticReport,
  getDiagnosticReportsForParticipant,
  getDiagnosticReportById,
  diagnosticReportReferenceChecks,
} = require('../../../src/services/diagnostic-report.service');
const { createFakeDb } = require('../ingestion/testHelpers');

describe('diagnostic-report.service', () => {
  describe('createDiagnosticReport', () => {
    it('persists a report with no resultIds', async () => {
      const db = createFakeDb({});

      const stored = await createDiagnosticReport(db, { participantId: 'PART-1', reportStatus: 'final' });

      expect(stored.resultIds).toEqual([]);
      expect(db.collections.diagnosticReports.docs).toHaveLength(1);
    });

    it('persists a report whose resultIds resolve to real clinical observations', async () => {
      const db = createFakeDb({ clinicalObservations: [{ observationId: 'obs-1' }, { observationId: 'obs-2' }] });

      const stored = await createDiagnosticReport(db, {
        participantId: 'PART-1',
        reportStatus: 'final',
        resultIds: ['obs-1', 'obs-2'],
      });

      expect(stored.resultIds).toEqual(['obs-1', 'obs-2']);
      expect(db.collections.diagnosticReports.docs).toHaveLength(1);
    });

    it('rejects (#695) a resultId that does not resolve, without persisting anything', async () => {
      const db = createFakeDb({ clinicalObservations: [] });

      await expect(
        createDiagnosticReport(db, { participantId: 'PART-1', reportStatus: 'final', resultIds: ['obs-unknown'] })
      ).rejects.toThrow(/Referência inexistente.*resultIds\[0\]/);
      expect(db.collections.diagnosticReports?.docs || []).toHaveLength(0);
    });

    it('propagates model validation failures before ever checking references', async () => {
      const db = createFakeDb({});

      await expect(createDiagnosticReport(db, {})).rejects.toThrow('participantId é obrigatório para DiagnosticReport');
    });

    it('gives a model refusal statusCode 422 and one details entry per missing field (#695, RNF018)', async () => {
      const db = createFakeDb({});

      await expect(createDiagnosticReport(db, {})).rejects.toMatchObject({
        statusCode: 422,
        details: ['participantId é obrigatório para DiagnosticReport', 'reportStatus é obrigatório para DiagnosticReport'],
      });
    });

    it('gives a resultIds reference violation statusCode 422 and the violation messages as details (#695, RNF018)', async () => {
      const db = createFakeDb({ clinicalObservations: [] });

      await expect(
        createDiagnosticReport(db, { participantId: 'PART-1', reportStatus: 'final', resultIds: ['obs-unknown'] })
      ).rejects.toMatchObject({
        statusCode: 422,
        details: ['Referência inexistente: resultIds[0]="obs-unknown" não encontrado em clinicalObservations'],
      });
    });
  });

  describe('getDiagnosticReportsForParticipant', () => {
    it('scopes results to the requested participantId only', async () => {
      const db = createFakeDb({});
      await createDiagnosticReport(db, { participantId: 'PART-1', reportStatus: 'final' });
      await createDiagnosticReport(db, { participantId: 'PART-2', reportStatus: 'final' });

      const reports = await getDiagnosticReportsForParticipant(db, 'PART-1');

      expect(reports).toHaveLength(1);
      expect(reports[0].participantId).toBe('PART-1');
    });
  });

  describe('getDiagnosticReportById', () => {
    it('resolves by diagnosticReportId, not Mongo _id', async () => {
      const db = createFakeDb({});
      await createDiagnosticReport(db, { diagnosticReportId: 'dr-fixed', participantId: 'PART-1', reportStatus: 'final' });

      const resolved = await getDiagnosticReportById(db, 'dr-fixed');

      expect(resolved.diagnosticReportId).toBe('dr-fixed');
    });

    it('returns null for a null/undefined id instead of querying', async () => {
      const db = createFakeDb({});
      expect(await getDiagnosticReportById(db, null)).toBeNull();
    });
  });

  describe('diagnosticReportReferenceChecks', () => {
    const entry = (value, label) => ({ collection: 'diagnosticReports', field: 'diagnosticReportId', value, label });

    it('reads the id after a DiagnosticReport/ prefix, labelling an array entry by index', () => {
      expect(diagnosticReportReferenceChecks(['DiagnosticReport/ dr-1 '], 'evidence', { typedOnly: true })).toEqual({
        references: [entry('dr-1', 'evidence[0]')],
        malformed: [],
      });
    });

    it('skips an untyped value when typedOnly is on', () => {
      expect(diagnosticReportReferenceChecks(['Practitioner/p-1', 'dr-1'], 'evidence', { typedOnly: true })).toEqual({
        references: [],
        malformed: [],
      });
    });

    it('uses an untyped value whole as the id when typedOnly is off, labelling a single value by its label', () => {
      expect(diagnosticReportReferenceChecks('dr-1', 'diagnosticReportId', { typedOnly: false })).toEqual({
        references: [entry('dr-1', 'diagnosticReportId')],
        malformed: [],
      });
    });

    it('reports DiagnosticReport/ with no id as malformed', () => {
      expect(diagnosticReportReferenceChecks(['DiagnosticReport/'], 'evidence', { typedOnly: true })).toEqual({
        references: [],
        malformed: ['Referência malformada: evidence[0]="DiagnosticReport/"'],
      });
    });

    it('reports a whitespace-only value as malformed when typedOnly is off', () => {
      expect(diagnosticReportReferenceChecks('  ', 'diagnosticReportId', { typedOnly: false })).toEqual({
        references: [],
        malformed: ['Referência malformada: diagnosticReportId="  "'],
      });
    });
  });
});
