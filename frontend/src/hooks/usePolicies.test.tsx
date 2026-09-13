import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { usePolicies } from './usePolicies';
import { policyService } from '../services/api';

// #898: policy.routes.js's POST /policies returns { success, message, data }
// and PUT /policies/:id returns { success, message } with NO data key at all
// (policy.routes.js:163-167, :204-207). usePolicies used to write the raw
// axios envelope into `policies` state instead of the entity.
vi.mock('../services/api', () => ({
  policyService: {
    getAll: vi.fn(),
    getActiveLimit: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

const basePolicy = {
  policyID: 1,
  policyName: 'Existing',
  minThreshold: 1,
  maxThreshold: 10,
  targetTemperature: 5,
  validFrom: '2026-01-01',
  validTo: '2026-12-31',
};

function PoliciesHarness() {
  const { policies, createPolicy, updatePolicy } = usePolicies();
  const [result, setResult] = useState<unknown>(null);

  return (
    <div>
      <div data-testid="policies">{JSON.stringify(policies)}</div>
      <div data-testid="result">{JSON.stringify(result)}</div>
      <button
        onClick={async () => {
          const r = await createPolicy({ policyName: 'New Policy' } as any);
          setResult(r);
        }}
      >
        create
      </button>
      <button
        onClick={async () => {
          const r = await updatePolicy(1, { policyName: 'Updated' } as any);
          setResult(r);
        }}
      >
        update
      </button>
    </div>
  );
}

describe('usePolicies mutations (#898)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('createPolicy pushes the unwrapped entity, not the {success,message,data} envelope', async () => {
    vi.mocked(policyService.getAll).mockResolvedValue({ data: { success: true, data: [basePolicy] }, status: 200 } as any);
    vi.mocked(policyService.create).mockResolvedValue({
      data: {
        success: true,
        message: 'Política criada com sucesso',
        data: { policyID: 2, policyName: 'New Policy' },
      },
      status: 201,
    } as any);

    render(<PoliciesHarness />);
    await waitFor(() => expect(screen.getByTestId('policies')).toHaveTextContent('Existing'));

    const user = userEvent.setup();
    await user.click(screen.getByText('create'));

    await waitFor(() => {
      const policies = JSON.parse(screen.getByTestId('policies').textContent || '[]');
      expect(policies).toHaveLength(2);
      expect(policies[1]).toMatchObject({ policyID: 2, policyName: 'New Policy' });
      // the raw envelope must never land in state
      expect(policies[1].success).toBeUndefined();
      expect(policies[1].message).toBeUndefined();
    });
  });

  it('updatePolicy (no data key in the response) reloads the list instead of writing a bare success-message object into state', async () => {
    vi.mocked(policyService.getAll)
      .mockResolvedValueOnce({ data: { success: true, data: [basePolicy] }, status: 200 } as any)
      .mockResolvedValueOnce({ data: { success: true, data: [{ ...basePolicy, policyName: 'Updated' }] }, status: 200 } as any);
    vi.mocked(policyService.update).mockResolvedValue({
      data: { success: true, message: 'Política atualizada com sucesso' },
      status: 200,
    } as any);

    render(<PoliciesHarness />);
    await waitFor(() => expect(screen.getByTestId('policies')).toHaveTextContent('Existing'));

    const user = userEvent.setup();
    await user.click(screen.getByText('update'));

    await waitFor(() => {
      const policies = JSON.parse(screen.getByTestId('policies').textContent || '[]');
      expect(policies).toHaveLength(1);
      expect(policies[0].policyName).toBe('Updated');
      // never a bare {success,message} object standing in for the entity
      expect(policies[0].success).toBeUndefined();
    });
    expect(policyService.getAll).toHaveBeenCalledTimes(2);
  });
});
