import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { useSamples } from './useSamples';
import { samplesApi } from '../services/samples/samplesApi';

vi.mock('../services/samples/samplesApi', () => ({
  samplesApi: {
    getAll: vi.fn(),
    getResults: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}));

function Harness() {
  const { samples, total, error, createSample, updateSample, deleteSample, getSampleResults } = useSamples();
  const [result, setResult] = useState('');
  return (
    <div>
      <div data-testid="rows">{samples.map((row) => (row as { barcode?: string }).barcode).join(',')}</div>
      <div data-testid="total">{String(total)}</div>
      <div data-testid="error">{error || ''}</div>
      <div data-testid="result">{result}</div>
      <button type="button" onClick={() => createSample({}).then((row) => setResult(String((row as { barcode?: string })?.barcode || 'ok'))).catch((err) => setResult(err.message))}>create</button>
      <button type="button" onClick={() => updateSample('s1', {}).then((row) => setResult(String((row as { barcode?: string })?.barcode || 'ok'))).catch((err) => setResult(err.message))}>update</button>
      <button type="button" onClick={() => deleteSample('s1').then(() => setResult('gone')).catch((err) => setResult(err.message))}>delete</button>
      <button type="button" onClick={() => getSampleResults(1).then((rows) => setResult(String(rows.length))).catch((err) => setResult(err.message))}>results</button>
    </div>
  );
}

describe('useSamples', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(samplesApi.getAll).mockResolvedValue({ data: { data: { samples: [{ barcode: 'B1' }], total: 4 } } } as never);
  });

  it('loads the inventory and writes a sample', async () => {
    vi.mocked(samplesApi.create).mockResolvedValue({ data: { data: { barcode: 'B2' } } } as never);
    vi.mocked(samplesApi.update).mockResolvedValue({ data: { barcode: 'B3' } } as never);
    vi.mocked(samplesApi.remove).mockResolvedValue({} as never);
    vi.mocked(samplesApi.getResults).mockResolvedValue({ data: { results: [{ id: 'r1' }] } } as never);
    const user = userEvent.setup();
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('B1'));
    expect(screen.getByTestId('total')).toHaveTextContent('4');
    await user.click(screen.getByText('create'));
    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('B2'));
    await user.click(screen.getByText('update'));
    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('B3'));
    await user.click(screen.getByText('delete'));
    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('gone'));
    await user.click(screen.getByText('results'));
    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('1'));
  });

  it('clears the list when the load fails and names a refused write', async () => {
    vi.mocked(samplesApi.getAll).mockRejectedValueOnce({ response: { data: { error: 'indisponível' } } });
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('indisponível'));

    vi.mocked(samplesApi.getAll).mockResolvedValue({ data: { samples: [] } } as never);
    vi.mocked(samplesApi.create).mockRejectedValueOnce({});
    vi.mocked(samplesApi.getResults).mockRejectedValueOnce({ message: 'sem resultado' });
    const user = userEvent.setup();
    render(<Harness />);
    await waitFor(() => expect(screen.getAllByTestId('total')[1]).toHaveTextContent('0'));
    await user.click(screen.getAllByText('create')[1]);
    await waitFor(() => expect(screen.getAllByTestId('result')[1]).toHaveTextContent('Erro ao criar amostra'));
    await user.click(screen.getAllByText('results')[1]);
    await waitFor(() => expect(screen.getAllByTestId('result')[1]).toHaveTextContent('sem resultado'));
  });
});
