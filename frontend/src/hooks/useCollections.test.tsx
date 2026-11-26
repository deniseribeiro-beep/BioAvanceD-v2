import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { useCollections } from './useCollections';
import { collectionsService } from '../services/api';

vi.mock('../services/api', () => ({
  collectionsService: { getAll: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
}));

const list = { data: { data: [{ _id: 'c1', name: 'Coleção' }] } };

function Harness() {
  const { collections, error, createCollection, updateCollection, deleteCollection } = useCollections();
  const [result, setResult] = useState('');
  return (
    <div>
      <div data-testid="rows">{collections.map((row) => row.name).join(',')}</div>
      <div data-testid="error">{error || ''}</div>
      <div data-testid="result">{result}</div>
      <button type="button" onClick={() => createCollection({ name: 'Nova' }).then((row) => setResult(row.name)).catch((err) => setResult(err.message))}>create</button>
      <button type="button" onClick={() => updateCollection('c1', { name: 'Editada' }).then((row) => setResult(String(row?.name || 'ok'))).catch((err) => setResult(err.message))}>update</button>
      <button type="button" onClick={() => deleteCollection('c1').catch((err) => setResult(err.message))}>delete</button>
    </div>
  );
}

describe('useCollections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(collectionsService.getAll).mockResolvedValue(list as never);
  });

  it('loads and saves a collection', async () => {
    vi.mocked(collectionsService.create).mockResolvedValue({ data: { data: { name: 'Nova' } } } as never);
    vi.mocked(collectionsService.update).mockResolvedValue({ data: {} } as never);
    vi.mocked(collectionsService.delete).mockResolvedValue({} as never);
    const user = userEvent.setup();
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('Coleção'));
    await user.click(screen.getByText('create'));
    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('Nova'));
    await user.click(screen.getByText('update'));
    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('ok'));
    await user.click(screen.getByText('delete'));
    await waitFor(() => expect(collectionsService.delete).toHaveBeenCalledWith('c1'));
  });

  it('uses the service message when a write is refused', async () => {
    vi.mocked(collectionsService.getAll).mockRejectedValueOnce({ message: 'sem rede' });
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('sem rede'));

    vi.mocked(collectionsService.getAll).mockResolvedValue(list as never);
    vi.mocked(collectionsService.create).mockRejectedValue({ response: { data: { message: 'nome repetido' } } });
    const user = userEvent.setup();
    render(<Harness />);
    await screen.findByText('Coleção');
    await user.click(screen.getAllByText('create')[1]);
    await waitFor(() => expect(screen.getAllByTestId('result')[1]).toHaveTextContent('nome repetido'));
  });
});
