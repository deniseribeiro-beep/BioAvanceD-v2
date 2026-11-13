import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import FhirImportPage from './FhirImportPage';
import { dataImportService } from '../services/api';
import { convertExcelFileToFhirBundle, downloadFhirExcelTemplate } from '../utils/fhirExcelImport';

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

vi.mock('../services/api', () => ({
  dataImportService: {
    stageFhirBundle: vi.fn(),
    validateFhirBatch: vi.fn(),
    sendFhirBatchConsents: vi.fn(),
    commitFhirBatch: vi.fn(),
  },
}));

vi.mock('../utils/fhirExcelImport', () => ({
  convertExcelFileToFhirBundle: vi.fn(),
  downloadFhirExcelTemplate: vi.fn(),
}));

const svc = dataImportService as unknown as Record<
  'stageFhirBundle' | 'validateFhirBatch' | 'sendFhirBatchConsents' | 'commitFhirBatch',
  ReturnType<typeof vi.fn>
>;
const convertExcel = convertExcelFileToFhirBundle as unknown as ReturnType<typeof vi.fn>;
const downloadTemplate = downloadFhirExcelTemplate as unknown as ReturnType<typeof vi.fn>;

const bundle = {
  resourceType: 'Bundle',
  entry: [
    { resource: { resourceType: 'Patient' } },
    { resource: { resourceType: 'Patient' } },
    { resource: { resourceType: 'Specimen' } },
  ],
};

// One staging row per display status, in getDisplayStatus's branch order.
const records = [
  { _id: 'r1', rowNumber: 1, normalized: { patientName: 'Ana Signed', sampleID: 'S-1', consentSigned: true, patientEmail: 'ana@x.org' } },
  { _id: 'r2', rowNumber: 2, consentStatus: 'EXTERNAL_ATTACHED', normalized: { patientID: 'P-2', patientEmail: 'b@x.org' } },
  { _id: 'r3', rowNumber: 3, availabilityStatus: 'AVAILABLE', normalized: { patientName: 'Caio Released', patientEmail: 'c@x.org' } },
  { _id: 'r4', rowNumber: 4, consentTracking: { sentAt: '2026-01-01' }, normalized: { patientName: 'Dora Sent', patientEmail: 'd@x.org' } },
  { _id: 'r5', rowNumber: 5, normalized: { patientName: 'Eva NoEmail' }, warnings: [{ field: 'patientEmail', message: 'ausente' }] },
  { _id: 'r6', rowNumber: 6, consentStatus: 'PENDING', normalized: { patientName: 'Fabio Pending', patientEmail: 'f@x.org' } },
  { _id: 'r7', rowNumber: 7, quarantineStatus: 'QUARANTINED', normalized: { patientName: 'Gil Quarantined', patientEmail: 'g@x.org' } },
  { _id: 'r8', rowNumber: 8, status: 'ERROR', normalized: { patientName: 'Hugo Error' }, validationErrors: [{ message: 'inválido' }] },
];

function renderPage() {
  return render(
    <MemoryRouter>
      <FhirImportPage />
    </MemoryRouter>,
  );
}

function jsonInput() {
  return screen.getByTestId('fhir-import-json-input') as HTMLInputElement;
}

async function loadBundle(content = JSON.stringify(bundle), name = 'bundle.json', type = 'application/json') {
  fireEvent.change(jsonInput(), { target: { files: [new File([content], name, { type })] } });
}

async function loadAndValidate() {
  svc.stageFhirBundle.mockResolvedValueOnce({
    data: { batch: { _id: 'batch-1', counts: { total: 8, valid: 7, needsReview: 1, errors: 1 } }, records },
  });
  renderPage();
  await loadBundle();
  await waitFor(() => expect(screen.getByText('bundle.json')).toBeInTheDocument());
  await userEvent.click(screen.getByTestId('fhir-import-validate-button'));
  await screen.findByText('Lote validado e pronto para revisão.');
}

let alertSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  alertSpy.mockRestore();
});

describe('FhirImportPage', () => {
  it('renders the empty flow with the actions that need input disabled', () => {
    renderPage();
    expect(screen.getByText('Importação em lote')).toBeInTheDocument();
    expect(screen.getByText('Nenhum JSON FHIR selecionado')).toBeInTheDocument();
    expect(within(screen.getByTestId('fhir-import-patient-count')).getByText('0')).toBeInTheDocument();
    expect(screen.getByText('Valide o lote para visualizar as linhas staging.')).toBeInTheDocument();
    expect(screen.getByText('Os status finais aparecerão após validar, enviar TCLEs e salvar em quarentena.')).toBeInTheDocument();
    expect(screen.getByTestId('fhir-import-validate-button')).toBeDisabled();
    expect(screen.getByTestId('fhir-import-save-quarantine-button')).toBeDisabled();
    expect(screen.getByTestId('fhir-import-convert-excel')).toBeDisabled();
  });

  it('navigates back to the patient list and downloads the Excel template', async () => {
    renderPage();
    await userEvent.click(screen.getByTestId('fhir-import-back-button'));
    expect(navigate).toHaveBeenCalledWith('/patients');
    await userEvent.click(screen.getByTestId('fhir-import-download-template'));
    expect(downloadTemplate).toHaveBeenCalledTimes(1);
  });

  it('rejects a file that is not JSON', async () => {
    renderPage();
    await loadBundle('a,b', 'data.csv', 'text/csv');
    expect(alertSpy).toHaveBeenCalledWith('Selecione um arquivo JSON FHIR válido.');
    expect(screen.getByText('Nenhum JSON FHIR selecionado')).toBeInTheDocument();
  });

  it('ignores a change with no file', () => {
    renderPage();
    fireEvent.change(jsonInput(), { target: { files: [] } });
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('rejects a JSON file whose content does not parse', async () => {
    renderPage();
    await loadBundle('{not json', 'broken.json');
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Arquivo JSON inválido.'));
    expect(screen.getByTestId('fhir-import-validate-button')).toBeDisabled();
  });

  it('counts patients and specimens of a loaded bundle', async () => {
    renderPage();
    await loadBundle();
    await waitFor(() => expect(screen.getByText('bundle.json')).toBeInTheDocument());
    expect(within(screen.getByTestId('fhir-import-patient-count')).getByText('2')).toBeInTheDocument();
    expect(within(screen.getByTestId('fhir-import-specimen-count')).getByText('1')).toBeInTheDocument();
    expect(screen.getByTestId('fhir-import-validate-button')).toBeEnabled();
  });

  it('stages the bundle and shows each row with its display status', async () => {
    await loadAndValidate();
    expect(svc.stageFhirBundle).toHaveBeenCalledWith(bundle);

    const summary = screen.getByTestId('fhir-import-validation-summary');
    expect(summary).toHaveTextContent('Total8');
    expect(summary).toHaveTextContent('Válidos7');

    const staging = screen.getByTestId('fhir-import-staging-table');
    expect(within(staging).queryByText('Hugo Error')).not.toBeInTheDocument();
    const stagingRow = (name: string) => within(staging).getByText(name).closest('tr') as HTMLElement;
    expect(stagingRow('Ana Signed')).toHaveTextContent('SIGNED');
    expect(stagingRow('Ana Signed')).toHaveTextContent('Sem inconsistências');
    expect(within(staging).getByText('P-2').closest('tr')).toHaveTextContent('EXTERNAL_ATTACHED');
    expect(stagingRow('Caio Released')).toHaveTextContent('RELEASED');
    expect(stagingRow('Dora Sent')).toHaveTextContent('TCLE_SENT');
    expect(stagingRow('Eva NoEmail')).toHaveTextContent('NEEDS_REVIEW');
    expect(stagingRow('Eva NoEmail')).toHaveTextContent('patientEmail: ausente');
    expect(stagingRow('Fabio Pending')).toHaveTextContent('PENDING_CONSENT');
    expect(stagingRow('Gil Quarantined')).toHaveTextContent('QUARANTINED');

    const status = screen.getByTestId('fhir-import-status-table');
    const statusRow = (name: string) => within(status).getByText(name).closest('tr') as HTMLElement;
    expect(statusRow('Hugo Error')).toHaveTextContent('NEEDS_REVIEWNOT_REQUIREDQUARANTINEDBLOCKED');
    expect(statusRow('Ana Signed')).toHaveTextContent('SIGNEDSIGNEDRELEASEDAVAILABLE');
    expect(statusRow('Dora Sent')).toHaveTextContent('TCLE_SENTTCLE_SENTQUARANTINEDBLOCKED');
    expect(statusRow('Fabio Pending')).toHaveTextContent('PENDING_CONSENTPENDINGQUARANTINEDBLOCKED');
    expect(statusRow('Gil Quarantined')).toHaveTextContent('QUARANTINEDPENDING_CONSENTQUARANTINEDBLOCKED');
  });

  it('re-validates an already staged batch by its id and counts rows the server did not count', async () => {
    await loadAndValidate();
    const email = 'z@x.org';
    const revalidated = [
      { _id: 'v1', rowNumber: 1, consentStatus: 'signed', normalized: { patientName: 'Iris', patientEmail: email } },
      { _id: 'v2', rowNumber: 2, quarantineStatus: 'RELEASED', normalized: { patientName: 'Joao', patientEmail: email } },
      { _id: 'v3', rowNumber: 3, workflowStatus: 'TCLE_SENT', normalized: { patientName: 'Kai', patientEmail: email } },
      { _id: 'v4', rowNumber: 4, consentStatus: 'NOT_REQUIRED', normalized: { patientName: 'Lia', patientEmail: email } },
      { _id: 'v5', rowNumber: 5, workflowStatus: 'PENDING_CONSENT', normalized: { patientName: 'Max', patientEmail: email } },
      { _id: 'v6', rowNumber: 6, availabilityStatus: 'BLOCKED', normalized: { patientName: 'Nia', patientEmail: email } },
      { _id: 'v7', rowNumber: 7, normalized: { patientName: 'Oto', patientEmail: email } },
    ];
    svc.validateFhirBatch.mockResolvedValueOnce({ data: { data: { batch: { id: 'batch-1', counts: {} }, records: revalidated } } });
    await userEvent.click(screen.getByTestId('fhir-import-validate-button'));
    await waitFor(() => expect(svc.validateFhirBatch).toHaveBeenCalledWith('batch-1'));
    expect(svc.stageFhirBundle).toHaveBeenCalledTimes(1);

    const summary = await screen.findByTestId('fhir-import-validation-summary');
    await waitFor(() => expect(summary).toHaveTextContent('Total7'));
    expect(summary).toHaveTextContent('Válidos7');
    expect(summary).toHaveTextContent('Revisão1');
    expect(summary).toHaveTextContent('Erros0');

    const staging = screen.getByTestId('fhir-import-staging-table');
    const row = (name: string) => within(staging).getByText(name).closest('tr') as HTMLElement;
    expect(row('Iris')).toHaveTextContent('SIGNED');
    expect(row('Joao')).toHaveTextContent('RELEASED');
    expect(row('Kai')).toHaveTextContent('TCLE_SENT');
    expect(row('Lia')).toHaveTextContent('NEEDS_REVIEW');
    expect(row('Max')).toHaveTextContent('PENDING_CONSENT');
    expect(row('Nia')).toHaveTextContent('QUARANTINED');
    expect(row('Oto')).toHaveTextContent('PENDING_CONSENT');
  });

  it('shows the server error when staging fails and the fallback when there is none', async () => {
    svc.stageFhirBundle.mockRejectedValueOnce({ response: { data: { error: 'Bundle sem Patient' } } });
    renderPage();
    await loadBundle();
    await waitFor(() => expect(screen.getByText('bundle.json')).toBeInTheDocument());
    await userEvent.click(screen.getByTestId('fhir-import-validate-button'));
    expect(await screen.findByText('Bundle sem Patient')).toBeInTheDocument();

    svc.stageFhirBundle.mockRejectedValueOnce({});
    await userEvent.click(screen.getByTestId('fhir-import-validate-button'));
    expect(await screen.findByText('A importação em lote exige um FHIR R4 Bundle JSON.')).toBeInTheDocument();
  });

  it('sends consents then commits the batch to quarantine', async () => {
    await loadAndValidate();
    svc.sendFhirBatchConsents.mockResolvedValueOnce({ data: { batch: { _id: 'batch-1' }, records } });
    svc.commitFhirBatch.mockResolvedValueOnce({ data: { batch: { _id: 'batch-1' }, records } });
    await userEvent.click(screen.getByTestId('fhir-import-save-quarantine-button'));
    expect(await screen.findByText('Lote salvo em quarentena e TCLEs enviados quando aplicável.')).toBeInTheDocument();
    expect(svc.sendFhirBatchConsents).toHaveBeenCalledWith('batch-1');
    expect(svc.commitFhirBatch).toHaveBeenCalledWith('batch-1');
    expect(svc.sendFhirBatchConsents.mock.invocationCallOrder[0]).toBeLessThan(svc.commitFhirBatch.mock.invocationCallOrder[0]);
  });

  it('shows the error when sending consents fails and does not commit', async () => {
    await loadAndValidate();
    svc.sendFhirBatchConsents.mockRejectedValueOnce(new Error('SMTP indisponível'));
    await userEvent.click(screen.getByTestId('fhir-import-save-quarantine-button'));
    expect(await screen.findByText('SMTP indisponível')).toBeInTheDocument();
    expect(svc.commitFhirBatch).not.toHaveBeenCalled();
  });

  it('converts an Excel file to a FHIR bundle and offers it for download', async () => {
    const createObjectURL = vi.fn(() => 'blob:fhir');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    convertExcel.mockResolvedValueOnce(bundle);

    renderPage();
    const excel = new File(['x'], 'modelo.xlsx');
    fireEvent.change(screen.getByLabelText('Selecionar arquivo Excel'), { target: { files: [excel] } });
    await userEvent.click(screen.getByTestId('fhir-import-convert-excel'));

    expect(await screen.findByText('Bundle FHIR gerado a partir do Excel.')).toBeInTheDocument();
    expect(convertExcel).toHaveBeenCalledWith(excel);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fhir');
    expect(screen.getByText('importacao-fhir-bundle.json')).toBeInTheDocument();
    expect(within(screen.getByTestId('fhir-import-patient-count')).getByText('2')).toBeInTheDocument();
    clickSpy.mockRestore();
  });

  it('shows the conversion error when the Excel file cannot be converted', async () => {
    convertExcel.mockRejectedValueOnce(new Error('Planilha sem aba Pacientes'));
    renderPage();
    fireEvent.change(screen.getByLabelText('Selecionar arquivo Excel'), { target: { files: [new File(['x'], 'm.xlsx')] } });
    await userEvent.click(screen.getByTestId('fhir-import-convert-excel'));
    expect(await screen.findByText('Planilha sem aba Pacientes')).toBeInTheDocument();
  });

  it('clears the flow back to its empty state', async () => {
    await loadAndValidate();
    await userEvent.click(screen.getByTestId('fhir-import-reset-button'));
    expect(screen.getByText('Nenhum JSON FHIR selecionado')).toBeInTheDocument();
    expect(screen.getByText('Valide o lote para visualizar as linhas staging.')).toBeInTheDocument();
    expect(screen.queryByText('Lote validado e pronto para revisão.')).not.toBeInTheDocument();
  });
});
