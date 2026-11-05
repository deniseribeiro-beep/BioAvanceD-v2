import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ReportViewPage from './ReportViewPage';

const getById = vi.fn();
const getFilters = vi.fn();
const deleteReport = vi.fn();

vi.mock('../services/api', () => ({
  reportsService: {
    getById: (...args: unknown[]) => getById(...args),
    getFilters: (...args: unknown[]) => getFilters(...args),
    delete: (...args: unknown[]) => deleteReport(...args),
  },
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: null }),
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/reports/:id" element={<ReportViewPage />} />
        <Route path="/reports-no-id" element={<ReportViewPage />} />
        <Route path="/reports" element={<p>reports list</p>} />
      </Routes>
    </MemoryRouter>
  );
}

function renderSavedReport(reportData: Record<string, unknown>, reportType = 'samples', extra: Record<string, unknown> = {}) {
  getById.mockResolvedValue({
    data: { reportID: 7, reportType, generatedAt: '2026-09-25T00:00:00Z', reportData: JSON.stringify(reportData), ...extra },
  });
  return renderAt('/reports/7');
}

// jsdom has no URL.createObjectURL; the download cases stub it and this puts
// the global back.
const urlStatics = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };

afterEach(() => {
  vi.restoreAllMocks();
  Object.assign(URL, urlStatics);
});

// jsdom's Blob has no text(); FileReader reads it.
function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

// #1213: a saved report's rows carry the canonical names the reports route's
// export catalog declares -- participantId, specimenId, registeredAt. The
// page read patientID, sampleID and registrationDate, which no model has, so
// those cells always rendered blank.
describe('ReportViewPage renders the canonical row fields', () => {
  beforeEach(() => {
    getById.mockReset();
  });

  it('#1213: the patients table shows participantId', async () => {
    renderSavedReport({ total: 1, patients: [{ participantId: 'P-REPORT-1', status: 'active' }] });

    expect(await screen.findByText('P-REPORT-1')).toBeInTheDocument();
  });

  it('#1213: the samples table shows specimenId and registeredAt', async () => {
    renderSavedReport({ total: 1, samples: [{ specimenId: 'S-REPORT-1', sampleType: 'blood', registeredAt: '2026-03-04T12:00:00Z' }] });

    expect(await screen.findByText('S-REPORT-1')).toBeInTheDocument();
    const row = screen.getByText('S-REPORT-1').closest('tr');
    expect(row?.textContent).toMatch(/2026/);
  });

  // CONTROL (#695): a column the page already read correctly renders before
  // and after the fix, so a red here is the harness, not the bug.
  it('CONTROL: the samples table shows sampleType', async () => {
    renderSavedReport({ total: 1, samples: [{ specimenId: 'S-REPORT-1', sampleType: 'plasma-control' }] });

    expect(await screen.findByText('plasma-control')).toBeInTheDocument();
  });
});

// #1217: a report generated from a custom template (#735) has no
// REPORT_TYPE_DEFINITIONS entry, so the page titled it with the raw code.
// GET /reports/:type/filters names the template, as ReportQueryPage uses.
describe('#1217: ReportViewPage titles a custom-template report by its name', () => {
  beforeEach(() => {
    getById.mockReset();
    getFilters.mockReset();
    getFilters.mockResolvedValue({ data: { filters: [], handlerKey: 'sample', name: 'Inventário mensal', description: null } });
  });

  it('shows the template name, not the code', async () => {
    renderSavedReport({ total: 0, samples: [] }, 'inventario_mensal');

    expect(await screen.findByRole('heading', { level: 1, name: 'Inventário mensal' })).toBeInTheDocument();
  });

  it('CONTROL: a system report keeps its definition label', async () => {
    renderSavedReport({ total: 0, samples: [] }, 'samples');

    expect(await screen.findByRole('heading', { level: 1, name: 'Amostras' })).toBeInTheDocument();
    expect(getFilters).not.toHaveBeenCalled();
  });

  it('falls back to the code when the filters lookup fails', async () => {
    getFilters.mockRejectedValue(new Error('offline'));
    renderSavedReport({}, 'inventario_mensal');

    expect(await screen.findByRole('heading', { level: 1, name: 'inventario_mensal' })).toBeInTheDocument();
    await waitFor(() => expect(getFilters).toHaveBeenCalledWith('inventario_mensal'));
    expect(screen.getByRole('heading', { level: 1, name: 'inventario_mensal' })).toBeInTheDocument();
  });

  it('falls back to the code when the filters response has no name', async () => {
    getFilters.mockResolvedValue({ data: { filters: [] } });
    renderSavedReport({}, 'inventario_mensal');

    await waitFor(() => expect(getFilters).toHaveBeenCalledWith('inventario_mensal'));
    expect(await screen.findByRole('heading', { level: 1, name: 'inventario_mensal' })).toBeInTheDocument();
  });
});

describe('ReportViewPage load failures', () => {
  beforeEach(() => {
    getById.mockReset();
  });

  it('shows the request error and a way back to the list', async () => {
    getById.mockRejectedValue(new Error('Request failed with status code 404'));
    renderAt('/reports/7');

    expect(await screen.findByRole('heading', { level: 1, name: 'Erro' })).toBeInTheDocument();
    expect(screen.getByText('Request failed with status code 404')).toBeInTheDocument();
    expect(getById).toHaveBeenCalledWith(7);

    await userEvent.click(screen.getByRole('button', { name: /Voltar para Relatórios/ }));
    expect(await screen.findByText('reports list')).toBeInTheDocument();
  });

  it('shows a default message when the error carries none', async () => {
    getById.mockRejectedValue({});
    renderAt('/reports/7');

    expect(await screen.findByText('Erro ao carregar relatório')).toBeInTheDocument();
  });

  it('asks for no report when the route has no id', async () => {
    renderAt('/reports-no-id');

    expect(await screen.findByText('ID do relatório não fornecido')).toBeInTheDocument();
    expect(getById).not.toHaveBeenCalled();
  });

  it('shows the loading title until the report arrives', async () => {
    let resolve: (value: unknown) => void = () => {};
    getById.mockReturnValue(new Promise((r) => { resolve = r; }));
    renderAt('/reports/7');

    expect(screen.getByRole('heading', { level: 1, name: 'Carregando relatório...' })).toBeInTheDocument();
    resolve({ data: { reportID: 7, reportType: 'samples', reportData: '{}' } });
    expect(await screen.findByRole('heading', { level: 1, name: 'Amostras' })).toBeInTheDocument();
  });

  it('logs unparseable report data and still renders the header', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    getById.mockResolvedValue({ data: { reportID: 7, reportType: 'samples', generatedAt: '2026-09-25T00:00:00Z', reportData: '{not json' } });
    renderAt('/reports/7');

    expect(await screen.findByRole('heading', { level: 1, name: 'Amostras' })).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalledWith('Erro ao parsear dados do relatório:', expect.any(SyntaxError));
    expect(screen.queryByText('Total')).not.toBeInTheDocument();
  });

  it('renders an empty body when the report has no data, dating it by createdAt', async () => {
    getById.mockResolvedValue({ data: { reportID: 7, reportType: 'samples', createdAt: '2026-01-02T15:00:00Z' } });
    renderAt('/reports/7');

    expect(await screen.findByRole('heading', { level: 1, name: 'Amostras' })).toBeInTheDocument();
    expect(screen.getByText(/Gerado em:/).textContent).toMatch(/2026/);
    expect(screen.queryByText('Total')).not.toBeInTheDocument();
  });

  it('says the date is unavailable when the report carries none', async () => {
    getById.mockResolvedValue({ data: { reportID: 7, reportType: 'samples', reportData: '{}' } });
    renderAt('/reports/7');

    expect(await screen.findByText(/Gerado em: Não disponível/)).toBeInTheDocument();
  });

  // A stored reportData of the text 'null' parses without throwing, so the
  // report is set while its data is null.
  it('renders the header but no body, and downloads nothing, when the stored data is null', async () => {
    const createObjectURL = vi.fn(() => 'blob:report');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    getById.mockResolvedValue({ data: { reportID: 7, reportType: 'samples', generatedAt: '2026-09-25T00:00:00Z', reportData: 'null' } });
    const { container } = renderAt('/reports/7');

    expect(await screen.findByRole('heading', { level: 1, name: 'Amostras' })).toBeInTheDocument();
    expect(container.querySelector('.report-content')).toBeNull();
    expect(container.querySelector('.stat-card')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /Download JSON/ }));
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });

  // A 200 or 204 with an empty body gives axios data ''.
  it('says the report was not found when the response has no body, with a way back to the list', async () => {
    getById.mockResolvedValue({ data: '' });
    renderAt('/reports/7');

    expect(await screen.findByRole('heading', { level: 1, name: 'Relatório não encontrado' })).toBeInTheDocument();
    expect(screen.getByText('O relatório solicitado não foi encontrado.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Voltar para Relatórios/ }));
    expect(await screen.findByText('reports list')).toBeInTheDocument();
  });
});

describe('ReportViewPage summary cards', () => {
  beforeEach(() => {
    getById.mockReset();
  });

  function card(label: string) {
    return screen.getByText(label).closest('.stat-card') as HTMLElement;
  }

  it('shows the total and every statistic, the average to two decimals', async () => {
    renderSavedReport({ total: 12, statistics: { average: 4.5, min: -80, max: 8, alerts: 3 } }, 'temperature');

    expect(await screen.findByText('Total')).toBeInTheDocument();
    expect(within(card('Total')).getByText('12')).toBeInTheDocument();
    expect(within(card('Média')).getByText('4.50')).toBeInTheDocument();
    expect(within(card('Mínimo')).getByText('-80')).toBeInTheDocument();
    expect(within(card('Máximo')).getByText('8')).toBeInTheDocument();
    expect(within(card('Alertas')).getByText('3')).toBeInTheDocument();
  });

  it('shows only the statistics the report carries', async () => {
    renderSavedReport({ statistics: { min: 2 } }, 'temperature');

    expect(await screen.findByText('Mínimo')).toBeInTheDocument();
    for (const absent of ['Total', 'Média', 'Máximo', 'Alertas']) {
      expect(screen.queryByText(absent)).not.toBeInTheDocument();
    }
  });
});

describe('ReportViewPage distributions', () => {
  beforeEach(() => {
    getById.mockReset();
  });

  it.each([
    ['byUnit', 'Por Unidade Clínica', 'UTI'],
    ['byType', 'Por Tipo', 'Sangue'],
    ['byStatus', 'Por Status', 'available'],
    ['byAction', 'Por Ação', 'LOGIN'],
    ['bySeverity', 'Por Severidade', 'critical'],
  ])('%s renders a %s card with each entry and its count', async (key, title, label) => {
    renderSavedReport({ [key]: { [label]: 4, other: 9 } }, 'samples');

    const heading = await screen.findByRole('heading', { level: 3, name: title });
    const cardEl = heading.closest('.distribution-card') as HTMLElement;
    const item = within(cardEl).getByText(label).closest('.distribution-item') as HTMLElement;
    expect(within(item).getByText('4')).toBeInTheDocument();
    expect(within(cardEl).getByText('other')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(1);
  });
});

describe('ReportViewPage detail tables', () => {
  beforeEach(() => {
    getById.mockReset();
  });

  function rowOf(text: string) {
    return screen.getByText(text).closest('tr') as HTMLElement;
  }

  it('caps the patients table at 50 rows, names the rest, and never shows a name', async () => {
    const patients = Array.from({ length: 52 }, (_, i) => ({ participantId: `P-${i}`, fullName: `Nome ${i}` }));
    renderSavedReport({ patients }, 'patients');

    expect(await screen.findByRole('heading', { level: 3, name: 'Pacientes (52)' })).toBeInTheDocument();
    expect(screen.getByText('P-49')).toBeInTheDocument();
    expect(screen.queryByText('P-50')).not.toBeInTheDocument();
    expect(screen.getByText('... e mais 2 pacientes')).toBeInTheDocument();
    expect(within(rowOf('P-0')).getByText('Anônimo')).toBeInTheDocument();
    expect(screen.queryByText('Nome 0')).not.toBeInTheDocument();
  });

  it('shows no "more" line when the patients fit', async () => {
    renderSavedReport({ patients: [{ participantId: 'P-ONLY' }] }, 'patients');

    expect(await screen.findByText('P-ONLY')).toBeInTheDocument();
    expect(screen.queryByText(/e mais/)).not.toBeInTheDocument();
  });

  it('caps the samples table at 50 rows and translates each status', async () => {
    const samples = Array.from({ length: 51 }, (_, i) => ({ specimenId: `S-${i}`, sampleType: 'blood', specimenStatus: i === 0 ? 'reserved' : undefined }));
    renderSavedReport({ samples }, 'samples');

    expect(await screen.findByRole('heading', { level: 3, name: 'Amostras (51)' })).toBeInTheDocument();
    expect(screen.queryByText('S-50')).not.toBeInTheDocument();
    expect(screen.getByText('... e mais 1 amostras')).toBeInTheDocument();
    expect(within(rowOf('S-0')).getByText('Reservada')).toBeInTheDocument();
    expect(within(rowOf('S-1')).getByText('Disponível')).toBeInTheDocument();
    expect(within(rowOf('S-1')).getByText('Não disponível')).toBeInTheDocument();
  });

  it('lists every equipment row with its description', async () => {
    renderSavedReport({ equipment: [{ equipmentID: 'EQ-1', equipmentDescription: 'Freezer -80' }] }, 'equipment');

    expect(await screen.findByRole('heading', { level: 3, name: 'Equipamentos (1)' })).toBeInTheDocument();
    expect(within(rowOf('EQ-1')).getByText('Freezer -80')).toBeInTheDocument();
  });

  it('caps the results table at 50 rows and marks a missing method N/A', async () => {
    const results = Array.from({ length: 53 }, (_, i) => ({ resultID: `R-${i}`, fileType: 'pdf', description: `d${i}`, method: i === 0 ? 'PCR' : undefined }));
    renderSavedReport({ results }, 'results');

    expect(await screen.findByRole('heading', { level: 3, name: 'Resultados (53)' })).toBeInTheDocument();
    expect(screen.queryByText('R-50')).not.toBeInTheDocument();
    expect(screen.getByText('... e mais 3 resultados')).toBeInTheDocument();
    expect(within(rowOf('R-0')).getByText('PCR')).toBeInTheDocument();
    expect(within(rowOf('R-1')).getByText('N/A')).toBeInTheDocument();
  });

  it('reads a sensor id from sensorId, sensorID or _id, and labels its maintenance status', async () => {
    renderSavedReport({
      sensors: [
        { sensorId: 'SEN-A', sensorType: 'temp', maintenanceStatus: 'maintenance', lastCalibration: '2026-02-01T10:00:00Z' },
        { sensorID: 'SEN-B', sensorType: 'temp' },
        { _id: 'SEN-C', sensorType: 'temp', maintenanceStatus: 'custom-state' },
        { sensorType: 'orphan' },
      ],
    }, 'sensors');

    expect(await screen.findByRole('heading', { level: 3, name: 'Sensores (4)' })).toBeInTheDocument();
    expect(within(rowOf('SEN-A')).getByText('Em Manutenção')).toBeInTheDocument();
    expect(within(rowOf('SEN-B')).getByText('Operacional')).toBeInTheDocument();
    expect(within(rowOf('SEN-B')).getByText('Não disponível')).toBeInTheDocument();
    expect(within(rowOf('SEN-C')).getByText('custom-state')).toBeInTheDocument();
    expect(within(rowOf('orphan')).getByText('N/A')).toBeInTheDocument();
  });

  it('lists temperature readings with value, unit and sensor', async () => {
    renderSavedReport({
      temperatures: [
        { logId: 1, timestamp: '2026-02-01T10:00:00Z', temperatureValue: -79.5, temperatureUnit: '°C', readingStatus: 'normal', sensorId: 'SEN-T1' },
        { _id: 'x2', temperatureValue: 4, temperatureUnit: '°C', readingStatus: 'alert', sensorID: 'SEN-T2' },
        { temperatureValue: 5, temperatureUnit: '°C', readingStatus: 'stale' },
      ],
    }, 'temperature');

    expect(await screen.findByRole('heading', { level: 3, name: 'Leituras Recentes de Temperatura (3)' })).toBeInTheDocument();
    expect(within(rowOf('SEN-T1')).getByText('-79.5 °C')).toBeInTheDocument();
    expect(within(rowOf('SEN-T2')).getByText('alert')).toBeInTheDocument();
    expect(within(rowOf('stale')).getByText('N/A')).toBeInTheDocument();
  });

  it('lists access logs with user, action, entity, result and severity', async () => {
    renderSavedReport({
      logs: [{ logId: 'L1', timestamp: '2026-02-01T10:00:00Z', userName: 'ana', action: 'LOGIN', entity: 'user', result: 'success', severity: 'info' }],
    }, 'accessLogs');

    expect(await screen.findByRole('heading', { level: 3, name: 'Logs Recentes (1)' })).toBeInTheDocument();
    const row = rowOf('ana');
    for (const cell of ['LOGIN', 'user', 'success', 'info']) {
      expect(within(row).getByText(cell)).toBeInTheDocument();
    }
  });

  it('lists audit events with actor, resource, origin and event id', async () => {
    renderSavedReport({
      auditEvents: [
        { eventId: 'EV-1', occurredAt: '2026-02-01T10:00:00Z', actorPseudonym: 'actor-x', action: 'UPDATE', entityType: 'sample', result: 'success', source: 'api' },
        { actorPseudonym: 'actor-y', action: 'READ' },
      ],
    }, 'audit');

    expect(await screen.findByRole('heading', { level: 3, name: 'Eventos de Auditoria (2)' })).toBeInTheDocument();
    const row = rowOf('actor-x');
    for (const cell of ['UPDATE', 'sample', 'success', 'api', 'EV-1']) {
      expect(within(row).getByText(cell)).toBeInTheDocument();
    }
    expect(within(rowOf('actor-y')).getByText('READ')).toBeInTheDocument();
  });

  it('renders no detail card for empty lists', async () => {
    renderSavedReport({ patients: [], samples: [], equipment: [], results: [], sensors: [], temperatures: [], logs: [], auditEvents: [] }, 'samples');

    expect(await screen.findByRole('heading', { level: 1, name: 'Amostras' })).toBeInTheDocument();
    expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

describe('ReportViewPage actions', () => {
  beforeEach(() => {
    getById.mockReset();
    deleteReport.mockReset();
  });

  it('Voltar returns to the reports list', async () => {
    renderSavedReport({}, 'samples');

    await userEvent.click(await screen.findByRole('button', { name: /^Voltar$/ }));
    expect(await screen.findByText('reports list')).toBeInTheDocument();
  });

  it('Imprimir opens the print dialog', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    renderSavedReport({}, 'samples');

    await userEvent.click(await screen.findByRole('button', { name: /Imprimir/ }));
    expect(print).toHaveBeenCalledTimes(1);
  });

  it('Download JSON saves the parsed data under a file named for the report type', async () => {
    const created: Blob[] = [];
    const createObjectURL = vi.fn((blob: Blob) => { created.push(blob); return 'blob:report'; });
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this); });
    renderSavedReport({ total: 2 }, 'Relatório Mensal X');

    await userEvent.click(await screen.findByRole('button', { name: /Download JSON/ }));

    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toMatch(/^Relatório_Mensal_X_\d+\.json$/);
    expect(clicked[0].href).toBe('blob:report');
    expect(JSON.parse(await readBlob(created[0]))).toEqual({ total: 2 });
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:report');
  });

  it('Download JSON names the file relatorio when the report has no type', async () => {
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:report'), revokeObjectURL: vi.fn() });
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this); });
    renderSavedReport({}, '');

    await userEvent.click(await screen.findByRole('button', { name: /Download JSON/ }));
    expect(clicked[0].download).toMatch(/^relatorio_\d+\.json$/);
  });

  it('Excluir deletes nothing when the confirmation is declined', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderSavedReport({}, 'samples');

    await userEvent.click(await screen.findByRole('button', { name: /Excluir/ }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('"samples"'));
    expect(deleteReport).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 1, name: 'Amostras' })).toBeInTheDocument();
  });

  it('Excluir deletes the report and returns to the list once confirmed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    deleteReport.mockResolvedValue({});
    renderSavedReport({}, 'samples');

    await userEvent.click(await screen.findByRole('button', { name: /Excluir/ }));
    expect(deleteReport).toHaveBeenCalledWith(7);
    expect(await screen.findByText('reports list')).toBeInTheDocument();
  });

  it('Excluir alerts the failure and stays on the report', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    deleteReport.mockRejectedValue(new Error('forbidden'));
    renderSavedReport({}, 'samples');

    await userEvent.click(await screen.findByRole('button', { name: /Excluir/ }));
    await waitFor(() => expect(alert).toHaveBeenCalledWith('Erro ao excluir relatório: forbidden'));
    expect(screen.queryByText('reports list')).not.toBeInTheDocument();
  });
});
