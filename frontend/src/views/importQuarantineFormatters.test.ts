/**
 * #794 item 2 (RNF011 AC#4): display logic for the LGPD import quarantine.
 *
 * Extracted as pure functions rather than tested through a render, per this
 * repo's frontend convention (see sampleListFormatters.test.ts). The logic
 * that actually matters here is defensive: the staged records come straight
 * from whatever the importer wrote, so the shapes vary more than a happy-path
 * render would exercise.
 */
import { describe, it, expect } from 'vitest';
import {
  canResubmit,
  toEditableRow,
  resubmitErrorMessages,
  formatBatchSummary,
  formatRecordErrors,
  describeRowFields,
} from './importQuarantineFormatters';

describe('formatBatchSummary', () => {
  it('summarises a batch as the importer writes it', () => {
    const summary = formatBatchSummary({
      _id: 'b1',
      fileName: 'amostras.csv',
      status: 'QUARANTINED',
      counts: { total: 500, success: 460, errors: 40 },
      createdAt: '2026-08-20T10:00:00.000Z',
      sourceFile: { storedPath: '/x/b1.csv', originalName: 'amostras.csv' },
    });

    expect(summary).toMatchObject({
      id: 'b1',
      fileName: 'amostras.csv',
      total: 500,
      imported: 460,
      rejected: 40,
      sourceFileRetained: true,
    });
  });

  // quarantineRejectedSampleRows writes fileName: null when the caller had no
  // name for the upload, and retention is best-effort (#792) so sourceFile is
  // legitimately absent rather than an error state.
  it('does not invent values when fileName, counts or sourceFile are missing', () => {
    const summary = formatBatchSummary({ _id: 'b2', fileName: null, createdAt: null });

    expect(summary.fileName).toBe('(sem nome)');
    expect(summary.total).toBe(0);
    expect(summary.imported).toBe(0);
    expect(summary.rejected).toBe(0);
    expect(summary.sourceFileRetained).toBe(false);
    expect(summary.createdAtLabel).toBe('--');
  });

  // #1419: the file is in the object store; on S3 it has no local path.
  it('reads a batch retained in the object store with no storedPath as retained', () => {
    const summary = formatBatchSummary({
      _id: 'b5',
      sourceFile: {
        storageUri: `objstore://import-sources/b5/sha256/${'a'.repeat(64)}`,
        storedPath: null,
        originalName: 'amostras.csv',
      },
    });

    expect(summary.sourceFileRetained).toBe(true);
  });

  it('reads a sourceFile with neither storageUri nor storedPath as not retained', () => {
    expect(formatBatchSummary({ _id: 'b6', sourceFile: {} }).sourceFileRetained).toBe(false);
  });

  it('renders an invalid date as -- rather than "Invalid Date"', () => {
    expect(formatBatchSummary({ _id: 'b3', createdAt: 'not-a-date' }).createdAtLabel).toBe('--');
  });

  // #806 (RNF011 AC#4): a header-level throw opens a FAILED batch instead of
  // deleting the source file. It has no rows -- counts are zeroed -- so the
  // status and the error message are the only things distinguishing it from
  // a clean import in the UI.
  it('surfaces the FAILED status and its error message', () => {
    const summary = formatBatchSummary({
      _id: 'b4',
      fileName: 'amostras.csv',
      status: 'FAILED',
      error: 'Campos obrigatórios ausentes: sampleType, sampleOrigin',
      counts: { total: 0, success: 0, errors: 0 },
      sourceFile: { storedPath: '/x/b4.csv', originalName: 'amostras.csv' },
    });

    expect(summary.status).toBe('FAILED');
    expect(summary.errorMessage).toBe('Campos obrigatórios ausentes: sampleType, sampleOrigin');
    expect(summary.sourceFileRetained).toBe(true);
  });

  // A QUARANTINED batch's rejections live on its records, not on the batch
  // document -- `error` must not leak from an unrelated status.
  it('does not surface an error message for a non-FAILED batch', () => {
    const summary = formatBatchSummary({
      _id: 'b5',
      status: 'QUARANTINED',
      error: 'should not appear',
      counts: { total: 10, success: 9, errors: 1 },
    });

    expect(summary.status).toBe('QUARANTINED');
    expect(summary.errorMessage).toBeNull();
  });

  // #915: participant batches (written since #814) now reach this listing for
  // a caller holding both import permissions, so the two kinds share one
  // table and have to be distinguishable in it.
  it('labels a specimen batch and a participant batch differently', () => {
    expect(formatBatchSummary({ _id: 'b1', type: 'LGPD_SAMPLE_CSV' }).kindLabel).toBe('Amostras');
    expect(formatBatchSummary({ _id: 'b2', type: 'LGPD_PATIENT_CSV' }).kindLabel).toBe(
      'Participantes'
    );
  });

  // import_batches is shared with the FHIR and async importers. Neither should
  // reach this listing, but if one does the label says which rather than
  // silently reading as a specimen batch.
  it('shows an unrecognised batch type verbatim instead of guessing', () => {
    expect(formatBatchSummary({ _id: 'b3', type: 'ASYNC_BATCH_IMPORT' }).kindLabel).toBe(
      'ASYNC_BATCH_IMPORT'
    );
  });

  it('falls back to -- when the batch carries no type at all', () => {
    expect(formatBatchSummary({ _id: 'b4' }).kindLabel).toBe('--');
  });
});

describe('formatRecordErrors', () => {
  // Every LGPD rejection pushes plain strings.
  it('passes through the string errors the LGPD importer writes', () => {
    expect(
      formatRecordErrors({ errors: ['ID de paciente inválido: deve ter exatamente 8 dígitos numéricos'] })
    ).toEqual(['ID de paciente inválido: deve ter exatamente 8 dígitos numéricos']);
  });

  // import_batches is shared with the FHIR importer, whose records carry
  // { field, code, message } objects. The type filter should keep those out of
  // this view, but rendering "[object Object]" if one ever arrived is the kind
  // of failure nobody notices until a screenshot.
  it('reads the message out of an object-shaped error', () => {
    expect(formatRecordErrors({ errors: [{ field: 'consent', message: 'TCLE ausente' }] }))
      .toEqual(['consent: TCLE ausente']);
  });

  it('falls back to validationErrors when errors is absent', () => {
    expect(formatRecordErrors({ validationErrors: ['linha vazia'] })).toEqual(['linha vazia']);
  });

  it('returns an empty list, not a crash, for a record with neither', () => {
    expect(formatRecordErrors({})).toEqual([]);
    expect(formatRecordErrors(null)).toEqual([]);
  });
});

describe('describeRowFields', () => {
  it('lists the original spreadsheet columns in their original order', () => {
    const fields = describeRowFields({
      row: { Nome: 'Maria Silva', CPF: '12345678900', Nascimento: '1985-05-20' },
    });

    expect(fields).toEqual([
      { label: 'Nome', value: 'Maria Silva' },
      { label: 'CPF', value: '12345678900' },
      { label: 'Nascimento', value: '1985-05-20' },
    ]);
  });

  it('drops empty columns so a wide sparse file stays readable', () => {
    const fields = describeRowFields({
      row: { Nome: 'Maria', Vazio: '', Nulo: null, Indefinido: undefined },
    });

    expect(fields).toEqual([{ label: 'Nome', value: 'Maria' }]);
  });

  // A header-level failure quarantines nothing, and retention is best-effort,
  // so a record with no `row` at all is a real state, not a bug.
  it('returns an empty list when the row was not retained', () => {
    expect(describeRowFields({ row: null })).toEqual([]);
    expect(describeRowFields({})).toEqual([]);
  });

  it('stringifies a non-scalar cell rather than rendering [object Object]', () => {
    expect(describeRowFields({ row: { Meta: { a: 1 } } })).toEqual([
      { label: 'Meta', value: '{"a":1}' },
    ]);
  });
});

describe('correct-and-resubmit helpers (#1352)', () => {
  const sampleBatch = { _id: 'b1', type: 'LGPD_SAMPLE_CSV' };
  const errorRecord = { _id: 'r1', status: 'ERROR', row: { sampleType: 'NOPE', quantity: 5 } };

  it('offers a resubmit only for a sample batch record in ERROR with a retained row', () => {
    expect(canResubmit(sampleBatch, errorRecord)).toBe(true);
    expect(canResubmit({ ...sampleBatch, type: 'LGPD_PATIENT_CSV' }, errorRecord)).toBe(false);
    expect(canResubmit(sampleBatch, { ...errorRecord, status: 'RESUBMITTED' })).toBe(false);
    expect(canResubmit(sampleBatch, { ...errorRecord, row: null })).toBe(false);
    expect(canResubmit(sampleBatch, { ...errorRecord, row: {} })).toBe(false);
    expect(canResubmit(sampleBatch, { ...errorRecord, _id: undefined })).toBe(false);
    expect(canResubmit(null, errorRecord)).toBe(false);
  });

  it('turns the retained row into text cells in column order, a blank for null and JSON for an object', () => {
    expect(
      toEditableRow({ row: { sampleType: 'NOPE', quantity: 5, note: null, extra: { a: 1 } } })
    ).toEqual({ sampleType: 'NOPE', quantity: '5', note: '', extra: '{"a":1}' });
    expect(Object.keys(toEditableRow({ row: { b: 1, a: 2 } }))).toEqual(['b', 'a']);
    expect(toEditableRow({ row: null })).toEqual({});
  });

  it("reads a 422's row errors, else the message, else a fallback", () => {
    expect(resubmitErrorMessages({ errors: ['sampleType inválido'], error: 'rejeitada' })).toEqual(['sampleType inválido']);
    expect(resubmitErrorMessages({ error: 'Registro de quarentena ja esta em RESUBMITTED' })).toEqual([
      'Registro de quarentena ja esta em RESUBMITTED',
    ]);
    expect(resubmitErrorMessages(undefined)).toEqual(['Não foi possível reenviar a linha.']);
  });
});
