import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import SettingCatalogPanel, { formatAllowed } from './SettingCatalogPanel';
import { securityService } from '../../services/api';

vi.mock('../../services/api', () => ({
  securityService: {
    getCatalog: vi.fn(),
  },
}));

// RF014 AC1: the setting catalog, one row per key with its allowed values.
const t = (key: string) => key;

const entry = (path: string, allowedValues: object, extra = {}) => ({
  path,
  type: 'number',
  scope: 'environment',
  allowedValues,
  default: 5,
  dependencies: [],
  owner: 'role:administrator',
  validity: 'ConfigurationRelease.effectivePeriod',
  ...extra,
});

const getCatalog = vi.mocked(securityService.getCatalog);

describe('SettingCatalogPanel', () => {
  beforeEach(() => {
    getCatalog.mockReset();
  });

  it('formats a range as min..max', () => {
    expect(formatAllowed({ kind: 'range', min: 1, max: 10 }, t)).toBe('1..10');
  });

  it('formats a fixed value with its invariant', () => {
    expect(formatAllowed({ kind: 'fixed', value: true, invariantId: 'INV-AUDIT-001' }, t)).toBe('= true (INV-AUDIT-001)');
  });

  it('lists one row per catalog entry with its path and allowed values', async () => {
    getCatalog.mockResolvedValue({ data: { data: {
      catalogVersion: '1.0.0',
      settings: [
        entry('authentication.requireMFA', { kind: 'enum', values: [true, false] }, { type: 'boolean', default: true }),
        entry('authentication.maxLoginAttempts', { kind: 'range', min: 1, max: 10 }),
      ],
    } } } as never);
    render(<SettingCatalogPanel t={t} />);

    const rows = await screen.findAllByTestId('security-catalog-row');
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.getAttribute('data-path'))).toEqual(['authentication.requireMFA', 'authentication.maxLoginAttempts']);
    expect(within(rows[1]).getByTestId('security-catalog-allowed')).toHaveTextContent('1..10');
    expect(screen.getByTestId('security-catalog-version')).toHaveTextContent('1.0.0');
  });

  it('shows the load error when the catalog cannot be read', async () => {
    getCatalog.mockRejectedValue(new Error('500'));
    render(<SettingCatalogPanel t={t} />);

    expect(await screen.findByTestId('security-catalog-error')).toHaveTextContent('security.catalog.loadError');
    expect(screen.queryAllByTestId('security-catalog-row')).toHaveLength(0);
  });
});
