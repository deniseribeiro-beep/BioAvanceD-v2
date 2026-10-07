import { describe, expect, it } from 'vitest';
import { REPORT_TYPE_DEFINITIONS, mergeCustomTemplates } from './report.constants';

// #735 (RF008 AC#6): ReportTemplatesPage creates templates the report menu
// never listed, so a new template could not be used to generate a report.
// Shaped as GET /api/report-templates returns them.
const SYSTEM_TEMPLATE = { code: 'samples', name: 'Amostras', handlerKey: 'sample', isSystemDefined: true, templateStatus: 'active' };
const CUSTOM_TEMPLATE = {
  code: 'inventario_mensal',
  name: 'Inventário mensal',
  description: 'Amostras do mês por caixa.',
  handlerKey: 'sample',
  isSystemDefined: false,
  templateStatus: 'active',
};

describe('#735: mergeCustomTemplates', () => {
  it('adds an active custom template as a menu entry keyed by its code', () => {
    const merged = mergeCustomTemplates(REPORT_TYPE_DEFINITIONS, [SYSTEM_TEMPLATE, CUSTOM_TEMPLATE]);

    expect(merged).toHaveLength(REPORT_TYPE_DEFINITIONS.length + 1);
    expect(merged[merged.length - 1]).toMatchObject({
      key: 'inventario_mensal',
      type: 'inventario_mensal',
      fallbackType: 'Inventário mensal',
      fallbackDescription: 'Amostras do mês por caixa.',
      handlerKey: 'sample',
      isCustomTemplate: true,
    });
  });

  it('gives a template with no description a generic one', () => {
    const merged = mergeCustomTemplates([], [{ ...CUSTOM_TEMPLATE, description: null }]);

    expect(merged[0].fallbackDescription).toBeTruthy();
  });

  it('skips a retired template', () => {
    const merged = mergeCustomTemplates([], [{ ...CUSTOM_TEMPLATE, templateStatus: 'retired' }]);

    expect(merged).toEqual([]);
  });

  it('skips a custom template whose code names an existing definition', () => {
    // `samples_by_patient` is the backend code for the samplesByPatient key.
    const merged = mergeCustomTemplates(REPORT_TYPE_DEFINITIONS, [
      { ...CUSTOM_TEMPLATE, code: 'samples' },
      { ...CUSTOM_TEMPLATE, code: 'samples_by_patient' },
    ]);

    expect(merged).toHaveLength(REPORT_TYPE_DEFINITIONS.length);
  });

  it('CONTROL: system templates add nothing, and the definitions are kept as they are', () => {
    const merged = mergeCustomTemplates(REPORT_TYPE_DEFINITIONS, [SYSTEM_TEMPLATE]);

    expect(merged).toEqual(REPORT_TYPE_DEFINITIONS);
  });

  it('CONTROL: a missing template list keeps the definitions', () => {
    expect(mergeCustomTemplates(REPORT_TYPE_DEFINITIONS, undefined as unknown as [])).toEqual(REPORT_TYPE_DEFINITIONS);
  });
});
