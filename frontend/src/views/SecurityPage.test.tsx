import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SecurityPage from './SecurityPage';
import type { SecurityConfig, ProfilePermissions } from '../hooks/useSecurity';

// The governed-by-policy line carries a {{version}} slot the page fills in.
vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({
    t: (k: string, fb?: string) =>
      k === 'security.logging.governedByPolicy' ? 'policy {{version}}' : fb ?? k,
    language: 'pt-BR',
  }),
}));

const auth: { user: any; isLoading: boolean; roles: string[] } = { user: null, isLoading: false, roles: [] };
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: auth.user,
    isLoading: auth.isLoading,
    hasRole: (r: string) => auth.roles.includes(r),
  }),
}));

const showToast = vi.fn();
vi.mock('../components/UI/ToastContainer', () => ({
  useToast: () => ({ showToast }),
}));

const sec = {
  config: null as SecurityConfig | null,
  permissions: null as ProfilePermissions | null,
  loading: false,
  error: null as string | null,
  saving: false,
  loadConfig: vi.fn(),
  updateConfig: vi.fn(),
  exportLogs: vi.fn(),
};
vi.mock('../hooks/useSecurity', () => ({
  useSecurity: () => sec,
}));

// The releases panel has its own service calls; the stub exposes the callback the page passes.
vi.mock('../components/security/ConfigurationReleasesPanel', () => ({
  default: ({ onRolledBack }: { onRolledBack: () => void }) => (
    <button data-testid="releases-stub" onClick={onRolledBack}>releases</button>
  ),
}));

// The catalog panel reads its own service; the page only mounts it.
vi.mock('../components/security/SettingCatalogPanel', () => ({
  default: () => <div data-testid="catalog-stub">catalog</div>,
}));

function makeConfig(): SecurityConfig {
  return {
    authentication: {
      requireMFA: false,
      mfaMethod: 'totp',
      allowPasswordReset: true,
      maxLoginAttempts: 5,
      lockoutDurationMinutes: 30,
      requireStrongPassword: true,
    },
    passwordRules: {
      minLength: 12,
      requireUppercase: true,
      requireLowercase: true,
      requireNumbers: true,
      requireSpecialChars: true,
      expirationDays: 90,
      preventReuse: false,
      maxReuseHistory: 5,
    },
    session: { timeoutMinutes: 30, maxSessionDurationHours: 12, allowMultipleSessions: false },
    loginAttempts: { maxAttempts: 5, lockoutDurationMinutes: 30, trackIP: false, blockIPAfterAttempts: 10 },
    logging: { level: 'info', logLoginAttempts: true, logAllActions: true, retentionDays: 365 },
    privacy: {
      anonymizeLogs: true,
      dataRetentionDays: null,
      autoPurge: false,
      purgeAfterDays: null,
      anonymizeAfterDays: null,
    },
    enhancedSecurity: {
      enabled: false,
      requireMFAForAll: false,
      strictPasswordPolicy: false,
      sessionTimeoutMinutes: 15,
      logAllActions: false,
      blockUnusualActivity: false,
    },
    lgpd: {
      allowDataExport: true,
      allowDataDeletion: true,
      anonymizeOnExport: true,
      requireConsent: false,
      consentExpirationDays: null,
    },
  };
}

const PERMISSIONS: ProfilePermissions = {
  roles: [
    { roleCode: 'administrator', displayName: 'Admin stored', hierarchyLevel: 4, permissionCodes: ['samples.read', 'users.manage'] },
    { roleCode: 'auditor', displayName: 'Auditor', hierarchyLevel: null, permissionCodes: ['samples.read'] },
    { roleCode: 'ghost', displayName: '', hierarchyLevel: null, permissionCodes: [] },
  ],
  permissions: [
    { permissionCode: 'samples.read', displayName: 'Ler amostras', resourceType: 'sample', allowedActions: ['read'] },
    { permissionCode: 'users.manage', displayName: '', resourceType: 'user', allowedActions: ['manage'] },
  ],
};

function input(text: string): HTMLInputElement {
  const host = screen.getByText(text).closest('label.config-switch, .config-field') as HTMLElement;
  return host.querySelector('input, select') as HTMLInputElement;
}

function open(section: string) {
  fireEvent.click(screen.getByTestId(`security-nav-${section}`));
}

beforeEach(() => {
  auth.user = { roleName: 'Administrador', accessType: 4 };
  auth.isLoading = false;
  auth.roles = ['Administrador'];
  sec.config = makeConfig();
  sec.permissions = PERMISSIONS;
  sec.loading = false;
  sec.error = null;
  sec.saving = false;
  sec.loadConfig = vi.fn();
  sec.updateConfig = vi.fn().mockResolvedValue(undefined);
  sec.exportLogs = vi.fn();
  showToast.mockReset();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('SecurityPage access and loading', () => {
  it('shows the loading line while auth is loading', () => {
    auth.isLoading = true;
    render(<SecurityPage />);
    expect(screen.getByText('Carregando...')).toBeInTheDocument();
    expect(screen.queryByTestId('security-page')).toBeNull();
  });

  it('denies a user who is neither Administrador nor access type 4', () => {
    auth.user = { roleName: 'Técnico', accessType: 2 };
    auth.roles = [];
    render(<SecurityPage />);
    expect(screen.getByTestId('security-access-denied')).toHaveTextContent('security.accessDenied');
    expect(screen.queryByTestId('security-nav-authentication')).toBeNull();
  });

  it('admits access type 4 without the Administrador role', () => {
    auth.user = { roleName: 'Outro', accessType: 4 };
    auth.roles = [];
    render(<SecurityPage />);
    expect(screen.getByText('security.title')).toBeInTheDocument();
  });

  it('shows the hook loading line, then the load error when config is missing', () => {
    sec.loading = true;
    const { unmount } = render(<SecurityPage />);
    expect(screen.getByText('security.loading')).toBeInTheDocument();
    unmount();
    // localConfig keeps the last config it saw, so the missing-config line needs a fresh mount.
    sec.loading = false;
    sec.config = null;
    render(<SecurityPage />);
    expect(screen.getByText('security.loadError')).toBeInTheDocument();
  });

  it('shows the hook error above the sections', () => {
    sec.error = 'falha ao carregar';
    render(<SecurityPage />);
    expect(screen.getByText('falha ao carregar')).toBeInTheDocument();
  });
});

describe('SecurityPage authentication and saving', () => {
  it('saves the edited authentication settings and shows the success banner until it times out', async () => {
    vi.useFakeTimers();
    render(<SecurityPage />);
    fireEvent.click(screen.getByTestId('security-require-mfa-toggle'));
    fireEvent.change(input('security.authentication.maxLoginAttempts'), { target: { value: '7' } });
    fireEvent.click(input('security.authentication.allowPasswordReset'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('security-save-config-button'));
    });
    expect(sec.updateConfig).toHaveBeenCalledTimes(1);
    const saved = sec.updateConfig.mock.calls[0][0] as SecurityConfig;
    expect(saved.authentication.requireMFA).toBe(true);
    expect(saved.authentication.maxLoginAttempts).toBe(7);
    expect(saved.authentication.allowPasswordReset).toBe(false);
    expect(showToast).toHaveBeenCalledWith('security.saveSuccess', 'success');
    expect(document.querySelector('.security-success')).toHaveTextContent('security.saveSuccess');
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(document.querySelector('.security-success')).toBeNull();
  });

  it('toasts the rejection message, or the fallback for a non-Error rejection', async () => {
    sec.updateConfig = vi.fn().mockRejectedValueOnce(new Error('sem permissão')).mockRejectedValueOnce('x');
    render(<SecurityPage />);
    fireEvent.click(screen.getByTestId('security-save-config-button'));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('sem permissão', 'error'));
    fireEvent.click(screen.getByTestId('security-save-config-button'));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('security.saveError', 'error'));
    expect(document.querySelector('.security-success')).toBeNull();
  });

  it('labels the save button and disables it while saving', () => {
    sec.saving = true;
    render(<SecurityPage />);
    const button = screen.getByTestId('security-save-config-button');
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('users.saving');
  });
});

describe('SecurityPage sections', () => {
  it('password: the MFA floor falls back to minLength and reuse history shows only with preventReuse', async () => {
    render(<SecurityPage />);
    open('password');
    expect(input('security.password.minLengthWithMFA').value).toBe('12');
    expect(screen.queryByText('security.password.maxReuseHistory')).toBeNull();
    fireEvent.click(input('security.password.preventReuse'));
    fireEvent.change(input('security.password.maxReuseHistory'), { target: { value: '8' } });
    fireEvent.change(input('security.password.minLength'), { target: { value: '14' } });
    fireEvent.click(screen.getByRole('button', { name: /common.save/ }));
    await waitFor(() => expect(sec.updateConfig).toHaveBeenCalledTimes(1));
    const saved = sec.updateConfig.mock.calls[0][0] as SecurityConfig;
    expect(saved.passwordRules).toMatchObject({ preventReuse: true, maxReuseHistory: 8, minLength: 14 });
  });

  it('session: autoRenewal and logExpiration read checked when absent', async () => {
    render(<SecurityPage />);
    open('session');
    expect(input('security.session.autoRenewal').checked).toBe(true);
    expect(input('security.session.logExpiration').checked).toBe(true);
    fireEvent.click(input('security.session.autoRenewal'));
    fireEvent.change(input('security.session.timeoutMinutes'), { target: { value: '45' } });
    fireEvent.click(screen.getByRole('button', { name: /common.save/ }));
    await waitFor(() => expect(sec.updateConfig).toHaveBeenCalledTimes(1));
    expect((sec.updateConfig.mock.calls[0][0] as SecurityConfig).session).toMatchObject({
      autoRenewal: false,
      timeoutMinutes: 45,
    });
  });

  it('login: the IP block field and its help show only while trackIP is on', () => {
    render(<SecurityPage />);
    open('login');
    expect(screen.queryByTestId('security-ip-block-help')).toBeNull();
    fireEvent.click(input('security.login.trackIP'));
    expect(screen.getByTestId('security-ip-block-help')).toHaveTextContent('security.login.blockIPAfterAttemptsHelp');
    fireEvent.click(input('security.login.trackIP'));
    expect(screen.queryByTestId('security-ip-block-help')).toBeNull();
  });

  it('logging: governed keys render disabled with the line naming why', () => {
    const config = makeConfig();
    config.governedBy = {
      'logging.logAllActions': { entity: 'AuditLog', policyId: null, version: null, fixed: 'audit-required' },
      'logging.retentionDays': { entity: 'AuditLog', policyId: 'p-1', version: '3' },
      'privacy.anonymizeLogs': { entity: 'AuditLog', policyId: null, version: null, unavailable: true },
      'privacy.dataRetentionDays': { entity: 'Sample', policyId: null, version: null },
    };
    sec.config = config;
    render(<SecurityPage />);
    open('logging');
    expect(screen.getByTestId('security-logging-fixed-help')).toHaveTextContent('security.logging.fixedAuditRequired');
    expect(screen.getByTestId('security-retention-governed-help')).toHaveTextContent('policy 3');
    expect(input('security.logging.logAllActions')).toBeDisabled();
    expect(input('security.logging.retentionDays')).toBeDisabled();
    expect(input('security.logging.logLoginAttempts')).not.toBeDisabled();
    open('privacy');
    expect(screen.getByText('security.logging.governedUnavailable')).toBeInTheDocument();
    expect(screen.getByTestId('security-privacy-fixed-help')).toHaveTextContent('security.logging.governedNoPolicy');
    expect(input('security.privacy.dataRetentionDays').value).toBe('');
  });

  it('logging: exports CSV and JSON with the chosen filters', async () => {
    const createObjectURL = vi.fn(() => 'blob:x');
    const revokeObjectURL = vi.fn();
    Object.assign(window.URL, { createObjectURL, revokeObjectURL });
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });
    sec.exportLogs = vi.fn().mockResolvedValueOnce({ data: 'a,b\n1,2' }).mockResolvedValueOnce({ data: [{ a: 1 }] });
    render(<SecurityPage />);
    open('logging');
    fireEvent.change(screen.getByTestId('security-log-filter-severity'), { target: { value: 'error' } });
    fireEvent.change(screen.getByTestId('security-log-filter-module'), { target: { value: 'auth' } });
    fireEvent.change(screen.getByTestId('security-log-filter-start-date'), { target: { value: '2026-01-01' } });
    fireEvent.change(screen.getByTestId('security-log-filter-end-date'), { target: { value: '2026-01-31' } });
    fireEvent.click(screen.getByTestId('security-export-logs-csv-button'));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('security.logging.exportSuccess', 'success'));
    const filters = { severity: 'error', module: 'auth', startDate: '2026-01-01', endDate: '2026-01-31' };
    expect(sec.exportLogs).toHaveBeenCalledWith(filters, 'csv');
    expect((createObjectURL.mock.calls[0] as unknown as [Blob])[0].type).toBe('text/csv;charset=utf-8');
    fireEvent.click(screen.getByTestId('security-export-logs-json-button'));
    await waitFor(() => expect(sec.exportLogs).toHaveBeenCalledWith(filters, 'json'));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(2));
    expect((createObjectURL.mock.calls[1] as unknown as [Blob])[0].type).toBe('application/json;charset=utf-8');
    expect(downloads).toHaveLength(2);
    expect(downloads[0]).toMatch(/^logs_\d{4}-\d{2}-\d{2}\.csv$/);
    expect(downloads[1]).toMatch(/\.json$/);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:x');
  });

  it('logging: an export failure toasts its message, or the fallback', async () => {
    sec.exportLogs = vi.fn().mockRejectedValueOnce(new Error('export caiu')).mockRejectedValueOnce({});
    render(<SecurityPage />);
    open('logging');
    fireEvent.click(screen.getByTestId('security-export-logs-csv-button'));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('export caiu', 'error'));
    fireEvent.click(screen.getByTestId('security-export-logs-json-button'));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('security.exportError', 'error'));
  });

  it('logging: the minimum level select and save button save the level', async () => {
    render(<SecurityPage />);
    open('logging');
    fireEvent.change(input('security.logging.minLevel'), { target: { value: 'critical' } });
    fireEvent.click(input('security.logging.logLoginAttempts'));
    fireEvent.click(screen.getByTestId('security-save-logging-config-button'));
    await waitFor(() => expect(sec.updateConfig).toHaveBeenCalledTimes(1));
    expect((sec.updateConfig.mock.calls[0][0] as SecurityConfig).logging).toMatchObject({
      level: 'critical',
      logLoginAttempts: false,
    });
  });

  it('permissions: lists every role read-only, localized by roleCode or by stored name', () => {
    render(<SecurityPage />);
    open('permissions');
    expect(screen.getByTestId('security-permissions-readonly-note')).toHaveTextContent('security.permissions.readOnlyNote');
    expect(screen.getByTestId('security-permission-role-administrator')).toHaveTextContent('roles.administrator');
    expect(screen.getByTestId('security-permission-role-auditor')).toHaveTextContent('Auditor');
    expect(screen.getByTestId('security-permission-role-ghost').querySelector('h3')).toHaveTextContent('ghost');
    const granted = screen.getByTestId('security-permission-toggle-administrator-users.manage') as HTMLInputElement;
    expect(granted.checked).toBe(true);
    expect(granted).toBeDisabled();
    expect((screen.getByTestId('security-permission-toggle-auditor-users.manage') as HTMLInputElement).checked).toBe(false);
    expect(screen.getAllByText('users.manage').length).toBeGreaterThan(0);
  });

  it('privacy: purge and anonymize periods show only with autoPurge', () => {
    render(<SecurityPage />);
    open('privacy');
    expect(screen.queryByText('security.privacy.purgeAfterDays')).toBeNull();
    fireEvent.click(input('security.privacy.autoPurge'));
    fireEvent.change(input('security.privacy.purgeAfterDays'), { target: { value: '120' } });
    fireEvent.change(input('security.privacy.anonymizeAfterDays'), { target: { value: '60' } });
    expect(input('security.privacy.purgeAfterDays').value).toBe('120');
    expect(input('security.privacy.anonymizeAfterDays').value).toBe('60');
  });

  it('enhanced: the sub-settings show only once enhanced mode is on', async () => {
    render(<SecurityPage />);
    open('enhanced');
    expect(screen.queryByText('security.enhanced.requireMFAForAll')).toBeNull();
    fireEvent.click(input('security.enhanced.enable'));
    fireEvent.click(input('security.enhanced.requireMFAForAll'));
    fireEvent.change(input('security.enhanced.sessionTimeoutMinutes'), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: /common.save/ }));
    await waitFor(() => expect(sec.updateConfig).toHaveBeenCalledTimes(1));
    expect((sec.updateConfig.mock.calls[0][0] as SecurityConfig).enhancedSecurity).toMatchObject({
      enabled: true,
      requireMFAForAll: true,
      sessionTimeoutMinutes: 20,
    });
  });

  it('lgpd: consent expiry shows only with requireConsent, with its fixed help', () => {
    const config = makeConfig();
    config.governedBy = {
      'lgpd.anonymizeOnExport': { entity: 'Export', policyId: null, version: null, fixed: 'export-pseudonymised' },
      'lgpd.consentExpirationDays': { entity: 'Consent', policyId: null, version: null, fixed: 'consent-no-expiry' },
    };
    sec.config = config;
    render(<SecurityPage />);
    open('lgpd');
    expect(screen.getByTestId('security-export-fixed-help')).toHaveTextContent('security.logging.fixedExportPseudonymised');
    expect(input('security.lgpd.anonymizeOnExport')).toBeDisabled();
    expect(screen.queryByTestId('security-lgpd-fixed-help')).toBeNull();
    fireEvent.click(input('security.lgpd.requireConsent'));
    expect(screen.getByTestId('security-lgpd-fixed-help')).toHaveTextContent('security.logging.fixedConsentNoExpiry');
    expect(input('security.lgpd.consentExpirationDays')).toBeDisabled();
  });

  it('releases: the panel rolls back through loadConfig; policies render the static guide', () => {
    render(<SecurityPage />);
    open('releases');
    fireEvent.click(screen.getByTestId('releases-stub'));
    expect(sec.loadConfig).toHaveBeenCalledTimes(1);
    open('policies');
    expect(screen.getByText('Políticas e Diretrizes de Segurança do Sistema')).toBeInTheDocument();
    expect(screen.getByText('8. Especificações Técnicas')).toBeInTheDocument();
  });

  it('catalog: its nav button opens the setting catalog panel', () => {
    render(<SecurityPage />);
    expect(screen.queryByTestId('catalog-stub')).toBeNull();
    open('catalog');
    expect(screen.getByTestId('catalog-stub')).toBeInTheDocument();
  });

  it('a refused save shows the server message in the error banner', () => {
    sec.error = 'Configurações inválidas: x';
    render(<SecurityPage />);
    expect(screen.getByTestId('security-error')).toHaveTextContent('Configurações inválidas: x');
  });
});

// Each editable field writes its own config path; one save per section reads them all back.
type Edit = [label: string, value: 'toggle' | string, path: string, expected: unknown];
const SECTION_EDITS: [section: string, edits: Edit[]][] = [
  ['authentication', [
    ['security.authentication.requireStrongPassword', 'toggle', 'authentication.requireStrongPassword', false],
    ['security.authentication.lockoutDuration', '45', 'authentication.lockoutDurationMinutes', 45],
  ]],
  ['password', [
    ['security.password.minLengthWithMFA', '10', 'passwordRules.minLengthWithMFA', 10],
    ['security.password.requireUppercase', 'toggle', 'passwordRules.requireUppercase', false],
    ['security.password.requireLowercase', 'toggle', 'passwordRules.requireLowercase', false],
    ['security.password.requireNumbers', 'toggle', 'passwordRules.requireNumbers', false],
    ['security.password.requireSpecialChars', 'toggle', 'passwordRules.requireSpecialChars', false],
    ['security.password.expirationDays', '60', 'passwordRules.expirationDays', 60],
  ]],
  ['session', [
    ['security.session.maxDuration', '8', 'session.maxSessionDurationHours', 8],
    ['security.session.allowMultipleSessions', 'toggle', 'session.allowMultipleSessions', true],
    ['security.session.logExpiration', 'toggle', 'session.logExpiration', false],
  ]],
  ['login', [
    ['security.login.maxAttempts', '3', 'authentication.maxLoginAttempts', 3],
    ['security.login.lockoutDuration', '60', 'authentication.lockoutDurationMinutes', 60],
    ['security.login.trackIP', 'toggle', 'loginAttempts.trackIP', true],
    ['security.login.blockIPAfterAttempts', '20', 'loginAttempts.blockIPAfterAttempts', 20],
  ]],
  ['logging', [
    ['security.logging.logAllActions', 'toggle', 'logging.logAllActions', false],
    ['security.logging.retentionDays', '730', 'logging.retentionDays', 730],
  ]],
  ['privacy', [
    ['security.privacy.anonymizeLogs', 'toggle', 'privacy.anonymizeLogs', false],
    ['security.privacy.dataRetentionDays', '400', 'privacy.dataRetentionDays', 400],
    ['security.privacy.autoPurge', 'toggle', 'privacy.autoPurge', true],
    ['security.privacy.purgeAfterDays', '120', 'privacy.purgeAfterDays', 120],
  ]],
  ['enhanced', [
    ['security.enhanced.enable', 'toggle', 'enhancedSecurity.enabled', true],
    ['security.enhanced.strictPasswordPolicy', 'toggle', 'enhancedSecurity.strictPasswordPolicy', true],
    ['security.enhanced.logAllActions', 'toggle', 'enhancedSecurity.logAllActions', true],
    ['security.enhanced.blockUnusualActivity', 'toggle', 'enhancedSecurity.blockUnusualActivity', true],
  ]],
  ['lgpd', [
    ['security.lgpd.allowDataExport', 'toggle', 'lgpd.allowDataExport', false],
    ['security.lgpd.allowDataDeletion', 'toggle', 'lgpd.allowDataDeletion', false],
    ['security.lgpd.anonymizeOnExport', 'toggle', 'lgpd.anonymizeOnExport', false],
    ['security.lgpd.requireConsent', 'toggle', 'lgpd.requireConsent', true],
    ['security.lgpd.consentExpirationDays', '365', 'lgpd.consentExpirationDays', 365],
  ]],
];

describe('SecurityPage field edits', () => {
  it.each(SECTION_EDITS)('%s: every field edit reaches the saved config', async (section, edits) => {
    render(<SecurityPage />);
    open('password');
    open(section);
    for (const [label, value] of edits) {
      if (value === 'toggle') fireEvent.click(input(label));
      else fireEvent.change(input(label), { target: { value } });
    }
    const save = section === 'logging'
      ? screen.getByTestId('security-save-logging-config-button')
      : screen.getByRole('button', { name: /common.save/ });
    fireEvent.click(save);
    await waitFor(() => expect(sec.updateConfig).toHaveBeenCalledTimes(1));
    const saved = sec.updateConfig.mock.calls[0][0] as unknown as Record<string, Record<string, unknown>>;
    for (const [, , path, expected] of edits) {
      const [group, key] = path.split('.');
      expect(saved[group][key], path).toBe(expected);
    }
  });

  it('disables every section save button while saving', () => {
    sec.saving = true;
    render(<SecurityPage />);
    for (const section of ['password', 'session', 'login', 'logging', 'privacy', 'enhanced', 'lgpd']) {
      open(section);
      const save = screen.getByRole('button', { name: /users.saving/ });
      expect(save, section).toBeDisabled();
    }
  });

  it('shows the load error when permissions are missing', () => {
    sec.permissions = null;
    render(<SecurityPage />);
    expect(screen.getByText('security.loadError')).toBeInTheDocument();
  });

  it('governed help: an unknown fixed reason and a policy with no version read empty', () => {
    const config = makeConfig();
    config.logging.retentionDays = null;
    config.governedBy = {
      'logging.logAllActions': { entity: 'AuditLog', policyId: null, version: null, fixed: 'bogus' as never },
      'logging.retentionDays': { entity: 'AuditLog', policyId: 'p-2', version: null },
    };
    sec.config = config;
    render(<SecurityPage />);
    open('logging');
    expect(screen.getByTestId('security-logging-fixed-help')).toHaveTextContent(/^$/);
    expect(screen.getByTestId('security-retention-governed-help')).toHaveTextContent(/^policy\s*$/);
    expect(input('security.logging.retentionDays').value).toBe('');
  });
});
