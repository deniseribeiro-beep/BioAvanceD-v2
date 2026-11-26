import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';

// #1443: the sample label page: its load of the sample and its symbology
// assets, the loading and error states, the three symbology rows (image or
// pending), and the print-job download with its busy and error states.
const h = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('../api/client', () => ({
  apiClient: { get: (...args: unknown[]) => h.get(...args) },
}));

import SampleLabelPage from './SampleLabelPage';

function asset(base64: string | null, mimeType = 'image/png') {
  return { payload: 'P', scannerPrefix: ']C1', renderer: 'bwip-js', imagePng: { mimeType, base64 } };
}

function assets(extra: Record<string, unknown> = {}) {
  return {
    barcode: 'BC-001',
    code128: asset('Y29kZTEyOA=='),
    dataMatrix: asset(null),
    qr: asset('cXI=', 'image/x-png'),
    ...extra,
  };
}

function serve(sample: unknown, symbology: unknown = assets()) {
  h.get.mockImplementation((url: string) => {
    if (url.includes('/symbology-assets')) return Promise.resolve({ data: { data: symbology } });
    return Promise.resolve({ data: { data: sample } });
  });
}

function GoTo({ path }: { path: string }) {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate(path)}>go</button>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/samples/:id/label" element={<SampleLabelPage />} />
        <Route path="/label" element={<SampleLabelPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('SampleLabelPage', () => {
  beforeEach(() => {
    h.get.mockReset();
  });
  const urlStatics = {
    createObjectURL: Object.getOwnPropertyDescriptor(URL, 'createObjectURL'),
    revokeObjectURL: Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL'),
  };
  afterEach(() => {
    vi.restoreAllMocks();
    for (const [name, descriptor] of Object.entries(urlStatics)) {
      if (descriptor) Object.defineProperty(URL, name, descriptor);
      else delete (URL as unknown as Record<string, unknown>)[name];
    }
  });

  it('reports a missing sample id without calling the API', async () => {
    renderAt('/label');
    expect(await screen.findByTestId('sample-label-error')).toHaveTextContent('Amostra não informada.');
    expect(h.get).not.toHaveBeenCalled();
  });

  it('shows the loading state until the sample resolves', async () => {
    h.get.mockReturnValue(new Promise(() => {}));
    renderAt('/samples/S%201/label');
    expect(screen.getByTestId('sample-label-loading')).toHaveTextContent('Carregando...');
  });

  it('loads the sample and then its symbology assets by encoded barcode and renders each row', async () => {
    serve({ barcode: 'BC 001/x', specimenId: 'SP-1' });
    renderAt('/samples/S%201/label');

    expect(await screen.findByTestId('sample-label-page')).toBeInTheDocument();
    expect(h.get).toHaveBeenNthCalledWith(1, '/samples/S%201');
    expect(h.get).toHaveBeenNthCalledWith(2, '/samples/by-barcode/BC%20001%2Fx/symbology-assets', {
      params: { includePayload: true },
    });
    expect(screen.getByTestId('sample-label-barcode')).toHaveTextContent('BC-001');

    const code128 = screen.getByTestId('sample-label-code128-image');
    expect(code128).toHaveAttribute('src', 'data:image/png;base64,Y29kZTEyOA==');
    expect(code128).toHaveAttribute('alt', 'Code128 BC-001');
    expect(screen.getByTestId('sample-label-qr-image')).toHaveAttribute('src', 'data:image/x-png;base64,cXI=');
    expect(screen.getByTestId('sample-label-data-matrix-pending')).toHaveTextContent('Gerando imagem...');
    expect(screen.queryByTestId('sample-label-data-matrix-image')).toBeNull();
  });

  it('reports a sample with no barcode and never asks for its assets', async () => {
    serve({ specimenId: 'SP-1' });
    renderAt('/samples/S1/label');
    expect(await screen.findByTestId('sample-label-error')).toBeInTheDocument();
    expect(screen.getByTestId('sample-label-error-message')).toHaveTextContent('Amostra sem código de barras gerado.');
    expect(screen.getByTestId('sample-label-no-barcode-guidance')).toHaveTextContent('Code128 e DataMatrix');
    expect(h.get).toHaveBeenCalledTimes(1);
  });

  it('shows the API error text when the load fails', async () => {
    h.get.mockRejectedValue({ response: { data: { error: 'Sem acesso à amostra' } }, message: 'Request failed' });
    renderAt('/samples/S1/label');
    expect(await screen.findByTestId('sample-label-error')).toHaveTextContent('Sem acesso à amostra');
  });

  it('falls back to the not-found text when the failure carries no message', async () => {
    h.get.mockRejectedValue({});
    renderAt('/samples/S1/label');
    expect(await screen.findByTestId('sample-label-error')).toHaveTextContent('Amostra não encontrada.');
  });

  it('keeps the newer sample when an earlier id resolves after navigation', async () => {
    let releaseA!: (v: unknown) => void;
    h.get.mockImplementation((url: string) => {
      if (url === '/samples/A') return new Promise((r) => { releaseA = r; });
      if (url === '/samples/B') return Promise.resolve({ data: { data: { barcode: 'B' } } });
      const barcode = url.split('/')[3];
      return Promise.resolve({ data: { data: assets({ barcode: `BC-${barcode}` }) } });
    });
    render(
      <MemoryRouter initialEntries={['/samples/A/label']}>
        <GoTo path="/samples/B/label" />
        <Routes>
          <Route path="/samples/:id/label" element={<SampleLabelPage />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'go' }));
    expect(await screen.findByTestId('sample-label-barcode')).toHaveTextContent('BC-B');

    await act(async () => {
      releaseA({ data: { data: { barcode: 'A' } } });
    });
    expect(h.get).toHaveBeenCalledWith('/samples/by-barcode/A/symbology-assets', { params: { includePayload: true } });
    expect(screen.getByTestId('sample-label-barcode')).toHaveTextContent('BC-B');
  });

  it('downloads the print job as JSON, showing the busy label while it runs', async () => {
    serve({ barcode: 'BC-001' });
    renderAt('/samples/S%201/label');
    const button = await screen.findByTestId('sample-label-print-job-button');
    expect(button).toHaveTextContent('Print job (ZPL)');

    let release!: (v: unknown) => void;
    h.get.mockReturnValueOnce(new Promise((r) => { release = r; }));
    const createObjectURL = vi.fn(() => 'blob:print-job');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('label-S 1-print-job.json');
      expect(this.href).toBe('blob:print-job');
    });

    fireEvent.click(button);
    expect(button).toHaveTextContent('Gerando...');
    expect(button).toBeDisabled();
    expect(h.get).toHaveBeenLastCalledWith('/samples/S%201/label/print-job', { suppressErrorToast: true });

    await act(async () => {
      release({ data: { data: { zpl: '^XA^XZ' } } });
    });

    expect(click).toHaveBeenCalledTimes(1);
    const blob = (createObjectURL.mock.calls[0] as unknown[])[0] as Blob;
    expect(blob.type).toBe('application/json;charset=utf-8');
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blob);
    });
    expect(JSON.parse(text)).toEqual({ zpl: '^XA^XZ' });
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:print-job');
    expect(button).toHaveTextContent('Print job (ZPL)');
    expect(button).not.toBeDisabled();
    expect(screen.queryByTestId('sample-label-action-error')).toBeNull();
  });

  it.each([
    [{ response: { data: { error: 'Impressora indisponível' } } }, 'Impressora indisponível'],
    [{ response: { data: { message: 'Job recusado' } } }, 'Job recusado'],
    [{ message: 'Network Error' }, 'Network Error'],
    [{}, 'Falha ao gerar job de impressão.'],
  ])('shows the print-job failure text (%#)', async (failure, text) => {
    serve({ barcode: 'BC-001' });
    renderAt('/samples/S1/label');
    const button = await screen.findByTestId('sample-label-print-job-button');
    h.get.mockRejectedValueOnce(failure);
    fireEvent.click(button);
    expect(await screen.findByTestId('sample-label-action-error')).toHaveTextContent(text);
    await waitFor(() => expect(button).not.toBeDisabled());
  });
});
