import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { useResults } from './useResults';
import { resultService } from '../services/api';

// #898: result.routes.js's POST /results returns { success, message, data }
// (result.routes.js:426-430); PUT /results/:id and PUT
// /results/:id/link-sample both return { success, message } with NO data key
// (result.routes.js:483-486, :562-565). useResults used to write the raw
// axios envelope into `results` state instead of the entity.
vi.mock('../services/api', () => ({
  resultService: {
    getAll: vi.fn(),
    getById: vi.fn(),
    upload: vi.fn(),
    create: vi.fn(),
    linkSample: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

const baseResult = {
  resultID: 1,
  fileType: 'pdf',
  filePath: '/files/1.pdf',
  description: 'Existing result',
  specimenId: 'SPEC-1',
};

function ResultsHarness() {
  const { results, createResult, updateResult, linkSample } = useResults();
  const [result, setResult] = useState<unknown>(null);

  return (
    <div>
      <div data-testid="results">{JSON.stringify(results)}</div>
      <div data-testid="result">{JSON.stringify(result)}</div>
      <button
        onClick={async () => {
          const r = await createResult({ description: 'New result' } as any);
          setResult(r);
        }}
      >
        create
      </button>
      <button
        onClick={async () => {
          const r = await updateResult(1, { description: 'Updated' } as any);
          setResult(r);
        }}
      >
        update
      </button>
      <button
        onClick={async () => {
          const r = await linkSample(1, 'SPEC-2');
          setResult(r);
        }}
      >
        link
      </button>
    </div>
  );
}

describe('useResults mutations (#898)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('createResult pushes the unwrapped entity, not the {success,message,data} envelope', async () => {
    vi.mocked(resultService.getAll).mockResolvedValue({ data: { success: true, data: [baseResult] }, status: 200 } as any);
    vi.mocked(resultService.create).mockResolvedValue({
      data: {
        success: true,
        message: 'Arquivo de analise criado com sucesso',
        data: { resultID: 2, description: 'New result' },
      },
      status: 201,
    } as any);

    render(<ResultsHarness />);
    await waitFor(() => expect(screen.getByTestId('results')).toHaveTextContent('Existing result'));

    const user = userEvent.setup();
    await user.click(screen.getByText('create'));

    await waitFor(() => {
      const results = JSON.parse(screen.getByTestId('results').textContent || '[]');
      expect(results).toHaveLength(2);
      expect(results[1]).toMatchObject({ resultID: 2, description: 'New result' });
      expect(results[1].success).toBeUndefined();
      expect(results[1].message).toBeUndefined();
    });
  });

  it('updateResult (no data key in the response) reloads the list instead of writing a bare success-message object into state', async () => {
    vi.mocked(resultService.getAll)
      .mockResolvedValueOnce({ data: { success: true, data: [baseResult] }, status: 200 } as any)
      .mockResolvedValueOnce({ data: { success: true, data: [{ ...baseResult, description: 'Updated' }] }, status: 200 } as any);
    vi.mocked(resultService.update).mockResolvedValue({
      data: { success: true, message: 'Arquivo de analise atualizado com sucesso' },
      status: 200,
    } as any);

    render(<ResultsHarness />);
    await waitFor(() => expect(screen.getByTestId('results')).toHaveTextContent('Existing result'));

    const user = userEvent.setup();
    await user.click(screen.getByText('update'));

    await waitFor(() => {
      const results = JSON.parse(screen.getByTestId('results').textContent || '[]');
      expect(results).toHaveLength(1);
      expect(results[0].description).toBe('Updated');
      expect(results[0].success).toBeUndefined();
    });
    expect(resultService.getAll).toHaveBeenCalledTimes(2);
  });

  it('linkSample (no data key in the response) reloads the list instead of writing a bare success-message object into state', async () => {
    vi.mocked(resultService.getAll)
      .mockResolvedValueOnce({ data: { success: true, data: [baseResult] }, status: 200 } as any)
      .mockResolvedValueOnce({ data: { success: true, data: [{ ...baseResult, specimenId: 'SPEC-2' }] }, status: 200 } as any);
    vi.mocked(resultService.linkSample).mockResolvedValue({
      data: { success: true, message: 'Arquivo de analise vinculado à amostra com sucesso' },
      status: 200,
    } as any);

    render(<ResultsHarness />);
    await waitFor(() => expect(screen.getByTestId('results')).toHaveTextContent('Existing result'));

    const user = userEvent.setup();
    await user.click(screen.getByText('link'));

    await waitFor(() => {
      const results = JSON.parse(screen.getByTestId('results').textContent || '[]');
      expect(results).toHaveLength(1);
      expect(results[0].specimenId).toBe('SPEC-2');
      expect(results[0].success).toBeUndefined();
    });
    expect(resultService.getAll).toHaveBeenCalledTimes(2);
  });
});
