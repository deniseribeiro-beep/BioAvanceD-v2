import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

// The backup admin page (/backup) over the real useBackup and useBackupPolicy
// hooks: only the services are mocked, so the page reads what the hooks make
// of them. BackupPage.test.tsx covers the exported pure helpers.
const h = vi.hoisted(() => ({
  user: { roleName: 'Administrador', accessType: 4 } as { roleName?: string; accessType?: number },
  performBackup: vi.fn(),
  listBackups: vi.fn(),
  restoreBackup: vi.fn(),
  getPolicy: vi.fn(),
  updatePolicy: vi.fn(),
}));

// The key itself, except the two slot keys the page fills in.
vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({
    t: (k: string) => {
      if (k === 'backup.restoreConfirm') return 'restore {fileName}?';
      if (k === 'backup.restoreError') return 'restore failed: {error}';
      return k;
    },
    language: 'pt-BR',
  }),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock('@/services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/api')>()),
  backupService: {
    performBackup: h.performBackup,
    listBackups: h.listBackups,
    restoreBackup: h.restoreBackup,
  },
  backupPolicyService: { getPolicy: h.getPolicy, updatePolicy: h.updatePolicy },
}));

import BackupPage from '@/views/BackupPage';

// useBackup unwraps response.data.data; useBackupPolicy reads response.data.data.
const env = (data: unknown) => ({ data: { data } });

const BACKUPS = [
  {
    fileName: 'small.sql.gz',
    path: '/b/small',
    size: 512,
    createdAt: '2026-01-02T03:04:05Z',
    modifiedAt: '2026-01-02T03:04:05Z',
    status: 'success',
    checksum: 'a'.repeat(64),
  },
  {
    fileName: 'mid.sql.gz',
    path: '/b/mid',
    size: 2048,
    createdAt: '2026-01-03T03:04:05Z',
    modifiedAt: '2026-01-03T03:04:05Z',
    status: null,
    checksum: null,
  },
  {
    fileName: 'big.sql.gz',
    path: '/b/big',
    size: 3 * 1024 * 1024,
    createdAt: '2026-01-04T03:04:05Z',
    modifiedAt: '2026-01-04T03:04:05Z',
    status: 'error',
    checksum: 'short',
  },
];

const POLICY = {
  cronExpression: '0 3 * * *',
  retentionDays: 30,
  encryptionEnabled: true,
  rpoHours: 24,
  rtoHours: 4,
  updatedAt: '2026-01-05T10:00:00Z',
};

const renderLoaded = async () => {
  render(<BackupPage />);
  await screen.findByText('small.sql.gz');
  await screen.findByLabelText('backup.policy.cronExpression');
};

beforeEach(() => {
  h.user = { roleName: 'Administrador', accessType: 4 };
  h.listBackups.mockResolvedValue(env(BACKUPS));
  h.getPolicy.mockResolvedValue(env(POLICY));
  h.performBackup.mockResolvedValue(env({ ok: true }));
  h.restoreBackup.mockResolvedValue(env({ ok: true }));
  h.updatePolicy.mockImplementation(async (draft: unknown) => env(draft));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  h.performBackup.mockReset();
  h.listBackups.mockReset();
  h.restoreBackup.mockReset();
  h.getPolicy.mockReset();
  h.updatePolicy.mockReset();
});

describe('BackupPage access', () => {
  it('shows the access-denied panel to a user who is not an administrator', () => {
    h.user = { roleName: 'Pesquisador', accessType: 2 };
    // The hooks still fetch on mount; keep both requests pending so no state
    // update lands after the assertions.
    h.listBackups.mockReturnValue(new Promise(() => {}));
    h.getPolicy.mockReturnValue(new Promise(() => {}));
    render(<BackupPage />);
    expect(screen.getByText('backup.accessDenied')).toBeInTheDocument();
    expect(screen.getByText('backup.accessDeniedMessage')).toBeInTheDocument();
    expect(screen.queryByText('backup.management')).not.toBeInTheDocument();
  });

  it('admits a user by access type 4 alone', async () => {
    h.user = { roleName: 'Outro', accessType: 4 };
    render(<BackupPage />);
    expect(await screen.findByText('small.sql.gz')).toBeInTheDocument();
  });

  it('admits a user by the Administrador role alone', async () => {
    h.user = { roleName: 'Administrador', accessType: 2 };
    render(<BackupPage />);
    expect(await screen.findByText('small.sql.gz')).toBeInTheDocument();
    expect(screen.queryByText('backup.accessDenied')).not.toBeInTheDocument();
  });
});

describe('BackupPage backup list', () => {
  it('renders each backup with its size, status badge and truncated checksum', async () => {
    await renderLoaded();

    const small = screen.getByText('small.sql.gz').closest('tr') as HTMLElement;
    expect(within(small).getByText('512 B')).toBeInTheDocument();
    expect(within(small).getByText('backup.statusSuccess')).toHaveAttribute('data-status', 'success');
    const checksumCell = within(small).getByText(`${'a'.repeat(12)}…`);
    expect(checksumCell).toHaveAttribute('title', 'a'.repeat(64));

    const mid = screen.getByText('mid.sql.gz').closest('tr') as HTMLElement;
    expect(within(mid).getByText('2.00 KB')).toBeInTheDocument();
    expect(within(mid).getByText('backup.statusUnknown')).toHaveAttribute('data-status', 'unknown');
    expect(within(mid).getByText('—')).not.toHaveAttribute('title');

    const big = screen.getByText('big.sql.gz').closest('tr') as HTMLElement;
    expect(within(big).getByText('3.00 MB')).toBeInTheDocument();
    expect(within(big).getByText('backup.statusError')).toBeInTheDocument();
    expect(within(big).getByText('short')).toBeInTheDocument();
  });

  it('shows the empty message when there are no backups', async () => {
    h.listBackups.mockResolvedValue(env([]));
    render(<BackupPage />);
    expect(await screen.findByText('backup.noBackups')).toBeInTheDocument();
  });

  it('shows the hook error and logs it when the list fails to load', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.listBackups.mockRejectedValue(new Error('list down'));
    render(<BackupPage />);
    expect(await screen.findByText('list down')).toBeInTheDocument();
    expect(screen.getByText('backup.noBackups')).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalledWith('Erro ao carregar backups:', expect.any(Error));
  });

  it('reloads the list from the refresh button', async () => {
    await renderLoaded();
    expect(h.listBackups).toHaveBeenCalledTimes(1);
    h.listBackups.mockResolvedValueOnce(env([{ ...BACKUPS[0], fileName: 'fresh.sql.gz' }]));
    fireEvent.click(screen.getByText('common.refresh'));
    expect(await screen.findByText('fresh.sql.gz')).toBeInTheDocument();
    expect(screen.queryByText('small.sql.gz')).not.toBeInTheDocument();
    expect(h.listBackups).toHaveBeenCalledTimes(2);
  });
});

describe('BackupPage create backup', () => {
  it('creates a backup, reloads the list and clears the success message after 3 s', async () => {
    await renderLoaded();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    h.listBackups.mockResolvedValueOnce(env([{ ...BACKUPS[0], fileName: 'new.sql.gz' }, ...BACKUPS]));

    fireEvent.click(screen.getByText('backup.create'));
    expect(await screen.findByText('backup.success')).toBeInTheDocument();
    expect(h.performBackup).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('new.sql.gz')).toBeInTheDocument();
    expect(h.listBackups).toHaveBeenCalledTimes(2);

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.queryByText('backup.success')).not.toBeInTheDocument();
  });

  it('shows the creating message while the backup runs', async () => {
    await renderLoaded();
    let finish: (v: unknown) => void = () => {};
    h.performBackup.mockReturnValue(new Promise((resolve) => (finish = resolve)));

    fireEvent.click(screen.getByText('backup.create'));
    expect(await screen.findByText('backup.creating')).toBeInTheDocument();
    expect(screen.getByText('backup.create').closest('button')).toBeDisabled();

    await act(async () => finish(env({ ok: true })));
    expect(await screen.findByText('backup.success')).toBeInTheDocument();
  });

  it('shows the error message when the backup fails and clears it after 3 s', async () => {
    await renderLoaded();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    h.performBackup.mockRejectedValue(new Error('disk full'));

    fireEvent.click(screen.getByText('backup.create'));
    expect(await screen.findByText('backup.error')).toBeInTheDocument();
    expect(screen.getByText('disk full')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.queryByText('backup.error')).not.toBeInTheDocument();
  });
});

describe('BackupPage restore', () => {
  const openRestore = async (fileName: string) => {
    await renderLoaded();
    const row = screen.getByText(fileName).closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByText('backup.restore'));
    return screen.findByRole('dialog');
  };

  it('opens the restore dialog with the chosen backup and closes it on cancel', async () => {
    const dialog = await openRestore('mid.sql.gz');
    expect(within(dialog).getByText('mid.sql.gz')).toBeInTheDocument();
    expect(within(dialog).getByText('backup.size: 2.00 KB')).toBeInTheDocument();
    expect(within(dialog).getByText('backup.restoreWarning')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByText('common.cancel'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('closes the restore dialog from its close control', async () => {
    const dialog = await openRestore('small.sql.gz');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('does nothing when the confirmation is declined', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const dialog = await openRestore('small.sql.gz');
    fireEvent.click(within(dialog).getByText('backup.confirmRestore'));
    expect(confirm).toHaveBeenCalledWith('restore small.sql.gz?');
    expect(h.restoreBackup).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('restores the confirmed backup, alerts success and closes the dialog', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const dialog = await openRestore('big.sql.gz');
    fireEvent.click(within(dialog).getByText('backup.confirmRestore'));

    await waitFor(() => expect(alert).toHaveBeenCalledWith('backup.restoreSuccess'));
    expect(h.restoreBackup).toHaveBeenCalledWith('big.sql.gz');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('alerts the error and keeps the dialog open when the restore fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    h.restoreBackup.mockRejectedValue(new Error('corrupt archive'));
    const dialog = await openRestore('small.sql.gz');
    fireEvent.click(within(dialog).getByText('backup.confirmRestore'));

    await waitFor(() => expect(alert).toHaveBeenCalledWith('restore failed: corrupt archive'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('BackupPage policy form', () => {
  it('shows the load message while the policy is loading and the hook error when it fails', async () => {
    h.getPolicy.mockRejectedValue(new Error('policy down'));
    render(<BackupPage />);
    expect(screen.getByText('backup.policy.loadError')).toBeInTheDocument();
    expect(await screen.findByText('policy down')).toBeInTheDocument();
    expect(screen.queryByLabelText('backup.policy.cronExpression')).not.toBeInTheDocument();
  });

  it('fills the form from the loaded policy, and says so when it was never updated', async () => {
    h.getPolicy.mockResolvedValue(env({ ...POLICY, updatedAt: null }));
    render(<BackupPage />);
    expect(await screen.findByLabelText('backup.policy.cronExpression')).toHaveValue('0 3 * * *');
    expect(screen.getByLabelText('backup.policy.retentionDays')).toHaveValue(30);
    expect(screen.getByLabelText('backup.policy.rpoHours')).toHaveValue(24);
    expect(screen.getByLabelText('backup.policy.rtoHours')).toHaveValue(4);
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(screen.getByText(/backup\.policy\.neverUpdated/)).toBeInTheDocument();
  });

  it('saves the edited policy and clears the success message after 3 s', async () => {
    await renderLoaded();
    expect(screen.queryByText(/backup\.policy\.neverUpdated/)).not.toBeInTheDocument();
    vi.useFakeTimers({ shouldAdvanceTime: true });

    fireEvent.change(screen.getByLabelText('backup.policy.cronExpression'), { target: { value: '0 4 * * *' } });
    fireEvent.change(screen.getByLabelText('backup.policy.retentionDays'), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByLabelText('backup.policy.rpoHours'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('backup.policy.rtoHours'), { target: { value: '6' } });
    fireEvent.click(screen.getByText('backup.policy.save'));

    expect(await screen.findByText('backup.policy.saveSuccess')).toBeInTheDocument();
    expect(h.updatePolicy).toHaveBeenCalledWith({
      ...POLICY,
      cronExpression: '0 4 * * *',
      retentionDays: 60,
      encryptionEnabled: false,
      rpoHours: 12,
      rtoHours: 6,
    });

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.queryByText('backup.policy.saveSuccess')).not.toBeInTheDocument();
  });

  it('blocks the save and lists the field errors for an invalid draft', async () => {
    await renderLoaded();
    fireEvent.change(screen.getByLabelText('backup.policy.cronExpression'), { target: { value: '0 3' } });
    fireEvent.change(screen.getByLabelText('backup.policy.retentionDays'), { target: { value: '29' } });
    fireEvent.change(screen.getByLabelText('backup.policy.rpoHours'), { target: { value: '25' } });
    fireEvent.change(screen.getByLabelText('backup.policy.rtoHours'), { target: { value: '13' } });
    fireEvent.click(screen.getByText('backup.policy.save'));

    const errors = [
      'cronExpression deve ser uma expressão cron de 5 campos',
      'retentionDays deve ser um número >= 30 (RNF010 AC#4)',
      'rpoHours deve ser um número entre 1 e 24 (RNF010 AC#2)',
      'rtoHours deve ser um número entre 1 e 12 (RNF010 AC#3)',
    ].join('; ');
    expect(await screen.findByText(errors)).toBeInTheDocument();
    expect(h.updatePolicy).not.toHaveBeenCalled();

    // Fixing the draft and saving again clears the banner.
    fireEvent.change(screen.getByLabelText('backup.policy.cronExpression'), { target: { value: '0 3 * * *' } });
    fireEvent.change(screen.getByLabelText('backup.policy.retentionDays'), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText('backup.policy.rpoHours'), { target: { value: '24' } });
    fireEvent.change(screen.getByLabelText('backup.policy.rtoHours'), { target: { value: '4' } });
    fireEvent.click(screen.getByText('backup.policy.save'));

    expect(await screen.findByText('backup.policy.saveSuccess')).toBeInTheDocument();
    expect(screen.queryByText(errors)).not.toBeInTheDocument();
    expect(h.updatePolicy).toHaveBeenCalledTimes(1);
  });

  it('shows the save error and the service message when the save fails, then clears the status after 3 s', async () => {
    await renderLoaded();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    h.updatePolicy.mockRejectedValue({ response: { data: { details: ['retentionDays too low'] } } });

    fireEvent.click(screen.getByText('backup.policy.save'));
    expect(await screen.findByText('backup.policy.saveError')).toBeInTheDocument();
    expect(screen.getByText('retentionDays too low')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.queryByText('backup.policy.saveError')).not.toBeInTheDocument();
  });
});
