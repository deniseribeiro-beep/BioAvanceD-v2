import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// The storage page's sample locator as an operator uses it: the empty and
// blank-input states, a lookup by Enter or by the search button with its found,
// not-found and error outcomes, the barcode/QR reading mode, and releasing the
// found sample's position with its success and error outcomes.
const mocks = vi.hoisted(() => ({
  getSampleLocation: vi.fn(),
  releaseSample: vi.fn(),
}));

vi.mock('@/services/storageApi', () => ({
  storageApi: {
    getSampleLocation: (...args: unknown[]) => mocks.getSampleLocation(...args),
    releaseSample: (...args: unknown[]) => mocks.releaseSample(...args),
  },
}));

import { SampleLocator } from '@/components/SampleLocator';

const FOUND = {
  specimenId: 'SP-1',
  barcode: 'BR-2026-001',
  path: '/Freezer A/Prateleira 1/Rack 2/',
  box: { boxId: 'B-9', boxName: 'Caixa 9', position: 'A3' },
};

const input = () => screen.getByTestId('sample-locator-input') as HTMLInputElement;
const searchButton = () => screen.getByTestId('sample-locator-search-button');
const scanButton = () => screen.getByTestId('sample-locator-scan-button');
const errorText = () => screen.getByTestId('sample-locator-error-box').textContent;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function searchFor(value: string) {
  fireEvent.change(input(), { target: { value } });
  fireEvent.click(searchButton());
  await waitFor(() => expect(searchButton()).not.toBeDisabled());
}

async function findSample() {
  mocks.getSampleLocation.mockResolvedValueOnce({ success: true, data: FOUND });
  await searchFor('SP-1');
  await screen.findByTestId('sample-locator-result-box');
}

beforeEach(() => {
  mocks.getSampleLocation.mockReset();
  mocks.releaseSample.mockReset();
});

describe('SampleLocator', () => {
  it('starts in the empty state in manual mode with no error and no result', () => {
    render(<SampleLocator />);
    expect(screen.getByText('Digite um ID ou código de barras para localizar uma amostra')).toBeInTheDocument();
    expect(screen.getByText('Use busca manual ou ative a leitura.')).toBeInTheDocument();
    expect(input().placeholder).toBe('Digite ID, barcode ou QR code...');
    expect(scanButton()).toHaveTextContent('Barcode/QR');
    expect(screen.queryByTestId('sample-locator-error-box')).toBeNull();
    expect(screen.queryByTestId('sample-locator-result-box')).toBeNull();
  });

  it('refuses a blank or whitespace-only search without calling the service', () => {
    render(<SampleLocator />);
    fireEvent.click(searchButton());
    expect(errorText()).toContain('Por favor, insira um ID ou código de barras da amostra');
    fireEvent.change(input(), { target: { value: '   ' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(errorText()).toContain('Por favor, insira um ID ou código de barras da amostra');
    expect(mocks.getSampleLocation).not.toHaveBeenCalled();
    expect(screen.queryByText('Digite um ID ou código de barras para localizar uma amostra')).toBeNull();
  });

  it('looks a sample up on Enter and renders its location', async () => {
    mocks.getSampleLocation.mockResolvedValueOnce({ success: true, data: FOUND });
    render(<SampleLocator />);
    fireEvent.change(input(), { target: { value: 'SP-1' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    const box = await screen.findByTestId('sample-locator-result-box');
    expect(mocks.getSampleLocation).toHaveBeenCalledWith('SP-1');
    expect(box).toHaveTextContent('SP-1');
    expect(box).toHaveTextContent('BR-2026-001');
    const badges = Array.from(box.querySelectorAll('.badge')).map((b) => b.textContent);
    expect(badges).toEqual(['Freezer A', 'Prateleira 1', 'Rack 2']);
    expect(box.querySelectorAll('.hierarchy-arrow')).toHaveLength(2);
    expect(box).toHaveTextContent('Caixa 9');
    expect(box.querySelector('.position-badge')?.textContent).toBe('A3');
    expect(screen.queryByText('Digite um ID ou código de barras para localizar uma amostra')).toBeNull();
  });

  it('shows the box id when the box has no name', async () => {
    mocks.getSampleLocation.mockResolvedValueOnce({
      success: true,
      data: { ...FOUND, box: { boxId: 'B-9', boxName: null, position: 'A3' } },
    });
    render(<SampleLocator />);
    await searchFor('SP-1');
    const box = await screen.findByTestId('sample-locator-result-box');
    expect(box).toHaveTextContent('B-9');
    expect(box).not.toHaveTextContent('Caixa 9');
  });

  it('ignores keys other than Enter', () => {
    render(<SampleLocator />);
    fireEvent.change(input(), { target: { value: 'SP-1' } });
    fireEvent.keyDown(input(), { key: 'a' });
    expect(mocks.getSampleLocation).not.toHaveBeenCalled();
  });

  it.each([
    ['an unsuccessful response', { success: false, error: 'LOCATION_ERROR' }],
    ['a successful response with no data', { success: true }],
  ])('reports the sample as not found on %s', async (_label, response) => {
    mocks.getSampleLocation.mockResolvedValueOnce(response);
    render(<SampleLocator />);
    await searchFor('SP-404');
    expect(errorText()).toContain('Amostra "SP-404" não encontrada no banco de dados.');
    expect(screen.queryByTestId('sample-locator-result-box')).toBeNull();
  });

  it.each([
    ['a 401', new Error('Request failed with status code 401'), 'Sessão expirada. Por favor, faça login novamente.'],
    ['a token error', new Error('invalid token'), 'Sessão expirada. Por favor, faça login novamente.'],
    ['a 404', new Error('Request failed with status code 404'), 'Amostra "SP-7" não encontrada no banco de dados.'],
    ['any other error', new Error('Network Error'), 'Erro ao buscar amostra: Network Error'],
    ['an error with no message', {}, 'Erro ao buscar amostra: Erro desconhecido'],
  ])('maps a thrown %s to its message', async (_label, thrown, message) => {
    mocks.getSampleLocation.mockRejectedValueOnce(thrown);
    render(<SampleLocator />);
    await searchFor('SP-7');
    expect(errorText()).toContain(message);
  });

  it('disables the controls and shows Buscando while a lookup is in flight', async () => {
    const pending = deferred<unknown>();
    mocks.getSampleLocation.mockReturnValueOnce(pending.promise);
    render(<SampleLocator />);
    fireEvent.change(input(), { target: { value: 'SP-1' } });
    fireEvent.click(searchButton());
    expect(searchButton()).toHaveTextContent('Buscando');
    expect(searchButton()).toBeDisabled();
    expect(scanButton()).toBeDisabled();
    expect(input()).toBeDisabled();
    expect(screen.queryByText('Digite um ID ou código de barras para localizar uma amostra')).toBeNull();
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(mocks.getSampleLocation).toHaveBeenCalledTimes(1);
    pending.resolve({ success: true, data: FOUND });
    await screen.findByTestId('sample-locator-result-box');
    expect(searchButton()).toHaveTextContent('Pesquisar');
  });

  it('toggles the reading mode and focuses the field and clears an error', () => {
    render(<SampleLocator />);
    fireEvent.click(searchButton());
    expect(screen.getByTestId('sample-locator-error-box')).toBeInTheDocument();
    fireEvent.click(scanButton());
    expect(screen.queryByTestId('sample-locator-error-box')).toBeNull();
    expect(scanButton()).toHaveTextContent('Leitura ativa');
    expect(scanButton()).toHaveClass('active');
    expect(input().placeholder).toBe('Escaneie e pressione Enter...');
    expect(screen.getByText('Leitura ativa: escaneie no campo e pressione Enter.')).toHaveClass('active');
    expect(document.activeElement).toBe(input());
    fireEvent.click(scanButton());
    expect(scanButton()).toHaveTextContent('Barcode/QR');
    expect(scanButton()).not.toHaveClass('active');
    expect(input().placeholder).toBe('Digite ID, barcode ou QR code...');
  });

  it('Nova Busca clears the field, the result and any error and focuses the field (#1448)', async () => {
    mocks.releaseSample.mockResolvedValueOnce({ success: false, error: 'RELEASE_ERROR' });
    render(<SampleLocator />);
    await findSample();
    fireEvent.click(screen.getByTestId('sample-locator-release-button'));
    await waitFor(() => expect(errorText()).toContain('Erro ao liberar amostra: RELEASE_ERROR'));
    expect(document.activeElement).not.toBe(input());
    fireEvent.click(screen.getByTestId('sample-locator-new-search-button'));
    expect(input().value).toBe('');
    expect(screen.queryByTestId('sample-locator-result-box')).toBeNull();
    expect(screen.queryByTestId('sample-locator-error-box')).toBeNull();
    expect(document.activeElement).toBe(input());
    expect(screen.getByText('Digite um ID ou código de barras para localizar uma amostra')).toBeInTheDocument();
    expect(mocks.getSampleLocation).toHaveBeenCalledTimes(1);
  });

  it('releases the found position and returns to the empty state with the field cleared', async () => {
    mocks.releaseSample.mockResolvedValueOnce({ success: true });
    render(<SampleLocator />);
    await findSample();
    fireEvent.click(screen.getByTestId('sample-locator-release-button'));
    await waitFor(() => expect(screen.queryByTestId('sample-locator-result-box')).toBeNull());
    expect(mocks.releaseSample).toHaveBeenCalledWith('SP-1');
    expect(input().value).toBe('');
    expect(screen.getByText('Digite um ID ou código de barras para localizar uma amostra')).toBeInTheDocument();
  });

  it('keeps the result and reports the service error when the release is refused', async () => {
    mocks.releaseSample.mockResolvedValueOnce({ success: false, error: 'RELEASE_ERROR' });
    render(<SampleLocator />);
    await findSample();
    fireEvent.click(screen.getByTestId('sample-locator-release-button'));
    await waitFor(() => expect(errorText()).toContain('Erro ao liberar amostra: RELEASE_ERROR'));
    expect(screen.getByTestId('sample-locator-result-box')).toBeInTheDocument();
    expect(input().value).toBe('SP-1');
  });

  it.each([
    ['with a message', new Error('Network Error'), 'Erro ao liberar amostra: Network Error'],
    ['with no message', {}, 'Erro ao liberar amostra: Erro desconhecido'],
  ])('reports a thrown release error %s', async (_label, thrown, message) => {
    mocks.releaseSample.mockRejectedValueOnce(thrown);
    render(<SampleLocator />);
    await findSample();
    fireEvent.click(screen.getByTestId('sample-locator-release-button'));
    await waitFor(() => expect(errorText()).toContain(message));
    expect(screen.getByTestId('sample-locator-release-button')).not.toBeDisabled();
  });

  it('disables both result actions and shows Liberando while a release is in flight', async () => {
    const pending = deferred<unknown>();
    mocks.releaseSample.mockReturnValueOnce(pending.promise);
    render(<SampleLocator />);
    await findSample();
    fireEvent.click(screen.getByTestId('sample-locator-release-button'));
    expect(screen.getByTestId('sample-locator-release-button')).toHaveTextContent('Liberando...');
    expect(screen.getByTestId('sample-locator-release-button')).toBeDisabled();
    expect(screen.getByTestId('sample-locator-new-search-button')).toBeDisabled();
    pending.resolve({ success: true });
    await waitFor(() => expect(screen.queryByTestId('sample-locator-result-box')).toBeNull());
  });
});
