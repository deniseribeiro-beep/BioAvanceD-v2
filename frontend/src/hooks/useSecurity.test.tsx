import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { useSecurity } from './useSecurity';
import { securityService } from '../services/api';

vi.mock('../services/api', () => ({
  securityService: {
    getConfig: vi.fn(),
    getPermissions: vi.fn(),
    updateConfig: vi.fn(),
    exportLogs: vi.fn(),
  },
}));

function Harness() {
  const { config, permissions, error, updateConfig, exportLogs } = useSecurity();
  const [result, setResult] = useState('');
  return (
    <div>
      <div data-testid="config">{config ? 'loaded' : ''}</div>
      <div data-testid="permissions">{permissions?.roles?.[0]?.roleCode || ''}</div>
      <div data-testid="error">{error || ''}</div>
      <div data-testid="result">{result}</div>
      <button type="button" onClick={() => updateConfig({}).then(() => setResult('saved')).catch((err) => setResult(err.message))}>save</button>
      <button type="button" onClick={() => exportLogs({ q: 'a' }, 'json').then(() => setResult('exported')).catch((err) => setResult(err.message))}>export</button>
    </div>
  );
}

describe('useSecurity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(securityService.getConfig).mockResolvedValue({ data: { data: { authentication: { requireMFA: true } } } } as never);
    vi.mocked(securityService.getPermissions).mockResolvedValue({ data: { data: { roles: [{ roleCode: 'administrator' }], permissions: [] } } } as never);
  });

  it('loads the configuration and the permissions, then saves and exports', async () => {
    vi.mocked(securityService.updateConfig).mockResolvedValue({ data: { data: { authentication: { requireMFA: false } } } } as never);
    vi.mocked(securityService.exportLogs).mockResolvedValue({ data: '{}' } as never);
    const user = userEvent.setup();
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('config')).toHaveTextContent('loaded'));
    expect(screen.getByTestId('permissions')).toHaveTextContent('administrator');
    await user.click(screen.getByText('save'));
    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('saved'));
    await user.click(screen.getByText('export'));
    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('exported'));
  });

  it('keeps the message from a refused load, save and export', async () => {
    vi.mocked(securityService.getConfig).mockRejectedValueOnce('offline');
    vi.mocked(securityService.getPermissions).mockRejectedValueOnce({ response: { data: { message: 'sem papel' } } });
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('sem papel'));

    vi.mocked(securityService.getConfig).mockResolvedValue({ data: { data: {} } } as never);
    vi.mocked(securityService.getPermissions).mockResolvedValue({ data: { data: { roles: [], permissions: [] } } } as never);
    vi.mocked(securityService.updateConfig).mockRejectedValueOnce(new Error('inválido'));
    vi.mocked(securityService.exportLogs).mockRejectedValueOnce({});
    const user = userEvent.setup();
    render(<Harness />);
    await screen.findByText('loaded');
    await user.click(screen.getAllByText('save')[1]);
    await waitFor(() => expect(screen.getAllByTestId('result')[1]).toHaveTextContent('inválido'));
    await user.click(screen.getAllByText('export')[1]);
    await waitFor(() => expect(screen.getAllByTestId('result')[1]).toHaveTextContent('Erro ao exportar logs'));
  });
});
