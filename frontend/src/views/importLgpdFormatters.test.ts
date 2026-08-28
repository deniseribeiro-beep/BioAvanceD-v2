import { describe, expect, it } from 'vitest';
import {
  availableTemplateFormats,
  validateImportFile,
  summarizeImportResult,
  MAX_IMPORT_FILE_BYTES,
} from './importLgpdFormatters';

describe('availableTemplateFormats', () => {
  // #815 (fixed): /pacientes/template/csv now exists, so the asymmetry this
  // used to encode is gone. Both types offer both formats, and every one of
  // the four URLs downloadTemplate can build has a route behind it --
  // import-lgpd.controller.test.js's '#815 route registration' block asserts
  // that from the backend side.
  it('offers both formats for patients', () => {
    expect(availableTemplateFormats('patients')).toEqual(['csv', 'xlsx']);
  });

  it('offers both formats for samples', () => {
    expect(availableTemplateFormats('samples')).toEqual(['csv', 'xlsx']);
  });
});

describe('validateImportFile', () => {
  const file = (name: string, size = 1024) => ({ name, size }) as File;

  it('accepts the extensions the backend accepts', () => {
    for (const name of ['a.csv', 'b.xlsx', 'c.xls', 'D.CSV']) {
      expect(validateImportFile(file(name))).toEqual({ ok: true });
    }
  });

  it('rejects an unsupported extension by name, without uploading it', () => {
    expect(validateImportFile(file('bundle.json'))).toEqual({
      ok: false,
      reason: 'Formato não suportado. Envie um arquivo .csv, .xlsx ou .xls.',
    });
  });

  it('rejects a file over the size limit', () => {
    expect(validateImportFile(file('big.csv', MAX_IMPORT_FILE_BYTES + 1))).toEqual({
      ok: false,
      reason: 'Arquivo muito grande. Tamanho máximo: 100MB.',
    });
  });

  it('rejects an empty file, which imports as zero rows with no error', () => {
    expect(validateImportFile(file('empty.csv', 0))).toEqual({
      ok: false,
      reason: 'Arquivo vazio.',
    });
  });

  it('rejects a missing file rather than throwing', () => {
    expect(validateImportFile(null)).toEqual({ ok: false, reason: 'Selecione um arquivo.' });
  });
});

describe('summarizeImportResult', () => {
  it('reports a clean import with no quarantine link', () => {
    const summary = summarizeImportResult({
      success: true,
      message: 'Importação concluída',
      data: { total: 3, success: 3, errors: 0, errorsDetails: [], stagingBatchId: null },
    });

    expect(summary).toMatchObject({
      outcome: 'clean',
      total: 3,
      imported: 3,
      rejected: 0,
      quarantineHref: null,
      rows: [],
    });
  });

  // The whole point of #794 item 2 + this slice: the operator lands on the
  // rejected rows instead of being handed an id with nowhere to take it.
  it('links a partial import to the quarantine page for its batch', () => {
    const summary = summarizeImportResult({
      success: false,
      data: {
        total: 5,
        success: 3,
        errors: 2,
        errorsDetails: [
          { row: 4, errors: ['participantId inexistente'], participantId: '00000042' },
          { row: 7, errors: ['sex inválido', 'consentTemplateId é obrigatório'] },
        ],
        stagingBatchId: '65f0a1b2c3d4e5f6a7b8c9d0',
      },
    });

    expect(summary.outcome).toBe('partial');
    expect(summary.rejected).toBe(2);
    expect(summary.quarantineHref).toBe('/import/quarantine?batchId=65f0a1b2c3d4e5f6a7b8c9d0');
    expect(summary.rows).toEqual([
      { row: 4, participantId: '00000042', errors: ['participantId inexistente'] },
      { row: 7, participantId: null, errors: ['sex inválido', 'consentTemplateId é obrigatório'] },
    ]);
  });

  it('percent-encodes a batch id rather than interpolating it raw', () => {
    const summary = summarizeImportResult({
      data: { total: 1, success: 0, errors: 1, errorsDetails: [], stagingBatchId: 'a/b c' },
    });
    expect(summary.quarantineHref).toBe('/import/quarantine?batchId=a%2Fb%20c');
  });

  // #814: importPatients/importPatientsSmart never quarantine, so their
  // response carries no stagingBatchId. The UI must say the rows were not
  // retained rather than silently showing the same screen as a samples
  // import that did retain them.
  it('flags rejected rows that were never retained when there is no batch', () => {
    const summary = summarizeImportResult({
      data: {
        total: 2,
        success: 1,
        errors: 1,
        errorsDetails: [{ row: 2, errors: ['email inválido'] }],
        stagingBatchId: null,
      },
    });

    expect(summary.outcome).toBe('partial-unretained');
    expect(summary.quarantineHref).toBeNull();
    expect(summary.rejected).toBe(1);
  });

  it('treats a response with no data envelope as an unusable result, not zeros', () => {
    expect(summarizeImportResult(undefined).outcome).toBe('unknown');
    expect(summarizeImportResult({}).outcome).toBe('unknown');
  });

  // #798 item 3: blank rows the backend guards out with isEmptyRow are
  // counted separately from total/success/errors (#786 keeps that sum
  // exact), so the UI needs its own figure to tell "9 of 9, clean" apart
  // from "9 of 9, but 3 rows never made it into the count at all".
  describe('skipped', () => {
    it('reports a non-zero skipped count from the response', () => {
      const summary = summarizeImportResult({
        data: { total: 9, success: 9, errors: 0, errorsDetails: [], skipped: 3, stagingBatchId: null },
      });
      expect(summary.skipped).toBe(3);
      // Not folded into total -- #786's total === success + errors holds.
      expect(summary.total).toBe(9);
    });

    it('reports zero when the response says zero', () => {
      const summary = summarizeImportResult({
        data: { total: 9, success: 9, errors: 0, errorsDetails: [], skipped: 0, stagingBatchId: null },
      });
      expect(summary.skipped).toBe(0);
    });

    it('defaults to zero for an older backend response with no skipped field', () => {
      const summary = summarizeImportResult({
        data: { total: 9, success: 9, errors: 0, errorsDetails: [], stagingBatchId: null },
      });
      expect(summary.skipped).toBe(0);
    });
  });
});
