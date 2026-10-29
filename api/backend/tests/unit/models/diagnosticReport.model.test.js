import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const DiagnosticReportModel = require('../../../src/models/DiagnosticReport');

describe('DiagnosticReportModel', () => {
  describe('fieldsOf', () => {
    it('emits exactly the 7 P1X-0168..0174 fields with their defaults', () => {
      const fields = DiagnosticReportModel.fieldsOf();

      expect(Object.keys(fields).sort()).toEqual(
        ['diagnosticReportId', 'documentUri', 'encounterId', 'issuedDateTime', 'participantId', 'reportStatus', 'resultIds'].sort()
      );
      expect(fields.diagnosticReportId).toEqual(expect.any(String));
      expect(fields.participantId).toBe('');
      expect(fields.encounterId).toBeNull();
      expect(fields.reportStatus).toBeNull();
      expect(fields.issuedDateTime).toBeNull();
      expect(fields.resultIds).toEqual([]);
      expect(fields.documentUri).toBeNull();
    });

    it('keeps only trimmed non-empty resultIds entries, and [] for a non-array', () => {
      expect(DiagnosticReportModel.fieldsOf({ resultIds: [' obs-1 ', '', '  ', null, 'obs-2'] }).resultIds).toEqual(['obs-1', 'obs-2']);
      expect(DiagnosticReportModel.fieldsOf({ resultIds: 'obs-1' }).resultIds).toEqual([]);
    });
  });

  describe('create', () => {
    it('requires participantId', () => {
      expect(() => DiagnosticReportModel.create({ reportStatus: 'final' })).toThrow('participantId é obrigatório para DiagnosticReport');
    });

    it('requires reportStatus', () => {
      expect(() => DiagnosticReportModel.create({ participantId: 'PART-1' })).toThrow('reportStatus é obrigatório para DiagnosticReport');
    });

    it('names both missing fields in one message', () => {
      expect(() => DiagnosticReportModel.create({})).toThrow(
        'participantId é obrigatório para DiagnosticReport, reportStatus é obrigatório para DiagnosticReport'
      );
    });

    it('builds a full report document that keeps every field', () => {
      const doc = DiagnosticReportModel.create({
        diagnosticReportId: 'dr-1',
        participantId: ' PART-1 ',
        encounterId: ' enc-1 ',
        reportStatus: ' final ',
        issuedDateTime: '2026-01-02T03:04:05Z',
        resultIds: ['obs-1', 'obs-2'],
        documentUri: ' https://example.org/report.pdf ',
      });

      expect(doc).toMatchObject({
        diagnosticReportId: 'dr-1',
        participantId: 'PART-1',
        encounterId: 'enc-1',
        reportStatus: 'final',
        resultIds: ['obs-1', 'obs-2'],
        documentUri: 'https://example.org/report.pdf',
      });
      expect(doc.issuedDateTime).toEqual(new Date('2026-01-02T03:04:05Z'));
      expect(doc.createdAt).toBeInstanceOf(Date);
      expect(doc.updatedAt).toBeInstanceOf(Date);
    });
  });
});
