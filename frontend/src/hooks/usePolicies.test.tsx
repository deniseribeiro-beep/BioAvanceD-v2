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

// #1178: the shape GET /policies really returns -- keyed by _id, with the
// legacy numeric id as `policyId` (lowercase d), null since #1089.
const basePolicy = {
  _id: '66f2a0000000000000000001',
  policyId: null,
  policyName: 'Existing',
  minThreshold: 1,
  maxThreshold: 10,
  targetTemperature: 5,
  validFrom: '2026-01-01',
  validTo: '2026-12-31',
};

function PoliciesHarness() {
  const { policies, createPolicy, updatePolicy, deletePolicy } = usePolicies();
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
          const r = await updatePolicy(basePolicy._id, { policyName: 'Updated' } as any);
          setResult(r);
        }}
      >
        update
      </button>
      <button
        onClick={async () => {
          await deletePolicy(basePolicy._id);
        }}
      >
        delete
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
        data: { _id: '66f2a0000000000000000002', policyId: null, policyName: 'New Policy' },
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
      expect(policies[1]).toMatchObject({ _id: '66f2a0000000000000000002', policyName: 'New Policy' });
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
    expect(policyService.update).toHaveBeenCalledWith(basePolicy._id, { policyName: 'Updated' });
  });

  // #1178: the active-limit route answers an envelope; the hook must hand
  // back the inner { limit }, which is what PoliciesSection reads.
  it('#1178: getActiveLimit returns the unwrapped { limit }, not the envelope', async () => {
    vi.mocked(policyService.getAll).mockResolvedValue({ data: { success: true, data: [basePolicy] }, status: 200 } as any);
    vi.mocked(policyService.getActiveLimit).mockResolvedValue({
      data: { success: true, data: { limit: 8, type: 'max', unit: 'C' } },
      status: 200,
    } as any);

    let hook: ReturnType<typeof usePolicies> | null = null;
    function Probe() {
      hook = usePolicies();
      return null;
    }
    render(<Probe />);
    await waitFor(() => expect(hook).not.toBeNull());

    const limit = await hook!.getActiveLimit(basePolicy._id, true);
    expect(limit.limit).toBe(8);
    expect(policyService.getActiveLimit).toHaveBeenCalledWith(basePolicy._id, true);
  });

  // #1194: PoliciesSection lists getActiveLimit in an effect's deps and sets
  // state from that effect. A new identity per render re-fired the effect on
  // every setActiveLimits, re-fetching every policy's limit without end.
  it('#1194: getActiveLimit keeps one identity across renders', async () => {
    vi.mocked(policyService.getAll).mockResolvedValue({ data: { success: true, data: [basePolicy] }, status: 200 } as any);

    const identities = new Set<unknown>();
    let renders = 0;
    function Probe() {
      const hook = usePolicies();
      identities.add(hook.getActiveLimit);
      renders += 1;
      return <div data-testid="loading">{String(hook.loading)}</div>;
    }
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));

    expect(renders).toBeGreaterThan(1);
    expect(identities.size).toBe(1);
  });

  // #1178: deletePolicy used to filter local state on `policyID`, which the
  // API never returns -- `undefined !== undefined` is false, so every row
  // without one was dropped from the list, not just the deleted row.
  it('#1178: deletePolicy targets the _id and removes only that row', async () => {
    const other = { ...basePolicy, _id: '66f2a0000000000000000003', policyName: 'Other' };
    vi.mocked(policyService.getAll).mockResolvedValue({ data: { success: true, data: [basePolicy, other] }, status: 200 } as any);
    vi.mocked(policyService.delete).mockResolvedValue({ data: { success: true }, status: 200 } as any);

    render(<PoliciesHarness />);
    await waitFor(() => expect(screen.getByTestId('policies')).toHaveTextContent('Other'));

    const user = userEvent.setup();
    await user.click(screen.getByText('delete'));

    await waitFor(() => {
      const policies = JSON.parse(screen.getByTestId('policies').textContent || '[]');
      expect(policies.map((p: { _id: string }) => p._id)).toEqual([other._id]);
    });
    expect(policyService.delete).toHaveBeenCalledWith(basePolicy._id);
  });
});
