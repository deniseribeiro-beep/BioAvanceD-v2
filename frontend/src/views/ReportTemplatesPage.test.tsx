import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ReportTemplatesPage, { parseHandlerOptionsInput, buildReportTemplateSubmissionPayload } from '@/views/ReportTemplatesPage';
import ReportTemplateFormPage from '@/views/ReportTemplateFormPage';
import { REPORT_TEMPLATE_HANDLER_KEYS, type ReportTemplate } from '@/types/models';

// The list and form-page tests below run over the real useReportTemplates
// hook: only the service is mocked, so each page reads what the hook makes of it.
const h = vi.hoisted(() => ({
  getAll: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  navigate: vi.fn(),
}));

// The key itself; a handler-key label's fallback is ignored, so it reads as its key.
vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (k: string) => k, language: 'pt-BR' }),
}));
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => h.navigate };
});
vi.mock('@/services/api', () => ({
  reportTemplateService: { getAll: h.getAll, create: h.create, update: h.update, delete: h.remove },
}));

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

  it('#1450: sends the first handler key, the one the form shows, when the form data has none', () => {
    const payload = buildReportTemplateSubmissionPayload({ name: 'Partial', handlerOptionsText: '{}' }, null);
    expect(payload.handlerKey).toBe(REPORT_TEMPLATE_HANDLER_KEYS[0]);
  });

  it('sends an empty handlerOptions object when no handlerOptionsText is given', () => {
    const payload = buildReportTemplateSubmissionPayload({ code: 'x', name: 'X', handlerKey: 'sample' }, null);
    expect(payload.handlerOptions).toEqual({});
  });
});

const SYSTEM: ReportTemplate = {
  _id: 'sys1',
  code: 'patients',
  name: 'Patients',
  handlerKey: 'patient',
  isSystemDefined: true,
  templateStatus: 'active',
};
const CUSTOM: ReportTemplate = {
  _id: 'cus1',
  code: 'temp_ctrl',
  name: 'Temp Control',
  description: 'Freezer control',
  handlerKey: 'temperature',
  handlerOptions: { mode: 'control' },
  isSystemDefined: false,
  templateStatus: 'retired',
};
// No _id: the page falls back to the code for the row key, edit and delete.
const NO_ID: ReportTemplate = {
  code: 'legacy',
  name: 'Legacy',
  handlerKey: 'sample',
  isSystemDefined: false,
  templateStatus: 'active',
};

// An axios-shaped response, as the hook's extractResponseItems unwraps it.
const ok = (data: unknown) => ({ data, status: 200, headers: {}, config: {} });
const list = (items: ReportTemplate[]) => ok({ success: true, data: items });

const renderList = () =>
  render(
    <MemoryRouter initialEntries={['/reports/templates']}>
      <ReportTemplatesPage />
    </MemoryRouter>
  );

const renderLoaded = async (items: ReportTemplate[] = [SYSTEM, CUSTOM, NO_ID]) => {
  h.getAll.mockResolvedValue(list(items));
  renderList();
  await waitFor(() => expect(screen.queryByText('common.loading')).not.toBeInTheDocument());
};

const rowOf = (code: string) => screen.getByText(code).closest('tr') as HTMLElement;

// The form page reads the template from the link's state, or finds it by id
// in the hook's list when the link carries none.
const renderForm = async (path: string, state?: object, items: ReportTemplate[] = []) => {
  h.getAll.mockResolvedValue(list(items));
  render(
    <MemoryRouter initialEntries={[{ pathname: path, state }]}>
      <Routes>
        <Route path="/reports/templates/new" element={<ReportTemplateFormPage />} />
        <Route path="/reports/templates/:id/edit" element={<ReportTemplateFormPage />} />
      </Routes>
    </MemoryRouter>
  );
  return screen.findByTestId('report-template-form');
};

describe('ReportTemplatesPage', () => {
  let confirmSpy: ReturnType<typeof vi.spyOn>;
  let alertSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    confirmSpy.mockRestore();
    alertSpy.mockRestore();
  });

  describe('the list', () => {
    it('shows loading in the header and the table while the first load is pending', async () => {
      h.getAll.mockReturnValue(new Promise(() => undefined));
      renderList();
      expect(screen.getAllByText('common.loading')).toHaveLength(2);
      expect(screen.queryByText('reportTemplates.empty')).not.toBeInTheDocument();
    });

    it('shows the empty row when the load returns no templates', async () => {
      await renderLoaded([]);
      expect(screen.getByText('reportTemplates.empty')).toBeInTheDocument();
    });

    it('shows the load error beside an empty table', async () => {
      h.getAll.mockRejectedValue(new Error('Network Error'));
      renderList();
      expect(await screen.findByText('common.error: Network Error')).toBeInTheDocument();
      expect(screen.getByText('reportTemplates.empty')).toBeInTheDocument();
    });

    it('renders one row per template with its code, name, handler label, status and origin', async () => {
      await renderLoaded();
      const system = rowOf('patients');
      expect(within(system).getByText('Patients')).toBeInTheDocument();
      expect(within(system).getByText('reportTemplates.handlerKeys.patient')).toBeInTheDocument();
      expect(within(system).getByText('reportTemplates.statusActive')).toBeInTheDocument();
      expect(within(system).getByText('reportTemplates.systemDefined')).toBeInTheDocument();

      const custom = rowOf('temp_ctrl');
      expect(within(custom).getByText('reportTemplates.statusRetired')).toBeInTheDocument();
      expect(within(custom).getByText('reportTemplates.custom')).toBeInTheDocument();
      expect(rowOf('legacy')).toBeInTheDocument();
    });

    it('disables delete on a system-defined template and titles it as blocked', async () => {
      await renderLoaded();
      const button = screen.getByTestId('delete-report-template-button-patients');
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('title', 'reportTemplates.deleteSystemBlocked');
      expect(screen.getByTestId('delete-report-template-button-temp_ctrl')).toHaveAttribute('title', 'common.delete');
    });

    it('opens the new-template form page', async () => {
      await renderLoaded([]);
      fireEvent.click(screen.getByTestId('new-report-template-button'));
      expect(h.navigate).toHaveBeenCalledWith('/reports/templates/new');
    });

    it('opens a template in the edit form page by its id, or its code when it has none', async () => {
      await renderLoaded();
      fireEvent.click(screen.getByTestId('edit-report-template-button-temp_ctrl'));
      expect(h.navigate).toHaveBeenCalledWith('/reports/templates/cus1/edit', { state: { template: CUSTOM } });
      fireEvent.click(screen.getByTestId('edit-report-template-button-legacy'));
      expect(h.navigate).toHaveBeenCalledWith('/reports/templates/legacy/edit', { state: { template: NO_ID } });
    });
  });

  describe('deleting', () => {
    it('deletes a confirmed custom template by its id and reloads', async () => {
      await renderLoaded();
      h.remove.mockResolvedValue(ok({ success: true }));
      fireEvent.click(screen.getByTestId('delete-report-template-button-temp_ctrl'));
      expect(confirmSpy).toHaveBeenCalledWith('reportTemplates.deleteConfirm');
      await waitFor(() => expect(h.getAll).toHaveBeenCalledTimes(2));
      expect(h.remove).toHaveBeenCalledWith('cus1');
    });

    it('deletes a template with no _id by its code', async () => {
      await renderLoaded();
      h.remove.mockResolvedValue(ok({ success: true }));
      fireEvent.click(screen.getByTestId('delete-report-template-button-legacy'));
      await waitFor(() => expect(h.remove).toHaveBeenCalledWith('legacy'));
    });

    it('does nothing when the confirmation is declined', async () => {
      await renderLoaded();
      confirmSpy.mockReturnValue(false);
      fireEvent.click(screen.getByTestId('delete-report-template-button-temp_ctrl'));
      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(h.remove).not.toHaveBeenCalled();
    });

    it('alerts the error when the delete fails', async () => {
      await renderLoaded();
      h.remove.mockRejectedValue(Object.assign(new Error('x'), { response: { data: { error: 'In use by a report' } } }));
      fireEvent.click(screen.getByTestId('delete-report-template-button-temp_ctrl'));
      await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('In use by a report'));
    });
  });

  describe('creating', () => {
    it('opens an empty form, lower-cases the code, posts the payload and returns to the list', async () => {
      h.create.mockResolvedValue(ok({ success: true, data: CUSTOM }));
      const form = await renderForm('/reports/templates/new');
      expect(screen.getByText('reportTemplates.newTitle')).toBeInTheDocument();
      const code = within(form).getByTestId('report-template-code-input');
      expect(code).not.toBeDisabled();
      expect(within(form).getByTestId('report-template-handler-options-input')).toHaveValue('{}');

      fireEvent.change(code, { target: { value: 'New_Report' } });
      expect(code).toHaveValue('new_report');
      fireEvent.change(within(form).getByTestId('report-template-name-input'), { target: { value: 'New Report' } });
      fireEvent.change(within(form).getByTestId('report-template-description-input'), { target: { value: 'About it' } });
      fireEvent.change(within(form).getByTestId('report-template-handler-key-select'), { target: { value: 'sensor' } });
      fireEvent.change(within(form).getByTestId('report-template-handler-options-input'), { target: { value: '{"mode":"report"}' } });
      fireEvent.submit(form);

      await waitFor(() => expect(h.create).toHaveBeenCalledTimes(1));
      expect(h.create).toHaveBeenCalledWith({
        code: 'new_report',
        name: 'New Report',
        description: 'About it',
        handlerKey: 'sensor',
        handlerOptions: { mode: 'report' },
        templateStatus: 'active',
      });
      await waitFor(() => expect(h.navigate).toHaveBeenCalledWith('/reports/templates'));
      expect(h.update).not.toHaveBeenCalled();
    });

    it('defaults the handler key to the first one and an empty description to null', async () => {
      h.create.mockResolvedValue(ok({ success: true, data: NO_ID }));
      const form = await renderForm('/reports/templates/new');
      expect(within(form).getByTestId('report-template-handler-key-select')).toHaveValue('samplesByPatient');
      fireEvent.change(within(form).getByTestId('report-template-code-input'), { target: { value: 'x' } });
      fireEvent.change(within(form).getByTestId('report-template-name-input'), { target: { value: 'X' } });
      fireEvent.submit(form);
      await waitFor(() =>
        expect(h.create).toHaveBeenCalledWith({
          code: 'x',
          name: 'X',
          description: null,
          handlerKey: 'samplesByPatient',
          handlerOptions: {},
          templateStatus: 'active',
        })
      );
    });

    it('shows the handlerOptions error, posts nothing, and clears the error on the next keystroke', async () => {
      const form = await renderForm('/reports/templates/new');
      const options = within(form).getByTestId('report-template-handler-options-input');
      fireEvent.change(options, { target: { value: '[1]' } });
      fireEvent.submit(form);
      expect(within(form).getByText('handlerOptions deve ser um objeto JSON (ex.: {})')).toBeInTheDocument();
      expect(h.create).not.toHaveBeenCalled();

      fireEvent.change(options, { target: { value: '{' } });
      expect(within(form).queryByText('handlerOptions deve ser um objeto JSON (ex.: {})')).not.toBeInTheDocument();
    });

    it('alerts the error and stays on the form when the save fails', async () => {
      h.create.mockRejectedValue(Object.assign(new Error('x'), { response: { data: { details: ['code taken'] } } }));
      const form = await renderForm('/reports/templates/new');
      fireEvent.change(within(form).getByTestId('report-template-code-input'), { target: { value: 'dup' } });
      fireEvent.change(within(form).getByTestId('report-template-name-input'), { target: { value: 'Dup' } });
      fireEvent.submit(form);
      await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('code taken'));
      expect(h.navigate).not.toHaveBeenCalled();
      expect(screen.getByTestId('report-template-form')).toBeInTheDocument();
    });

    it('returns to the list without saving on the cancel button', async () => {
      const form = await renderForm('/reports/templates/new');
      fireEvent.click(within(form).getByText('common.cancel'));
      expect(h.navigate).toHaveBeenCalledWith('/reports/templates');
      expect(h.create).not.toHaveBeenCalled();
    });
  });

  describe('editing', () => {
    it('opens the form filled from the template, with the code locked, and puts the payload without code', async () => {
      h.update.mockResolvedValue(ok({ success: true, data: CUSTOM }));
      const form = await renderForm('/reports/templates/cus1/edit', { template: CUSTOM });
      expect(screen.getByText('reportTemplates.editTitle')).toBeInTheDocument();
      expect(within(form).getByTestId('report-template-code-input')).toBeDisabled();
      expect(within(form).getByTestId('report-template-code-input')).toHaveValue('temp_ctrl');
      expect(within(form).getByTestId('report-template-name-input')).toHaveValue('Temp Control');
      expect(within(form).getByTestId('report-template-status-select')).toHaveValue('retired');
      expect(within(form).getByTestId('report-template-handler-options-input')).toHaveValue(
        JSON.stringify({ mode: 'control' }, null, 2)
      );

      fireEvent.change(within(form).getByTestId('report-template-status-select'), { target: { value: 'active' } });
      fireEvent.submit(form);

      await waitFor(() => expect(h.update).toHaveBeenCalledTimes(1));
      expect(h.update).toHaveBeenCalledWith('cus1', {
        name: 'Temp Control',
        description: 'Freezer control',
        handlerKey: 'temperature',
        handlerOptions: { mode: 'control' },
        templateStatus: 'active',
      });
      await waitFor(() => expect(h.navigate).toHaveBeenCalledWith('/reports/templates'));
      expect(h.create).not.toHaveBeenCalled();
    });

    it('finds the template by id in the list when the link carries no state', async () => {
      const form = await renderForm('/reports/templates/cus1/edit', undefined, [SYSTEM, CUSTOM]);
      expect(within(form).getByTestId('report-template-code-input')).toHaveValue('temp_ctrl');
    });

    it('puts a template with no _id under its code', async () => {
      h.update.mockResolvedValue(ok({ success: true, data: NO_ID }));
      const form = await renderForm('/reports/templates/legacy/edit', { template: NO_ID });
      expect(within(form).getByTestId('report-template-handler-options-input')).toHaveValue('{}');
      fireEvent.submit(form);
      await waitFor(() => expect(h.update).toHaveBeenCalledWith('legacy', expect.not.objectContaining({ code: expect.anything() })));
    });

    it('#1450: puts the handler key the form shows for a template the server sent without one', async () => {
      const partial = { _id: 'p1', code: 'partial', name: 'Partial', isSystemDefined: false } as unknown as ReportTemplate;
      h.update.mockResolvedValue(ok({ success: true, data: partial }));
      const form = await renderForm('/reports/templates/p1/edit', { template: partial });
      expect(within(form).getByTestId('report-template-handler-key-select')).toHaveValue(REPORT_TEMPLATE_HANDLER_KEYS[0]);
      fireEvent.submit(form);
      await waitFor(() => expect(h.update).toHaveBeenCalledTimes(1));
      expect(h.update).toHaveBeenCalledWith('p1', {
        name: 'Partial',
        description: null,
        handlerKey: REPORT_TEMPLATE_HANDLER_KEYS[0],
        handlerOptions: {},
        templateStatus: 'active',
      });
    });

    it('holds the first handler key and active status for a template the server sent without them', async () => {
      const partial = { _id: 'p1', code: 'partial', name: 'Partial', isSystemDefined: false } as unknown as ReportTemplate;
      const form = await renderForm('/reports/templates/p1/edit', { template: partial });
      const handlerKey = within(form).getByTestId('report-template-handler-key-select');
      const status = within(form).getByTestId('report-template-status-select');
      expect(handlerKey).toHaveValue(REPORT_TEMPLATE_HANDLER_KEYS[0]);
      expect(status).toHaveValue('active');
      // An uncontrolled select would also show its first option, so move the
      // DOM without a change event and re-render: only the fallback value
      // puts each select back.
      (handlerKey as HTMLSelectElement).value = REPORT_TEMPLATE_HANDLER_KEYS[1];
      (status as HTMLSelectElement).value = 'retired';
      fireEvent.change(within(form).getByTestId('report-template-name-input'), { target: { value: 'Partial 2' } });
      expect(handlerKey).toHaveValue(REPORT_TEMPLATE_HANDLER_KEYS[0]);
      expect(status).toHaveValue('active');
    });
  });
});
