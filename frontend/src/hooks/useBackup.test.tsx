import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { useBackup } from './useBackup';
import { backupService } from '../services/api';

vi.mock('../services/api', () => ({
  backupService: { performBackup: vi.fn(), listBackups: vi.fn(), restoreBackup: vi.fn() },
}));

function Harness() {
  const { loading, error, performBackup, listBackups, restoreBackup } = useBackup();
  const [result, setResult] = useState('');
  return (
    <div>
      <div data-testid="loading">{String(loading)}</div>
      <div data-testid="error">{error || ''}</div>
      <div data-testid="result">{result}</div>
      <button type="button" onClick={() => performBackup().then((row) => setResult(row.fileName)).catch(() => setResult('fail-backup'))}>backup</button>
      <button type="button" onClick={() => listBackups().then((rows) => setResult(String(rows.length))).catch(() => setResult('fail-list'))}>list</button>
      <button type="button" onClick={() => restoreBackup('a.tar').then((row) => setResult(row.status)).catch(() => setResult('fail-restore'))}>restore</button>
    </div>
  );
}

describe('useBackup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('unwraps a nested payload and a bare payload', async () => {
    vi.mocked(backupService.performBackup).mockResolvedValue({ data: { data: { fileName: 'a.tar' } } } as never);
    vi.mocked(backupService.listBackups).mockResolvedValue({ data: [{ fileName: 'a.tar' }] } as never);
    vi.mocked(backupService.restoreBackup).mockResolvedValue({ data: { status: 'success' } } as never);
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText('backup'));
    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('a.tar'));
    await user.click(screen.getByText('list'));
    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('1'));
    await user.click(screen.getByText('restore'));
    await waitFor(() => expect(screen.getByTestId('result')).toHaveTextContent('success'));
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
  });

  it('keeps the error from each refused call', async () => {
    vi.mocked(backupService.performBackup).mockRejectedValue(new Error('disco cheio'));
    vi.mocked(backupService.listBackups).mockRejectedValue({});
    vi.mocked(backupService.restoreBackup).mockRejectedValue(new Error('arquivo ausente'));
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText('backup'));
    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('disco cheio'));
    await user.click(screen.getByText('list'));
    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('Erro ao listar backups'));
    await user.click(screen.getByText('restore'));
    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('arquivo ausente'));
  });
});
