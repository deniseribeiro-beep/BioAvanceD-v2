import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { useAnalysisTypes } from './useAnalysisTypes';
import { analysisTypeService } from '../services/api';
import { clearClientSession } from '../utils/sessionCleanup';

vi.mock('../services/api', () => ({
  analysisTypeService: { getAll: vi.fn() },
}));

function Harness() {
  const { types, loading, error } = useAnalysisTypes();
  return (
    <div>
      <div data-testid="rows">{types.map((row) => row.name).join(',')}</div>
      <div data-testid="loading">{String(loading)}</div>
      <div data-testid="error">{error || ''}</div>
    </div>
  );
}

describe('useAnalysisTypes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads the analysis types', async () => {
    vi.mocked(analysisTypeService.getAll).mockResolvedValue({ data: { data: [{ name: 'PCR' }] } } as never);
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('PCR'));
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
  });

  it('clears the list when the load fails and when the session ends', async () => {
    vi.mocked(analysisTypeService.getAll).mockResolvedValueOnce({ data: { data: [{ name: 'PCR' }] } } as never);
    render(<Harness />);
    await screen.findByText('PCR');
    clearClientSession();
    await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent(''));

    vi.mocked(analysisTypeService.getAll).mockRejectedValueOnce({});
    render(<Harness />);
    await waitFor(() => expect(screen.getAllByTestId('error')[1]).toHaveTextContent('Erro ao carregar tipos de análise'));
  });
});
