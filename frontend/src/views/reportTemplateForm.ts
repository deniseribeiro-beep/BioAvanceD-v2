import { ReportTemplate, REPORT_TEMPLATE_HANDLER_KEYS } from '../types/models';

// #726 (RF008 AC#6): free-form config per handler (e.g. temperature's
// `{ mode: 'control' | 'report' }` — see report-template-seed.service.js),
// edited as raw JSON text in the form. Exported for ReportTemplatesPage.test.tsx.
export function parseHandlerOptionsInput(text: string): { value: Record<string, unknown>; error?: string } {
  const trimmed = text.trim();
  if (!trimmed) {
    return { value: {} };
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { value: {}, error: 'handlerOptions deve ser um objeto JSON (ex.: {})' };
    }
    return { value: parsed };
  } catch {
    return { value: {}, error: 'handlerOptions deve ser um JSON válido' };
  }
}

// `code` is immutable once a template exists (reportTemplates.routes.js's
// PUT handler forces `code: existing.code` server-side regardless of what's
// sent) -- omitted from the payload on edit so the disabled form field can
// never accidentally resubmit a stale/placeholder value.
export function buildReportTemplateSubmissionPayload(
  formData: Partial<ReportTemplate> & { handlerOptionsText?: string },
  editingTemplate: ReportTemplate | null
): Partial<ReportTemplate> {
  const { value: handlerOptions } = parseHandlerOptionsInput(formData.handlerOptionsText ?? '{}');

  const payload: Partial<ReportTemplate> = {
    name: formData.name,
    description: formData.description || null,
    // #1450: the form's select shows the first key when the template has
    // none, so the payload sends that same key.
    handlerKey: formData.handlerKey || REPORT_TEMPLATE_HANDLER_KEYS[0],
    handlerOptions,
    templateStatus: formData.templateStatus || 'active',
  };

  if (!editingTemplate) {
    payload.code = formData.code;
  }

  return payload;
}
