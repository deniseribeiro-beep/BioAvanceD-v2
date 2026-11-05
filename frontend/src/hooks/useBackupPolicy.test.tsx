import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { useBackupPolicy } from './useBackupPolicy';
import { backupPolicyService } from '../services/api';

vi.mock('../services/api', () => ({
  backupPolicyService: { getPolicy: vi.fn(), updatePolicy: vi.fn() },
}));

function Harness() {
  const { policy, error, saving, updatePolicy } = useBackupPolicy();
  const [result, setResult] = useState('');
  return (
    <div>
      <div data-testid="policy">{policy?.cronExpression || ''}</div>
      <div data-testid="error">{error || ''}</div>
      <div data-testid="saving">{String(saving)}</div>
      <div data-testid="result">{result}</div>
      <button type="button" onClick={() => updatePolicy({ retentionDays: 30 }).then((row) => setResult(row?.cronExpression || 'saved')).catch((err) => setResult(err.message))}>save</button>
    </div>
  );
}

describe('useBackupPolicy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(backupPolicyService.getPolicy).mockResolvedValue({
      data: { data: { cronExpression: '0 3 * * *', retentionDays: 30, encryptionEnabled: true, rpoHours: 24, rtoHours: 12 } },
    } as never);
  });

  it('loads the policy and saves a change', async () => {
    vi.mocked(backupPolicyService.updatePolicy).mockResolvedValue({
      data: { data: { cronExpression: '0 4 * * *', retentionDays: 30, encryptionEnabled: true, rpoHours: 24, rtoHours: 12 } },
    } as never);
    const user = userEvent.setup();
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('policy')).toHaveTextContent('0 3 * * *'));
    await user.click(screen.getByText('save'));
    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('0 4 * * *'));
    expect(screen.getByTestId('saving')).toHaveTextContent('false');
  });

  it('joins the details of a refused policy', async () => {
    vi.mocked(backupPolicyService.getPolicy).mockRejectedValueOnce({ response: { data: { details: ['cron', 'retenção'] } } });
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('cron; retenção'));

    vi.mocked(backupPolicyService.getPolicy).mockResolvedValue({ data: { data: null } } as never);
    vi.mocked(backupPolicyService.updatePolicy).mockRejectedValueOnce(new Error('recusado'));
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getAllByText('save')[1]);
    await waitFor(() => expect(screen.getAllByTestId('result')[1]).toHaveTextContent('recusado'));
  });
});
