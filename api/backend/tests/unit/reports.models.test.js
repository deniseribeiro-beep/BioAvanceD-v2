import { describe, it, expect } from 'vitest';

const ReportsModel = require('../../src/models/Reports');

describe('ReportsModel', () => {
  it('valida relatório com tipo obrigatório', () => {
    const result = ReportsModel.validate({ reportType: 'patients' });

    expect(result).toEqual({ isValid: true, errors: [] });
  });

  it('rejeita relatório sem tipo string', () => {
    const result = ReportsModel.validate({ reportType: 123 });

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('reportType é obrigatório e deve ser string');
  });

  it('cria relatório com defaults esperados', () => {
    const created = ReportsModel.create({
      reportID: 7,
      reportType: 'samples',
      filters: { status: 'active' },
    });

    expect(created.reportID).toBe(7);
    expect(created.reportType).toBe('samples');
    expect(created.filters).toEqual({ status: 'active' });
    expect(created.status).toBe('pending');
    expect(created.generatedAt).toBeInstanceOf(Date);
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created.updatedAt).toBeInstanceOf(Date);
  });

  // #637: no organizationIds provided defaults to [] (unstamped/legacy),
  // hidden from organization-scoped views per F3-G09 -- same precedent
  // Sensor/Equipment/Temperature's own organizationId:null default set.
  it('padroniza organizationIds para array vazio quando não informado', () => {
    const created = ReportsModel.create({ reportType: 'samples' });

    expect(created.organizationIds).toEqual([]);
  });

  it('mantém organizationIds informado', () => {
    const created = ReportsModel.create({ reportType: 'samples', organizationIds: ['org-1', 'org-2'] });

    expect(created.organizationIds).toEqual(['org-1', 'org-2']);
  });

  it('valida tipos de relatório suportados', () => {
    expect(ReportsModel.validateReportType('patients')).toBe(true);
    expect(ReportsModel.validateReportType('audit')).toBe(true);
    expect(ReportsModel.validateReportType('unknown')).toBe(false);
  });
});
