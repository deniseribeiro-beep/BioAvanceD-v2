import { describe, expect, it } from 'vitest';
import { parseHandlerOptionsInput, buildReportTemplateSubmissionPayload } from './ReportTemplatesPage';
import type { ReportTemplate } from '../types/models';

describe('parseHandlerOptionsInput', () => {
  it('#726: parses a valid JSON object', () => {
    const { value, error } = parseHandlerOptionsInput('{"mode": "control"}');
    expect(value).toEqual({ mode: 'control' });
    expect(error).toBeUndefined();
  });

  it('treats blank input as an empty object, not an error', () => {
    const { value, error } = parseHandlerOptionsInput('   ');
    expect(value).toEqual({});
    expect(error).toBeUndefined();
  });

  it('rejects malformed JSON', () => {
    const { error } = parseHandlerOptionsInput('{mode: control}');
    expect(error).toBe('handlerOptions deve ser um JSON válido');
  });

  it('rejects a JSON array (must be an object)', () => {
    const { error } = parseHandlerOptionsInput('["control"]');
    expect(error).toBe('handlerOptions deve ser um objeto JSON (ex.: {})');
  });

  it('rejects a JSON primitive (must be an object)', () => {
    const { error } = parseHandlerOptionsInput('"control"');
    expect(error).toBe('handlerOptions deve ser um objeto JSON (ex.: {})');
  });
});

describe('buildReportTemplateSubmissionPayload', () => {
  it('#726: includes code when creating a new template', () => {
    const payload = buildReportTemplateSubmissionPayload(
      { code: 'custom_report', name: 'Custom Report', handlerKey: 'sample', handlerOptionsText: '{}' },
      null
    );
    expect(payload.code).toBe('custom_report');
  });

  it('omits code when editing -- reportTemplates.routes.js forces code server-side regardless, but the field must never be resubmitted from a disabled input', () => {
    const editing: ReportTemplate = {
      code: 'patients',
      name: 'Patients',
      handlerKey: 'patient',
      isSystemDefined: true,
      templateStatus: 'active',
    };
    const payload = buildReportTemplateSubmissionPayload(
      { name: 'Patients Updated', handlerKey: 'patient', handlerOptionsText: '{}' },
      editing
    );
    expect(payload.code).toBeUndefined();
  });

  it('parses handlerOptionsText into the handlerOptions object', () => {
    const payload = buildReportTemplateSubmissionPayload(
      { code: 'temp_ctrl', name: 'Temp Control', handlerKey: 'temperature', handlerOptionsText: '{"mode":"control"}' },
      null
    );
    expect(payload.handlerOptions).toEqual({ mode: 'control' });
  });

  it('normalizes an empty description to null', () => {
    const payload = buildReportTemplateSubmissionPayload(
      { code: 'x', name: 'X', handlerKey: 'sample', description: '', handlerOptionsText: '{}' },
      null
    );
    expect(payload.description).toBeNull();
  });

  it('defaults templateStatus to active when unset', () => {
    const payload = buildReportTemplateSubmissionPayload(
      { code: 'x', name: 'X', handlerKey: 'sample', handlerOptionsText: '{}' },
      null
    );
    expect(payload.templateStatus).toBe('active');
  });
});
