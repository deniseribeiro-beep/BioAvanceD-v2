import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConfigurationReleasesPanel from './ConfigurationReleasesPanel';
import { securityService } from '../../services/api';

vi.mock('../../services/api', () => ({
  securityService: {
    getReleases: vi.fn(),
    rollbackConfig: vi.fn(),
  },
}));

// RF014 AC4: the release list, newest first, and the governed rollback.
const t = (key: string, fallback?: string) => (key.startsWith('security.releases.statuses.') && fallback ? `status:${fallback}` : key);

const release = (id: string, version: string, status: string, extra = {}) => ({
  configurationReleaseId: id,
  semanticVersion: version,
  status,
  approvedBy: 'admin',
  effectivePeriod: { start: '2026-10-07T12:00:00.000Z', end: null },
  rollbackTargetId: null,
  ...extra,
});

const getReleases = vi.mocked(securityService.getReleases);
const rollbackConfig = vi.mocked(securityService.rollbackConfig);

describe('ConfigurationReleasesPanel', () => {
  beforeEach(() => {
    getReleases.mockReset();
    rollbackConfig.mockReset();
  });

  it('lists the releases newest first, and offers rollback only on a superseded one', async () => {
    getReleases.mockResolvedValue({ data: { data: [
      release('r3', '3.0.0', 'draft'),
      release('r2', '2.0.0', 'active'),
      release('r1', '1.0.0', 'superseded'),
    ] } } as never);
    render(<ConfigurationReleasesPanel t={t} showToast={vi.fn()} onRolledBack={vi.fn()} />);

    const rows = await screen.findAllByTestId('security-release-row');
    expect(rows.map((row) => row.getAttribute('data-status'))).toEqual(['draft', 'active', 'superseded']);
    expect(rows.map((row) => within(row).getByTestId('security-release-version').textContent)).toEqual(['3.0.0', '2.0.0', '1.0.0']);
    expect(within(rows[0]).queryByTestId('security-release-rollback')).toBeNull();
    expect(within(rows[1]).queryByTestId('security-release-rollback')).toBeNull();
    expect(within(rows[2]).getByTestId('security-release-rollback')).toBeEnabled();
  });

  it('a rollback posts the release, reloads the list and the configuration, and names the version restored', async () => {
    getReleases
      .mockResolvedValueOnce({ data: { data: [release('r2', '2.0.0', 'active'), release('r1', '1.0.0', 'superseded')] } } as never)
      .mockResolvedValueOnce({ data: { data: [
        release('r3', '3.0.0', 'active', { rollbackTargetId: 'r1' }),
        release('r2', '2.0.0', 'superseded'),
        release('r1', '1.0.0', 'superseded'),
      ] } } as never);
    rollbackConfig.mockResolvedValue({ data: { data: {} } } as never);
    const onRolledBack = vi.fn();
    const showToast = vi.fn();
    render(<ConfigurationReleasesPanel t={t} showToast={showToast} onRolledBack={onRolledBack} />);

    await userEvent.click(await screen.findByTestId('security-release-rollback'));

    expect(rollbackConfig).toHaveBeenCalledWith('r1');
    await waitFor(() => expect(onRolledBack).toHaveBeenCalledTimes(1));
    const rows = screen.getAllByTestId('security-release-row');
    expect(within(rows[0]).getByTestId('security-release-restores').textContent).toBe('1.0.0');
    expect(showToast).toHaveBeenCalledWith('security.releases.rollbackSuccess', 'success');
  });

  it('a refused rollback shows the server\'s message and reloads nothing', async () => {
    getReleases.mockResolvedValue({ data: { data: [release('r2', '2.0.0', 'active'), release('r1', '1.0.0', 'superseded')] } } as never);
    rollbackConfig.mockRejectedValue({ response: { data: { message: 'A release ativa não pode ser restaurada' } } });
    const onRolledBack = vi.fn();
    const showToast = vi.fn();
    render(<ConfigurationReleasesPanel t={t} showToast={showToast} onRolledBack={onRolledBack} />);

    await userEvent.click(await screen.findByTestId('security-release-rollback'));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('A release ativa não pode ser restaurada', 'error'));
    expect(onRolledBack).not.toHaveBeenCalled();
    expect(getReleases).toHaveBeenCalledTimes(1);
  });

  it('says so when the list cannot be loaded', async () => {
    getReleases.mockRejectedValue(new Error('500'));
    render(<ConfigurationReleasesPanel t={t} showToast={vi.fn()} onRolledBack={vi.fn()} />);

    expect(await screen.findByTestId('security-releases-error')).toHaveTextContent('security.releases.loadError');
    expect(screen.queryAllByTestId('security-release-row')).toHaveLength(0);
  });
});
