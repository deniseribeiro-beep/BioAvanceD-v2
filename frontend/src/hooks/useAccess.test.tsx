import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { useAccess } from './useAccess';
import { accessService } from '../services/api';

// #898: access.routes.js's POST /access returns { success, message, data }
// (access.routes.js:100-104); PUT /access/:id returns { success, message }
// with NO data key (access.routes.js:146-149). createAccess already reloads
// the list for state, but its RETURN value was the raw envelope; updateAccess
// wrote the bare envelope directly into `accesses` state.
vi.mock('../services/api', () => ({
  accessService: {
    getAll: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

const baseAccess = {
  reportID: 1,
  reportType: 'Existing',
};

function AccessHarness() {
  const { accesses, createAccess, updateAccess } = useAccess();
  const [result, setResult] = useState<unknown>(null);

  return (
    <div>
      <div data-testid="accesses">{JSON.stringify(accesses)}</div>
      <div data-testid="result">{JSON.stringify(result)}</div>
      <button
        onClick={async () => {
          const r = await createAccess({ reportType: 'New' } as any);
          setResult(r);
        }}
      >
        create
      </button>
      <button
        onClick={async () => {
          const r = await updateAccess(1, { reportType: 'Updated' } as any);
          setResult(r);
        }}
      >
        update
      </button>
    </div>
  );
}

describe('useAccess mutations (#898)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('createAccess returns the unwrapped entity, not the raw {success,message,data} envelope', async () => {
    vi.mocked(accessService.getAll).mockResolvedValue({ data: { success: true, data: [baseAccess] }, status: 200 } as any);
    vi.mocked(accessService.create).mockResolvedValue({
      data: {
        success: true,
        message: 'Acesso criado com sucesso',
        data: { reportID: 2, reportType: 'New' },
      },
      status: 201,
    } as any);

    render(<AccessHarness />);
    await waitFor(() => expect(screen.getByTestId('accesses')).toHaveTextContent('Existing'));

    const user = userEvent.setup();
    await user.click(screen.getByText('create'));

    await waitFor(() => {
      const result = JSON.parse(screen.getByTestId('result').textContent || 'null');
      expect(result).toMatchObject({ reportID: 2, reportType: 'New' });
      expect(result.success).toBeUndefined();
      expect(result.message).toBeUndefined();
    });
  });

  it('updateAccess (no data key in the response) reloads the list instead of writing a bare success-message object into state', async () => {
    vi.mocked(accessService.getAll)
      .mockResolvedValueOnce({ data: { success: true, data: [baseAccess] }, status: 200 } as any)
      .mockResolvedValueOnce({ data: { success: true, data: [{ ...baseAccess, reportType: 'Updated' }] }, status: 200 } as any);
    vi.mocked(accessService.update).mockResolvedValue({
      data: { success: true, message: 'Acesso atualizado com sucesso' },
      status: 200,
    } as any);

    render(<AccessHarness />);
    await waitFor(() => expect(screen.getByTestId('accesses')).toHaveTextContent('Existing'));

    const user = userEvent.setup();
    await user.click(screen.getByText('update'));

    await waitFor(() => {
      const accesses = JSON.parse(screen.getByTestId('accesses').textContent || '[]');
      expect(accesses).toHaveLength(1);
      expect(accesses[0].reportType).toBe('Updated');
      expect(accesses[0].success).toBeUndefined();
    });
    expect(accessService.getAll).toHaveBeenCalledTimes(2);
  });
});
