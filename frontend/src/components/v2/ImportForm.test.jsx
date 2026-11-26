import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ImportForm from '@/components/v2/ImportForm';
import { stageFhirBundle, uploadBatch } from '@/api/import.service';
import { convertExcelFileToFhirBundle, downloadFhirExcelTemplate } from '@/utils/fhirExcelImport';

// #1337: the /import route's form. The network boundary (import.service), the
// Excel converter and the progress viewer are replaced, so each test drives the
// form's own validation, submit and FHIR staging paths.
vi.mock('@/api/import.service', () => ({
  uploadBatch: vi.fn(),
  stageFhirBundle: vi.fn(),
}));

vi.mock('@/utils/fhirExcelImport', () => ({
  convertExcelFileToFhirBundle: vi.fn(),
  downloadFhirExcelTemplate: vi.fn(),
}));

vi.mock('@/components/v2/BatchProgressViewer', () => ({
  default: ({ jobId, fileName, onReset, className }) => (
    <div data-testid="batch-progress" data-class={className}>
      <span>{`job:${jobId}`}</span>
      <span>{`file:${fileName}`}</span>
      <button type="button" onClick={onReset}>reset</button>
    </div>
  ),
}));

// jsdom's File has no text(); the form reads a picked JSON file through it.
function makeFile(name, content = 'a,b\n1,2', type = 'text/csv') {
  const file = new File([content], name, { type });
  if (typeof file.text !== 'function') {
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(content) });
  }
  return file;
}

function pickBatchFile(file) {
  const input = screen.getByLabelText('Arquivo para importação em lote');
  fireEvent.change(input, { target: { files: file ? [file] : [] } });
  return input;
}

const submitButton = () => screen.getByRole('button', { name: 'Enviar' });

describe('ImportForm batch upload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps Enviar disabled and shows no error before any file is touched', () => {
    render(<ImportForm />);
    expect(submitButton()).toBeDisabled();
    expect(screen.queryByRole('alert')).toBeNull();
    const input = screen.getByLabelText('Arquivo para importação em lote');
    expect(input).toHaveAttribute('accept', '.csv,.txt,.xlsx,.json');
    expect(input).toHaveAttribute('aria-describedby', 'import-batch-file-help');
    expect(input).toHaveAttribute('aria-invalid', 'false');
  });

  it('shows the required-file message after blur with no file', () => {
    render(<ImportForm />);
    fireEvent.blur(screen.getByLabelText('Arquivo para importação em lote'));
    expect(screen.getByRole('alert')).toHaveTextContent('Selecione um arquivo para importação em lote');
  });

  it('rejects an extension outside the allowed list', () => {
    render(<ImportForm />);
    const input = pickBatchFile(makeFile('dados.pdf'));
    expect(screen.getByRole('alert')).toHaveTextContent('Formato inválido. Use CSV, TXT, XLSX ou JSON.');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', 'import-batch-file-error');
    expect(submitButton()).toBeDisabled();
  });

  it('rejects an empty file', () => {
    render(<ImportForm />);
    pickBatchFile(makeFile('vazio.csv', ''));
    expect(screen.getByRole('alert')).toHaveTextContent('O arquivo não pode estar vazio');
  });

  it('rejects a file over the 100 MB limit', () => {
    render(<ImportForm />);
    const big = makeFile('grande.csv');
    Object.defineProperty(big, 'size', { value: 100 * 1024 * 1024 + 1 });
    pickBatchFile(big);
    expect(screen.getByRole('alert')).toHaveTextContent('O arquivo excede o tamanho máximo permitido');
  });

  it('reports the validation message through onError when the form is submitted without a file', () => {
    const onError = vi.fn();
    const { container } = render(<ImportForm onError={onError} />);
    fireEvent.submit(container.querySelector('form'));
    expect(onError).toHaveBeenCalledWith('Selecione um arquivo para importação em lote');
    expect(uploadBatch).not.toHaveBeenCalled();
  });

  it('uploads a valid file, calls onSuccess and hands the jobId to the progress viewer', async () => {
    const onSuccess = vi.fn();
    const file = makeFile('lote.csv');
    uploadBatch.mockResolvedValue({ data: { data: { jobId: ' job-7 ', fileName: 'servidor.csv' } } });
    render(<ImportForm onSuccess={onSuccess} className="extra" />);
    pickBatchFile(file);
    expect(submitButton()).toBeEnabled();
    fireEvent.click(submitButton());
    expect(await screen.findByTestId('batch-progress')).toHaveAttribute('data-class', 'extra');
    expect(uploadBatch).toHaveBeenCalledWith(file);
    expect(onSuccess).toHaveBeenCalledWith({ data: { jobId: ' job-7 ', fileName: 'servidor.csv' } });
    expect(screen.getByText('job:job-7')).toBeInTheDocument();
    expect(screen.getByText('file:servidor.csv')).toBeInTheDocument();
  });

  it('falls back to the picked file name and a flat payload, and resets back to an empty form', async () => {
    uploadBatch.mockResolvedValue({ data: { jobId: 42 } });
    render(<ImportForm />);
    pickBatchFile(makeFile('local.csv'));
    fireEvent.click(submitButton());
    expect(await screen.findByText('file:local.csv')).toBeInTheDocument();
    expect(screen.getByText('job:42')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'reset' }));
    expect(screen.queryByTestId('batch-progress')).toBeNull();
    expect(submitButton()).toBeDisabled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows Enviando... while the upload is in flight', async () => {
    let resolve;
    uploadBatch.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<ImportForm />);
    pickBatchFile(makeFile('lote.csv'));
    fireEvent.click(submitButton());
    expect(await screen.findByRole('button', { name: 'Enviando...' })).toBeDisabled();
    resolve({ data: { jobId: 'j1' } });
    expect(await screen.findByTestId('batch-progress')).toBeInTheDocument();
  });

  it('reports an error when the backend returns no jobId, and keeps the form', async () => {
    const onError = vi.fn();
    const onSuccess = vi.fn();
    uploadBatch.mockResolvedValue({ data: { data: { jobId: '   ' } } });
    render(<ImportForm onError={onError} onSuccess={onSuccess} />);
    pickBatchFile(makeFile('lote.csv'));
    fireEvent.click(submitButton());
    await waitFor(() => expect(onError).toHaveBeenCalledWith('O backend não retornou um jobId para acompanhar a importação'));
    expect(onSuccess).not.toHaveBeenCalled();
    expect(screen.queryByTestId('batch-progress')).toBeNull();
    expect(submitButton()).toBeEnabled();
  });

  it.each([
    ['response message', { response: { data: { message: 'msg do servidor', error: 'err' } } }, 'msg do servidor'],
    ['response error', { response: { data: { error: 'err do servidor' } } }, 'err do servidor'],
    ['error message', new Error('falha de rede'), 'falha de rede'],
    ['required fallback', {}, 'Campo obrigatório'],
  ])('reports a rejected upload through onError using the %s', async (_label, rejection, expected) => {
    const onError = vi.fn();
    uploadBatch.mockRejectedValue(rejection);
    render(<ImportForm onError={onError} />);
    pickBatchFile(makeFile('lote.csv'));
    fireEvent.click(submitButton());
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expected));
  });
});

describe('ImportForm FHIR Excel and JSON staging', () => {
  let createObjectURL;
  let revokeObjectURL;
  let clickSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    createObjectURL = vi.fn(() => 'blob:preview');
    revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    clickSpy.mockRestore();
  });

  const pickExcel = (file) => fireEvent.change(screen.getByTestId('fhir-excel-input'), { target: { files: [file] } });
  const pickJson = (file) => fireEvent.change(screen.getByTestId('fhir-json-input'), { target: { files: [file] } });

  it('downloads the Excel template', () => {
    render(<ImportForm />);
    fireEvent.click(screen.getByTestId('fhir-excel-template-button'));
    expect(downloadFhirExcelTemplate).toHaveBeenCalledTimes(1);
  });

  it('asks for an Excel file before converting', () => {
    render(<ImportForm />);
    fireEvent.click(screen.getByTestId('fhir-excel-convert-button'));
    expect(screen.getByTestId('fhir-excel-error')).toHaveTextContent('Selecione um arquivo Excel preenchido com o modelo antes de converter.');
    expect(convertExcelFileToFhirBundle).not.toHaveBeenCalled();
  });

  it('converts an Excel file, previews and downloads the bundle, then stages the converted bundle', async () => {
    const bundle = { resourceType: 'Bundle', entry: [] };
    convertExcelFileToFhirBundle.mockResolvedValue(bundle);
    stageFhirBundle.mockResolvedValue({ data: { data: { batchId: 'B1', counters: { valid: 3, error: 1, pendingConsent: 2 } } } });
    const onSuccess = vi.fn();
    render(<ImportForm onSuccess={onSuccess} />);
    const excel = makeFile('modelo.xlsx', 'x', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    pickExcel(excel);
    fireEvent.click(screen.getByTestId('fhir-excel-convert-button'));
    expect(await screen.findByTestId('fhir-staging-result')).toHaveTextContent('Excel convertido para JSON FHIR. Revise o preview antes de importar.');
    expect(convertExcelFileToFhirBundle).toHaveBeenCalledWith(excel);
    expect(screen.getByTestId('fhir-json-preview')).toHaveValue(JSON.stringify(bundle, null, 2));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview');
    expect(document.querySelector('a[download="importacao-fhir-bundle.json"]')).toBeNull();

    fireEvent.click(screen.getByTestId('fhir-json-import-button'));
    await waitFor(() => expect(screen.getByTestId('fhir-staging-result')).toHaveTextContent(
      'JSON FHIR enviado para staging (lote B1). Válidos: 3. Erros: 1. Pendentes: 2.',
    ));
    expect(stageFhirBundle).toHaveBeenCalledWith(bundle);
    expect(onSuccess).toHaveBeenCalledWith({ data: { batchId: 'B1', counters: { valid: 3, error: 1, pendingConsent: 2 } } });
  });

  it('shows the converter error and clears the preview when conversion fails', async () => {
    convertExcelFileToFhirBundle.mockRejectedValue(new Error('Colunas obrigatórias ausentes: x'));
    render(<ImportForm />);
    pickExcel(makeFile('ruim.xlsx', 'x'));
    fireEvent.click(screen.getByTestId('fhir-excel-convert-button'));
    expect(await screen.findByTestId('fhir-excel-error')).toHaveTextContent('Colunas obrigatórias ausentes: x');
    expect(screen.queryByTestId('fhir-json-preview')).toBeNull();
  });

  it('falls back to the generic conversion message when the error carries none', async () => {
    convertExcelFileToFhirBundle.mockRejectedValue({});
    render(<ImportForm />);
    pickExcel(makeFile('ruim.xlsx', 'x'));
    fireEvent.click(screen.getByTestId('fhir-excel-convert-button'));
    expect(await screen.findByTestId('fhir-excel-error')).toHaveTextContent('Não foi possível converter o Excel para JSON FHIR.');
  });

  it('refuses to stage when no bundle was converted and no JSON was picked', async () => {
    const onError = vi.fn();
    render(<ImportForm onError={onError} />);
    fireEvent.click(screen.getByTestId('fhir-json-import-button'));
    expect(await screen.findByTestId('fhir-excel-error')).toHaveTextContent('Converta um Excel ou selecione um JSON FHIR antes de importar.');
    expect(onError).toHaveBeenCalledWith('Converta um Excel ou selecione um JSON FHIR antes de importar.');
    expect(stageFhirBundle).not.toHaveBeenCalled();
  });

  it('stages a picked JSON file, reading batch id and counters from a nested batch', async () => {
    stageFhirBundle.mockResolvedValue({ data: { batch: { _id: 'M9', counters: { valid: 5 } } } });
    render(<ImportForm />);
    pickJson(makeFile('bundle.json', '{"resourceType":"Bundle","entry":[]}', 'application/json'));
    fireEvent.click(screen.getByTestId('fhir-json-import-button'));
    await waitFor(() => expect(screen.getByTestId('fhir-staging-result')).toHaveTextContent(
      'JSON FHIR enviado para staging (lote M9). Válidos: 5. Erros: 0. Pendentes: 0.',
    ));
    expect(stageFhirBundle).toHaveBeenCalledWith({ resourceType: 'Bundle', entry: [] });
  });

  it('omits the lote clause when the response names no batch', async () => {
    stageFhirBundle.mockResolvedValue({});
    render(<ImportForm />);
    pickJson(makeFile('bundle.json', '{}', 'application/json'));
    fireEvent.click(screen.getByTestId('fhir-json-import-button'));
    await waitFor(() => expect(screen.getByTestId('fhir-staging-result')).toHaveTextContent(
      'JSON FHIR enviado para staging. Válidos: 0. Erros: 0. Pendentes: 0.',
    ));
  });

  it('reads the batch id from batch.id', async () => {
    stageFhirBundle.mockResolvedValue({ data: { data: { batch: { id: 'I3' } } } });
    render(<ImportForm />);
    pickJson(makeFile('bundle.json', '{}', 'application/json'));
    fireEvent.click(screen.getByTestId('fhir-json-import-button'));
    await waitFor(() => expect(screen.getByTestId('fhir-staging-result')).toHaveTextContent('(lote I3)'));
  });

  it.each([
    ['response message', { response: { data: { message: 'lote recusado' } } }, 'lote recusado'],
    ['response error', { response: { data: { error: 'erro do staging' } } }, 'erro do staging'],
    ['generic fallback', {}, 'Não foi possível importar o JSON FHIR.'],
  ])('shows and reports a staging failure using the %s', async (_label, rejection, expected) => {
    const onError = vi.fn();
    stageFhirBundle.mockRejectedValue(rejection);
    render(<ImportForm onError={onError} />);
    pickJson(makeFile('bundle.json', '{}', 'application/json'));
    fireEvent.click(screen.getByTestId('fhir-json-import-button'));
    expect(await screen.findByTestId('fhir-excel-error')).toHaveTextContent(expected);
    expect(onError).toHaveBeenCalledWith(expected);
  });

  it('reports a JSON file that does not parse, without staging it', async () => {
    const onError = vi.fn();
    render(<ImportForm onError={onError} />);
    pickJson(makeFile('bundle.json', '{not json', 'application/json'));
    fireEvent.click(screen.getByTestId('fhir-json-import-button'));
    const alert = await screen.findByTestId('fhir-excel-error');
    expect(alert).not.toHaveTextContent('Converta um Excel');
    expect(alert).not.toHaveTextContent('text is not a function');
    expect(onError).toHaveBeenCalledWith(alert.textContent);
    expect(stageFhirBundle).not.toHaveBeenCalled();
  });

  it('clears a shown error when a new Excel or JSON file is picked', async () => {
    render(<ImportForm />);
    fireEvent.click(screen.getByTestId('fhir-excel-convert-button'));
    expect(screen.getByTestId('fhir-excel-error')).toBeInTheDocument();
    pickExcel(makeFile('novo.xlsx', 'x'));
    expect(screen.queryByTestId('fhir-excel-error')).toBeNull();
    fireEvent.click(screen.getByTestId('fhir-json-import-button'));
    expect(await screen.findByTestId('fhir-excel-error')).toBeInTheDocument();
    pickJson(makeFile('b.json', '{}'));
    expect(screen.queryByTestId('fhir-excel-error')).toBeNull();
  });
});
