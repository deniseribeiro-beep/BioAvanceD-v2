import { useState, useEffect } from 'react';
import Card from '../components/UI/Card';
import Button from '../components/UI/Button';
import { Shield, Save, Download, AlertCircle, CheckCircle } from 'lucide-react';
import { useSecurity, SecurityConfig, ProfilePermissions } from '../hooks/useSecurity';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useToast } from '../components/UI/ToastContainer';
import ConfigurationReleasesPanel from '../components/security/ConfigurationReleasesPanel';
import SettingCatalogPanel from '../components/security/SettingCatalogPanel';

// #1248: the retention keys are decided by the active RetentionPolicy, so
// they render read-only with a line naming it.
type GovernedSource = NonNullable<SecurityConfig['governedBy']>[string];
// #1260, #1261: a key whose behaviour is fixed names why.
const FIXED_HELP_KEYS: Record<string, string> = {
  'audit-required': 'security.logging.fixedAuditRequired',
  'always-anonymized': 'security.logging.fixedAlwaysAnonymized',
  'not-applied': 'security.logging.fixedNotApplied',
  'consent-required': 'security.logging.fixedConsentRequired',
  'consent-no-expiry': 'security.logging.fixedConsentNoExpiry',
  'export-pseudonymised': 'security.logging.fixedExportPseudonymised',
};
function retentionGovernedHelp(t: (key: string, fallback?: string) => string, source?: GovernedSource): string {
  if (!source) return '';
  if (source.fixed) return FIXED_HELP_KEYS[source.fixed] ? t(FIXED_HELP_KEYS[source.fixed]) : '';
  if (source.unavailable) return t('security.logging.governedUnavailable');
  if (!source.policyId) return t('security.logging.governedNoPolicy');
  return t('security.logging.governedByPolicy').replace('{{version}}', source.version ?? '');
}

export default function SecurityPage() {
  const { user, isLoading: authLoading, hasRole } = useAuth();
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { config, permissions, loading, error, saving, loadConfig, updateConfig, exportLogs } = useSecurity();
  const [localConfig, setLocalConfig] = useState<SecurityConfig | null>(null);
  const [localPermissions, setLocalPermissions] = useState<ProfilePermissions | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [activeSection, setActiveSection] = useState<string>('authentication');
  const [logFilters, setLogFilters] = useState({
    severity: '',
    module: '',
    startDate: '',
    endDate: ''
  });

  useEffect(() => {
    if (config) {
      setLocalConfig(config);
    }
  }, [config]);

  useEffect(() => {
    if (permissions) {
      setLocalPermissions(permissions);
    }
  }, [permissions]);

  const hasRoleAdmin = hasRole('Administrador');
  const isAdmin = hasRoleAdmin || user?.accessType === 4;

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log('[SecurityPage] Verificação de admin:', {
        user,
        roleName: user?.roleName,
        accessType: user?.accessType,
        hasRoleAdmin,
        isAdmin,
      });
    }
  }, [user, hasRoleAdmin, isAdmin]);

  const getErrorMessage = (err: unknown, fallback: string) => {
    if (err instanceof Error && err.message) {
      return err.message;
    }
    return fallback;
  };

  // Aguarda carregamento do usuário antes de verificar
  if (authLoading) {
    return (
      <div className="security-page">
        <p>Carregando...</p>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="security-page" data-testid="security-page">
        <div className="access-denied" data-testid="security-access-denied">
          <AlertCircle size={48} />
          <h2>{t('security.accessDenied')}</h2>
          <p>{t('security.accessDeniedMessage')}</p>
        </div>
      </div>
    );
  }

  const handleConfigChange = (path: string, value: any) => {
    if (!localConfig) return;

    const keys = path.split('.');
    const newConfig = { ...localConfig };
    let current: any = newConfig;

    for (let i = 0; i < keys.length - 1; i++) {
      if (!current[keys[i]]) {
        current[keys[i]] = {};
      }
      current = current[keys[i]];
    }

    current[keys[keys.length - 1]] = value;
    setLocalConfig(newConfig);
  };

  const handleSaveConfig = async () => {
    if (!localConfig) return;

    try {
      await updateConfig(localConfig);
      setSaveStatus('success');
      showToast(t('security.saveSuccess'), 'success');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (err: unknown) {
      setSaveStatus('error');
      showToast(getErrorMessage(err, t('security.saveError')), 'error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  };

  const handleExportLogs = async (format: 'csv' | 'json' = 'csv') => {
    try {
      const response = await exportLogs(logFilters, format);
      
      // Cria blob e faz download
      let blob: Blob;
      if (format === 'csv') {
        // Para CSV, response.data já é uma string
        blob = new Blob([response.data], { type: 'text/csv;charset=utf-8' });
      } else {
        // Para JSON, response.data é um array de objetos
        blob = new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json;charset=utf-8' });
      }
      
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `logs_${new Date().toISOString().split('T')[0]}.${format}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      showToast(t('security.logging.exportSuccess'), 'success');
    } catch (err: unknown) {
      showToast(getErrorMessage(err, t('security.exportError')), 'error');
    }
  };

  if (loading) {
    return (
      <div className="security-page">
        <p>{t('security.loading')}</p>
      </div>
    );
  }

  if (!localConfig || !localPermissions) {
    return (
      <div className="security-page">
        <p>{t('security.loadError')}</p>
      </div>
    );
  }

  // #1341: localized labels by roleCode; a role with none (the additive
  // auditor) shows its stored displayName.
  const roleNames: Record<string, string> = {
    external_user: t('roles.externalUser'),
    technician: t('roles.technician'),
    coordinator: t('roles.coordinator'),
    administrator: t('roles.administrator')
  };

  return (
    <div className="security-page" data-testid="security-page">
      <div className="security-header">
        <h1 className="security-title">
          <Shield size={32} /> {t('security.title')}
        </h1>
        <p className="security-subtitle">{t('security.subtitleFull')}</p>
      </div>

      {error && (
        <div className="security-error" data-testid="security-error">
          <AlertCircle size={20} />
          <span>{error}</span>
        </div>
      )}

      {saveStatus === 'success' && (
        <div className="security-success">
          <CheckCircle size={20} />
          <span>{t('security.saveSuccess')}</span>
        </div>
      )}

      <div className="security-content">
        {/* Menu de Navegação Lateral */}
        <div className="security-sidebar">
          <nav className="security-nav">
            <button
              data-testid="security-nav-authentication"
              className={activeSection === 'authentication' ? 'active' : ''}
              onClick={() => setActiveSection('authentication')}
            >
              {t('security.sections.authentication')}
            </button>
            <button
              data-testid="security-nav-password"
              className={activeSection === 'password' ? 'active' : ''}
              onClick={() => setActiveSection('password')}
            >
              {t('security.sections.password')}
            </button>
            <button
              data-testid="security-nav-session"
              className={activeSection === 'session' ? 'active' : ''}
              onClick={() => setActiveSection('session')}
            >
              {t('security.sections.session')}
            </button>
            <button
              data-testid="security-nav-login"
              className={activeSection === 'login' ? 'active' : ''}
              onClick={() => setActiveSection('login')}
            >
              {t('security.sections.login')}
            </button>
            <button
              data-testid="security-nav-logging"
              className={activeSection === 'logging' ? 'active' : ''}
              onClick={() => setActiveSection('logging')}
            >
              {t('security.sections.logging')}
            </button>
            <button
              data-testid="security-nav-permissions"
              className={activeSection === 'permissions' ? 'active' : ''}
              onClick={() => setActiveSection('permissions')}
            >
              {t('security.sections.permissions')}
            </button>
            <button
              data-testid="security-nav-privacy"
              className={activeSection === 'privacy' ? 'active' : ''}
              onClick={() => setActiveSection('privacy')}
            >
              {t('security.sections.privacy')}
            </button>
            <button
              data-testid="security-nav-enhanced"
              className={activeSection === 'enhanced' ? 'active' : ''}
              onClick={() => setActiveSection('enhanced')}
            >
              {t('security.sections.enhanced')}
            </button>
            <button
              data-testid="security-nav-lgpd"
              className={activeSection === 'lgpd' ? 'active' : ''}
              onClick={() => setActiveSection('lgpd')}
            >
              {t('security.sections.lgpd')}
            </button>
            <button
              data-testid="security-nav-policies"
              className={activeSection === 'policies' ? 'active' : ''}
              onClick={() => setActiveSection('policies')}
            >
              {t('security.sections.policies')}
            </button>
            <button
              data-testid="security-nav-releases"
              className={activeSection === 'releases' ? 'active' : ''}
              onClick={() => setActiveSection('releases')}
            >
              {t('security.sections.releases')}
            </button>
            <button
              data-testid="security-nav-catalog"
              className={activeSection === 'catalog' ? 'active' : ''}
              onClick={() => setActiveSection('catalog')}
            >
              {t('security.sections.catalog')}
            </button>
          </nav>
        </div>

        {/* Conteúdo Principal */}
        <div className="security-main">
          {/* Seção: Autenticação e Acesso */}
          {activeSection === 'authentication' && (
            <Card className="security-section">
              <h2>{t('security.sections.authentication')}</h2>
              <div className="config-group">
                <label className="config-switch">
                  <input title="security-input"
                    data-testid="security-require-mfa-toggle"
                    type="checkbox"
                    checked={localConfig.authentication.requireMFA}
                    onChange={(e) => handleConfigChange('authentication.requireMFA', e.target.checked)}
                  />
                  <span>{t('security.authentication.requireMFA')}</span>
                </label>
                <div className="config-field">
                  <label>{t('security.authentication.mfaMethod')}</label>
                  <select title="security-select"
                    value={localConfig.authentication.mfaMethod}
                    onChange={(e) => handleConfigChange('authentication.mfaMethod', e.target.value)}
                  >
                    {/* #1249: TOTP is the only method implemented. */}
                    <option value="totp">{t('security.mfa.methodTotp')}</option>
                  </select>
                </div>
                <label className="config-switch">
                  <input title="security-input"
                    type="checkbox"
                    checked={localConfig.authentication.requireStrongPassword}
                    onChange={(e) => handleConfigChange('authentication.requireStrongPassword', e.target.checked)}
                  />
                  <span>{t('security.authentication.requireStrongPassword')}</span>
                </label>
                <label className="config-switch">
                  <input title="security-input"
                    type="checkbox"
                    checked={localConfig.authentication.allowPasswordReset}
                    onChange={(e) => handleConfigChange('authentication.allowPasswordReset', e.target.checked)}
                  />
                  <span>{t('security.authentication.allowPasswordReset')}</span>
                </label>
                <div className="config-field">
                  <label>{t('security.authentication.maxLoginAttempts')}</label>
                  <input title="security-input"
                    data-testid="security-max-login-attempts-input"
                    type="number"
                    min="1"
                    max="10"
                    value={localConfig.authentication.maxLoginAttempts}
                    onChange={(e) => handleConfigChange('authentication.maxLoginAttempts', parseInt(e.target.value))}
                  />
                </div>
                <div className="config-field">
                  <label>{t('security.authentication.lockoutDuration')}</label>
                  <input title="security-input"
                    type="number"
                    min="1"
                    max="1440"
                    value={localConfig.authentication.lockoutDurationMinutes}
                    onChange={(e) => handleConfigChange('authentication.lockoutDurationMinutes', parseInt(e.target.value))}
                  />
                  <span className="config-help">{t('security.authentication.lockoutDurationHelp')}</span>
                </div>
              </div>
              <div className="config-actions">
                <Button data-testid="security-save-config-button" onClick={handleSaveConfig} disabled={saving}>
                  <Save size={18} />
                  {saving ? t('users.saving') : t('common.save')}
                </Button>
              </div>
            </Card>
          )}

          {/* Seção: Regras de Senha */}
          {activeSection === 'password' && (
            <Card className="security-section">
              <h2>{t('security.sections.password')}</h2>
              <div className="config-group">
                <div className="config-field">
                  <label>{t('security.password.minLength')}</label>
                  <input title="security-input"
                    type="number"
                    min="8"
                    max="128"
                    value={localConfig.passwordRules.minLength}
                    onChange={(e) => handleConfigChange('passwordRules.minLength', parseInt(e.target.value))}
                  />
                </div>
                {/* #1257: the floor for an account enrolled in MFA; a stored
                    document from before the key existed reads it as minLength. */}
                <div className="config-field">
                  <label>{t('security.password.minLengthWithMFA')}</label>
                  <input title="security-input"
                    type="number"
                    min="8"
                    max={localConfig.passwordRules.minLength}
                    value={localConfig.passwordRules.minLengthWithMFA ?? localConfig.passwordRules.minLength}
                    onChange={(e) => handleConfigChange('passwordRules.minLengthWithMFA', parseInt(e.target.value))}
                  />
                </div>
                <label className="config-switch">
                  <input title="security-input"
                    type="checkbox"
                    checked={localConfig.passwordRules.requireUppercase}
                    onChange={(e) => handleConfigChange('passwordRules.requireUppercase', e.target.checked)}
                  />
                  <span>{t('security.password.requireUppercase')}</span>
                </label>
                <label className="config-switch">
                  <input title="security-input"
                    type="checkbox"
                    checked={localConfig.passwordRules.requireLowercase}
                    onChange={(e) => handleConfigChange('passwordRules.requireLowercase', e.target.checked)}
                  />
                  <span>{t('security.password.requireLowercase')}</span>
                </label>
                <label className="config-switch">
                  <input title="security-input"
                    type="checkbox"
                    checked={localConfig.passwordRules.requireNumbers}
                    onChange={(e) => handleConfigChange('passwordRules.requireNumbers', e.target.checked)}
                  />
                  <span>{t('security.password.requireNumbers')}</span>
                </label>
                <label className="config-switch">
                  <input title="security-input"
                    type="checkbox"
                    checked={localConfig.passwordRules.requireSpecialChars}
                    onChange={(e) => handleConfigChange('passwordRules.requireSpecialChars', e.target.checked)}
                  />
                  <span>{t('security.password.requireSpecialChars')}</span>
                </label>
                <div className="config-field">
                  <label>{t('security.password.expirationDays')}</label>
                  <input title="security-input"
                    type="number"
                    min="0"
                    max="365"
                    value={localConfig.passwordRules.expirationDays}
                    onChange={(e) => handleConfigChange('passwordRules.expirationDays', parseInt(e.target.value))}
                  />
                </div>
                <label className="config-switch">
                  <input title="security-input"
                    type="checkbox"
                    checked={localConfig.passwordRules.preventReuse}
                    onChange={(e) => handleConfigChange('passwordRules.preventReuse', e.target.checked)}
                  />
                  <span>{t('security.password.preventReuse')}</span>
                </label>
                {localConfig.passwordRules.preventReuse && (
                  <div className="config-field">
                    <label>{t('security.password.maxReuseHistory')}</label>
                    <input title="security-input"
                      type="number"
                      min="1"
                      max="20"
                      value={localConfig.passwordRules.maxReuseHistory}
                      onChange={(e) => handleConfigChange('passwordRules.maxReuseHistory', parseInt(e.target.value))}
                    />
                  </div>
                )}
              </div>
              <div className="config-actions">
                <Button onClick={handleSaveConfig} disabled={saving}>
                  <Save size={18} />
                  {saving ? t('users.saving') : t('common.save')}
                </Button>
              </div>
            </Card>
          )}

          {/* Seção: Gerenciamento de Sessão */}
          {activeSection === 'session' && (
            <Card className="security-section">
              <h2>{t('security.sections.session')}</h2>
              <div className="config-group">
                <div className="config-field">
                  <label>{t('security.session.timeoutMinutes')}</label>
                  <input title="security-input"
                    type="number"
                    min="5"
                    max="480"
                    value={localConfig.session.timeoutMinutes}
                    onChange={(e) => handleConfigChange('session.timeoutMinutes', parseInt(e.target.value))}
                  />
                  <span className="config-help">{t('security.session.timeoutMinutesHelp')}</span>
                </div>
                <div className="config-field">
                  <label>{t('security.session.maxDuration')}</label>
                  <input title="security-input"
                    type="number"
                    min="1"
                    max="24"
                    value={localConfig.session.maxSessionDurationHours}
                    onChange={(e) => handleConfigChange('session.maxSessionDurationHours', parseInt(e.target.value))}
                  />
                  <span className="config-help">{t('security.session.maxDurationHelp')}</span>
                </div>
                <label className="config-switch">
                  <input title="security-input"
                    type="checkbox"
                    checked={localConfig.session.allowMultipleSessions}
                    onChange={(e) => handleConfigChange('session.allowMultipleSessions', e.target.checked)}
                  />
                  <span>{t('security.session.allowMultipleSessions')}</span>
                </label>
                <label className="config-switch">
                  <input title="security-input"
                    type="checkbox"
                    checked={localConfig.session.autoRenewal ?? true}
                    onChange={(e) => handleConfigChange('session.autoRenewal', e.target.checked)}
                  />
                  <span>{t('security.session.autoRenewal')}</span>
                </label>
                <label className="config-switch">
                  <input title="security-input"
                    type="checkbox"
                    checked={localConfig.session.logExpiration ?? true}
                    onChange={(e) => handleConfigChange('session.logExpiration', e.target.checked)}
                  />
                  <span>{t('security.session.logExpiration')}</span>
                </label>
              </div>
              <div className="config-actions">
                <Button onClick={handleSaveConfig} disabled={saving}>
                  <Save size={18} />
                  {saving ? t('users.saving') : t('common.save')}
                </Button>
              </div>
            </Card>
          )}

          {/* Seção: Tentativas de Login */}
          {activeSection === 'login' && (
            <Card className="security-section">
              <h2>{t('security.login.title')}</h2>
              <div className="config-group">
                {/* #1249: the attempt limit and lockout are the authentication
                    keys the lockout reads; loginAttempts' copies follow them. */}
                <div className="config-field">
                  <label>{t('security.login.maxAttempts')}</label>
                  <input title="security-input"
                    type="number"
                    min="1"
                    max="10"
                    value={localConfig.authentication.maxLoginAttempts}
                    onChange={(e) => handleConfigChange('authentication.maxLoginAttempts', parseInt(e.target.value))}
                  />
                </div>
                <div className="config-field">
                  <label>{t('security.login.lockoutDuration')}</label>
                  <input title="security-input"
                    type="number"
                    min="1"
                    max="1440"
                    value={localConfig.authentication.lockoutDurationMinutes}
                    onChange={(e) => handleConfigChange('authentication.lockoutDurationMinutes', parseInt(e.target.value))}
                  />
                </div>
                <label className="config-switch">
                  <input title="security-input"
                    type="checkbox"
                    checked={localConfig.loginAttempts.trackIP}
                    onChange={(e) => handleConfigChange('loginAttempts.trackIP', e.target.checked)}
                  />
                  <span>{t('security.login.trackIP')}</span>
                </label>
                {localConfig.loginAttempts.trackIP && (
                  <div className="config-field">
                    <label>{t('security.login.blockIPAfterAttempts')}</label>
                    <input title="security-input"
                      type="number"
                      min="0"
                      max="100"
                      value={localConfig.loginAttempts.blockIPAfterAttempts}
                      onChange={(e) => handleConfigChange('loginAttempts.blockIPAfterAttempts', parseInt(e.target.value))}
                    />
                    {/* #1264 item 2: the count is per network address, not per person. */}
                    <span className="config-help" data-testid="security-ip-block-help">
                      {t('security.login.blockIPAfterAttemptsHelp')}
                    </span>
                  </div>
                )}
              </div>
              <div className="config-actions">
                <Button onClick={handleSaveConfig} disabled={saving}>
                  <Save size={18} />
                  {saving ? t('users.saving') : t('common.save')}
                </Button>
              </div>
            </Card>
          )}

          {/* Seção: Auditoria e Logs */}
          {activeSection === 'logging' && (
            <Card className="security-section">
              <h2>{t('security.sections.logging')}</h2>
              <div className="config-group">
                <div className="config-field">
                  <label>{t('security.logging.minLevel')}</label>
                  <select title="security-select"
                    value={localConfig.logging.level}
                    onChange={(e) => handleConfigChange('logging.level', e.target.value)}
                  >
                    <option value="info">{t('logs.severity.info')}</option>
                    <option value="warning">{t('logs.severity.warning')}</option>
                    <option value="error">{t('logs.severity.error')}</option>
                    <option value="critical">{t('logs.severity.critical')}</option>
                  </select>
                  <span className="config-help">{t('security.logging.minLevelHelp')}</span>
                </div>
                <label className="config-switch">
                  <input title="security-input"
                    type="checkbox"
                    checked={localConfig.logging.logLoginAttempts}
                    disabled={Boolean(localConfig.governedBy?.['logging.logLoginAttempts'])}
                    onChange={(e) => handleConfigChange('logging.logLoginAttempts', e.target.checked)}
                  />
                  <span>{t('security.logging.logLoginAttempts')}</span>
                </label>
                <label className="config-switch">
                  <input title="security-input"
                    type="checkbox"
                    checked={localConfig.logging.logAllActions}
                    disabled={Boolean(localConfig.governedBy?.['logging.logAllActions'])}
                    onChange={(e) => handleConfigChange('logging.logAllActions', e.target.checked)}
                  />
                  <span>{t('security.logging.logAllActions')}</span>
                </label>
                <span className="config-help" data-testid="security-logging-fixed-help">
                  {retentionGovernedHelp(t, localConfig.governedBy?.['logging.logAllActions'])}
                </span>
                <div className="config-field">
                  <label>{t('security.logging.retentionDays')}</label>
                  <input title="security-input"
                    type="number"
                    min="30"
                    max="3650"
                    value={localConfig.logging.retentionDays ?? ''}
                    disabled={Boolean(localConfig.governedBy?.['logging.retentionDays'])}
                    onChange={(e) => handleConfigChange('logging.retentionDays', parseInt(e.target.value))}
                  />
                  <span className="config-help" data-testid="security-retention-governed-help">
                    {retentionGovernedHelp(t, localConfig.governedBy?.['logging.retentionDays'])}
                  </span>
                </div>
              </div>
              
              {/* Filtros de Exportação */}
              <div className="config-group config-group-divider">
                <h3 className="config-subtitle">{t('security.logging.exportFilters')}</h3>
                <div className="config-field">
                  <label>{t('security.logging.filterSeverity')}</label>
                  <select title="security-select"
                    data-testid="security-log-filter-severity"
                    value={logFilters.severity}
                    onChange={(e) => setLogFilters({ ...logFilters, severity: e.target.value })}
                  >
                    <option value="">{t('security.logging.allSeverities')}</option>
                    <option value="info">{t('logs.severity.info')}</option>
                    <option value="warning">{t('logs.severity.warning')}</option>
                    <option value="error">{t('logs.severity.error')}</option>
                    <option value="critical">{t('logs.severity.critical')}</option>
                  </select>
                </div>
                <div className="config-field">
                  <label>{t('security.logging.filterModule')}</label>
                  <input title="security-input"
                    data-testid="security-log-filter-module"
                    type="text"
                    value={logFilters.module}
                    onChange={(e) => setLogFilters({ ...logFilters, module: e.target.value })}
                    placeholder={t('security.logging.filterModulePlaceholder')}
                  />
                </div>
                <div className="config-field">
                  <label>{t('security.logging.filterStartDate')}</label>
                  <input title="security-input"
                    data-testid="security-log-filter-start-date"
                    type="date"
                    value={logFilters.startDate}
                    onChange={(e) => setLogFilters({ ...logFilters, startDate: e.target.value })}
                  />
                </div>
                <div className="config-field">
                  <label>{t('security.logging.filterEndDate')}</label>
                  <input title="security-input"
                    data-testid="security-log-filter-end-date"
                    type="date"
                    value={logFilters.endDate}
                    onChange={(e) => setLogFilters({ ...logFilters, endDate: e.target.value })}
                  />
                </div>
              </div>
              
              <div className="config-actions">
                <Button data-testid="security-save-logging-config-button" onClick={handleSaveConfig} disabled={saving}>
                  <Save size={18} />
                  {saving ? t('users.saving') : t('common.save')}
                </Button>
                <Button data-testid="security-export-logs-csv-button" variant="secondary" onClick={() => handleExportLogs('csv')}>
                  <Download size={18} />
                  {t('security.logging.exportCsv')}
                </Button>
                <Button data-testid="security-export-logs-json-button" variant="secondary" onClick={() => handleExportLogs('json')}>
                  <Download size={18} />
                  {t('security.logging.exportJson')}
                </Button>
              </div>
            </Card>
          )}

          {/* Seção: Permissões */}
          {activeSection === 'permissions' && (
            <Card className="security-section">
              <h2>{t('security.permissions.title')}</h2>
              {/* #1149: read-only. The save this tab had wrote a store no
                  authorization path reads, so it is gone rather than kept. */}
              <p data-testid="security-permissions-readonly-note">{t('security.permissions.readOnlyNote')}</p>
              {/* #1341: every seeded role, the additive auditor included,
                  against every permission, as enforcement reads them. */}
              <div className="permissions-grid">
                {localPermissions.roles.map((role) => (
                  <div key={role.roleCode} className="permission-profile" data-testid={`security-permission-role-${role.roleCode}`}>
                    <h3>{roleNames[role.roleCode] || role.displayName || role.roleCode}</h3>
                    {localPermissions.permissions.map((permission) => (
                      <label key={permission.permissionCode} className="config-switch" title={permission.permissionCode}>
                        <input title="security-input"
                          data-testid={`security-permission-toggle-${role.roleCode}-${permission.permissionCode}`}
                          type="checkbox"
                          checked={role.permissionCodes.includes(permission.permissionCode)}
                          disabled
                          readOnly
                        />
                        <span>{permission.displayName || permission.permissionCode}</span>
                      </label>
                    ))}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Seção: Privacidade */}
          {activeSection === 'privacy' && (
            <Card className="security-section">
              <h2>{t('security.privacy.title')}</h2>
              <div className="config-group">
                <label className="config-switch">
                  <input title="security-input"
                    type="checkbox"
                    checked={localConfig.privacy.anonymizeLogs}
                    disabled={Boolean(localConfig.governedBy?.['privacy.anonymizeLogs'])}
                    onChange={(e) => handleConfigChange('privacy.anonymizeLogs', e.target.checked)}
                  />
                  <span>{t('security.privacy.anonymizeLogs')}</span>
                </label>
                <span className="config-help">
                  {retentionGovernedHelp(t, localConfig.governedBy?.['privacy.anonymizeLogs'])}
                </span>
                <div className="config-field">
                  <label>{t('security.privacy.dataRetentionDays')}</label>
                  <input title="security-input"
                    type="number"
                    min="30"
                    max="3650"
                    value={localConfig.privacy.dataRetentionDays ?? ''}
                    disabled={Boolean(localConfig.governedBy?.['privacy.dataRetentionDays'])}
                    onChange={(e) => handleConfigChange('privacy.dataRetentionDays', parseInt(e.target.value))}
                  />
                  <span className="config-help" data-testid="security-privacy-fixed-help">
                    {retentionGovernedHelp(t, localConfig.governedBy?.['privacy.dataRetentionDays'])}
                  </span>
                </div>
                <label className="config-switch">
                  <input title="security-input"
                    type="checkbox"
                    checked={localConfig.privacy.autoPurge}
                    disabled={Boolean(localConfig.governedBy?.['privacy.autoPurge'])}
                    onChange={(e) => handleConfigChange('privacy.autoPurge', e.target.checked)}
                  />
                  <span>{t('security.privacy.autoPurge')}</span>
                </label>
                <span className="config-help">
                  {retentionGovernedHelp(t, localConfig.governedBy?.['privacy.autoPurge'])}
                </span>
                {localConfig.privacy.autoPurge && (
                  <>
                    <div className="config-field">
                      <label>{t('security.privacy.purgeAfterDays')}</label>
                      <input title="security-input"
                        type="number"
                        min="90"
                        max="3650"
                        value={localConfig.privacy.purgeAfterDays ?? ''}
                        disabled={Boolean(localConfig.governedBy?.['privacy.purgeAfterDays'])}
                        onChange={(e) => handleConfigChange('privacy.purgeAfterDays', parseInt(e.target.value))}
                      />
                    </div>
                    <div className="config-field">
                      <label>{t('security.privacy.anonymizeAfterDays')}</label>
                      <input title="security-input"
                        type="number"
                        min="30"
                        max="365"
                        value={localConfig.privacy.anonymizeAfterDays ?? ''}
                        disabled={Boolean(localConfig.governedBy?.['privacy.anonymizeAfterDays'])}
                        onChange={(e) => handleConfigChange('privacy.anonymizeAfterDays', parseInt(e.target.value))}
                      />
                    </div>
                  </>
                )}
              </div>
              <div className="config-actions">
                <Button onClick={handleSaveConfig} disabled={saving}>
                  <Save size={18} />
                  {saving ? t('users.saving') : t('common.save')}
                </Button>
              </div>
            </Card>
          )}

          {/* Seção: Modo Segurança Reforçado */}
          {activeSection === 'enhanced' && (
            <Card className="security-section">
              <h2>{t('security.enhanced.title')}</h2>
              <div className="config-group">
                <label className="config-switch">
                  <input title="security-input"
                    type="checkbox"
                    checked={localConfig.enhancedSecurity.enabled}
                    onChange={(e) => handleConfigChange('enhancedSecurity.enabled', e.target.checked)}
                  />
                  <span>{t('security.enhanced.enable')}</span>
                </label>
                {localConfig.enhancedSecurity.enabled && (
                  <>
                    <label className="config-switch">
                      <input title="security-input"
                        type="checkbox"
                        checked={localConfig.enhancedSecurity.requireMFAForAll}
                        onChange={(e) => handleConfigChange('enhancedSecurity.requireMFAForAll', e.target.checked)}
                      />
                      <span>{t('security.enhanced.requireMFAForAll')}</span>
                    </label>
                    <label className="config-switch">
                      <input title="security-input"
                        type="checkbox"
                        checked={localConfig.enhancedSecurity.strictPasswordPolicy}
                        onChange={(e) => handleConfigChange('enhancedSecurity.strictPasswordPolicy', e.target.checked)}
                      />
                      <span>{t('security.enhanced.strictPasswordPolicy')}</span>
                    </label>
                    <div className="config-field">
                      <label>{t('security.enhanced.sessionTimeoutMinutes')}</label>
                      <input title="security-input"
                        type="number"
                        min="5"
                        max="60"
                        value={localConfig.enhancedSecurity.sessionTimeoutMinutes}
                        onChange={(e) => handleConfigChange('enhancedSecurity.sessionTimeoutMinutes', parseInt(e.target.value))}
                      />
                    </div>
                    <label className="config-switch">
                      <input title="security-input"
                        type="checkbox"
                        checked={localConfig.enhancedSecurity.logAllActions}
                        disabled={Boolean(localConfig.governedBy?.['enhancedSecurity.logAllActions'])}
                        onChange={(e) => handleConfigChange('enhancedSecurity.logAllActions', e.target.checked)}
                      />
                      <span>{t('security.enhanced.logAllActions')}</span>
                    </label>
                    <label className="config-switch">
                      <input title="security-input"
                        type="checkbox"
                        checked={localConfig.enhancedSecurity.blockUnusualActivity}
                        onChange={(e) => handleConfigChange('enhancedSecurity.blockUnusualActivity', e.target.checked)}
                      />
                      <span>{t('security.enhanced.blockUnusualActivity')}</span>
                    </label>
                    <span className="config-help">{t('security.enhanced.blockUnusualActivityHelp')}</span>
                  </>
                )}
              </div>
              <div className="config-actions">
                <Button onClick={handleSaveConfig} disabled={saving}>
                  <Save size={18} />
                  {saving ? t('users.saving') : t('common.save')}
                </Button>
              </div>
            </Card>
          )}

          {/* Seção: LGPD */}
          {activeSection === 'lgpd' && (
            <Card className="security-section">
              <h2>{t('security.lgpd.title')}</h2>
              <div className="config-group">
                <label className="config-switch">
                  <input title="security-input"
                    type="checkbox"
                    checked={localConfig.lgpd.allowDataExport}
                    onChange={(e) => handleConfigChange('lgpd.allowDataExport', e.target.checked)}
                  />
                  <span>{t('security.lgpd.allowDataExport')}</span>
                </label>
                <label className="config-switch">
                  <input title="security-input"
                    type="checkbox"
                    checked={localConfig.lgpd.allowDataDeletion}
                    onChange={(e) => handleConfigChange('lgpd.allowDataDeletion', e.target.checked)}
                  />
                  <span>{t('security.lgpd.allowDataDeletion')}</span>
                </label>
                <label className="config-switch">
                  <input title="security-input"
                    type="checkbox"
                    checked={localConfig.lgpd.anonymizeOnExport}
                    disabled={Boolean(localConfig.governedBy?.['lgpd.anonymizeOnExport'])}
                    onChange={(e) => handleConfigChange('lgpd.anonymizeOnExport', e.target.checked)}
                  />
                  <span>{t('security.lgpd.anonymizeOnExport')}</span>
                </label>
                <span className="config-help" data-testid="security-export-fixed-help">
                  {retentionGovernedHelp(t, localConfig.governedBy?.['lgpd.anonymizeOnExport'])}
                </span>
                <label className="config-switch">
                  <input title="security-input"
                    type="checkbox"
                    checked={localConfig.lgpd.requireConsent}
                    disabled={Boolean(localConfig.governedBy?.['lgpd.requireConsent'])}
                    onChange={(e) => handleConfigChange('lgpd.requireConsent', e.target.checked)}
                  />
                  <span>{t('security.lgpd.requireConsent')}</span>
                </label>
                <span className="config-help">
                  {retentionGovernedHelp(t, localConfig.governedBy?.['lgpd.requireConsent'])}
                </span>
                {localConfig.lgpd.requireConsent && (
                  <div className="config-field">
                    <label>{t('security.lgpd.consentExpirationDays')}</label>
                    <input title="security-input"
                      type="number"
                      min="30"
                      max="3650"
                      value={localConfig.lgpd.consentExpirationDays ?? ''}
                      disabled={Boolean(localConfig.governedBy?.['lgpd.consentExpirationDays'])}
                      onChange={(e) => handleConfigChange('lgpd.consentExpirationDays', parseInt(e.target.value))}
                    />
                    <span className="config-help" data-testid="security-lgpd-fixed-help">
                      {retentionGovernedHelp(t, localConfig.governedBy?.['lgpd.consentExpirationDays'])}
                    </span>
                  </div>
                )}
              </div>
              <div className="config-actions">
                <Button onClick={handleSaveConfig} disabled={saving}>
                  <Save size={18} />
                  {saving ? t('users.saving') : t('common.save')}
                </Button>
              </div>
            </Card>
          )}

          {/* Seção: Políticas e Diretrizes Técnicas */}
          {activeSection === 'releases' && (
            <ConfigurationReleasesPanel t={t} showToast={showToast} onRolledBack={loadConfig} />
          )}
          {activeSection === 'catalog' && <SettingCatalogPanel t={t} />}

          {activeSection === 'policies' && (
            <div className="security-policies">
              <Card className="security-section">
                <h2>Políticas e Diretrizes de Segurança do Sistema</h2>
                <p className="policies-intro">
                  Este documento apresenta as diretrizes técnicas, políticas de segurança e requisitos de conformidade 
                  implementados no BioAdvanceD para proteção de dados sensíveis de saúde, em conformidade com a LGPD 
                  e boas práticas de segurança da informação.
                </p>
              </Card>

              {/* MFA Obrigatório */}
              <Card className="security-section">
                <h3>1. Autenticação Multifator (MFA) Obrigatória</h3>
                <div className="policy-content">
                  <h4>1.1. MFA TOTP no Primeiro Acesso</h4>
                  <ul>
                    <li><strong>Obrigatoriedade:</strong> Todo usuário deve ativar o Google Authenticator (TOTP) no primeiro login ao sistema.</li>
                    <li><strong>Bloqueio de Acesso:</strong> Enquanto o MFA TOTP não for configurado e validado, todo o acesso ao sistema permanece bloqueado, exceto a rota de configuração de MFA.</li>
                    <li><strong>Processo de Configuração:</strong>
                      <ul>
                        <li>Geração automática de QR Code com secret criptografado</li>
                        <li>Validação obrigatória do primeiro código TOTP (6 dígitos)</li>
                        <li>Registro seguro do secret criptografado no banco de dados</li>
                        <li>Ativação do MFA apenas após validação bem-sucedida</li>
                      </ul>
                    </li>
                    <li><strong>Método Primário:</strong> TOTP (Time-based One-Time Password) é o método MFA primário e obrigatório para todos os usuários.</li>
                  </ul>

                  <h4>1.2. Métodos Alternativos de MFA (Opcionais)</h4>
                  <p>Após o MFA primário estar ativo, o usuário pode cadastrar métodos de fallback:</p>
                  <ul>
                    <li><strong>Telefone/SMS:</strong> OTP com expiração curta (5 minutos) e número mascarado na exibição (ex: +55 (XX) XXXXX-XXXX)</li>
                    <li><strong>Passkey FIDO2/WebAuthn:</strong> Registro e validação de chave pública criptográfica para autenticação sem senha</li>
                    <li><strong>Recovery Codes:</strong> Códigos de recuperação criptografados, de uso único, gerados durante a configuração do MFA</li>
                  </ul>
                  <p><strong>Restrições:</strong> Métodos alternativos só podem ser removidos ou adicionados após autenticação completa (MFA primário + senha).</p>
                </div>
              </Card>

              {/* Política de Senha */}
              <Card className="security-section">
                <h3>2. Política de Senha (LGPD + Segurança Avançada)</h3>
                <div className="policy-content">
                  <h4>2.1. Requisitos de Complexidade</h4>
                  <ul>
                    <li><strong>Comprimento Mínimo:</strong> 12 caracteres (recomendado para sistemas de saúde)</li>
                    <li><strong>Complexidade Obrigatória:</strong>
                      <ul>
                        <li>Pelo menos uma letra maiúscula (A-Z)</li>
                        <li>Pelo menos uma letra minúscula (a-z)</li>
                        <li>Pelo menos um número (0-9)</li>
                        <li>Pelo menos um caractere especial ({'!@#$%^&*()_+-=[]{}|;:,.<>?'})</li>
                      </ul>
                    </li>
                    <li><strong>Verificação contra Senhas Vazadas:</strong> O sistema verifica senhas contra bases de dados conhecidas de senhas comprometidas (Have I Been Pwned API ou similar).</li>
                  </ul>

                  <h4>2.2. Expiração e Renovação</h4>
                  <ul>
                    <li><strong>Expiração Obrigatória:</strong> 90 dias (valor recomendado para sistemas de saúde segundo boas práticas)</li>
                    <li><strong>Bloqueio de Reutilização:</strong> Impede reutilização das últimas 5 senhas do histórico</li>
                    <li><strong>Troca Forçada:</strong> Após expiração, o usuário é forçado a trocar a senha imediatamente no próximo login</li>
                    <li><strong>Alerta Preventivo:</strong> Sistema exibe alerta ao usuário 10 dias antes da expiração da senha</li>
                  </ul>

                  <h4>2.3. Armazenamento Seguro</h4>
                  <ul>
                    <li><strong>Algoritmos Suportados:</strong> Argon2id (preferencial), bcrypt ou PBKDF2</li>
                    <li><strong>Salt Único:</strong> Cada senha utiliza salt único e aleatório</li>
                    <li><strong>Nunca em Texto Claro:</strong> Senhas nunca são armazenadas ou transmitidas em texto claro</li>
                  </ul>
                </div>
              </Card>

              {/* Fluxos de Recuperação */}
              <Card className="security-section">
                <h3>3. Fluxos de Recuperação Seguros</h3>
                <div className="policy-content">
                  <h4>3.1. Recuperação de Acesso MFA</h4>
                  <p>Caso o usuário perca o aplicativo TOTP, o sistema permite login alternativo através de:</p>
                  <ul>
                    <li><strong>Passkey FIDO2/WebAuthn:</strong> Se previamente cadastrado</li>
                    <li><strong>SMS/Telefone:</strong> Se método alternativo estiver ativo</li>
                    <li><strong>Recovery Codes:</strong> Códigos de recuperação de uso único</li>
                  </ul>

                  <h4>3.2. Reset de MFA</h4>
                  <ul>
                    <li><strong>Verificação Forte Obrigatória:</strong> Reset de MFA só pode ser realizado com verificação forte (nunca apenas por e-mail isolado)</li>
                    <li><strong>Métodos Aceitos:</strong> Verificação por outro método MFA ativo, recovery code ou confirmação por administrador com auditoria</li>
                    <li><strong>Bloqueio Temporário:</strong> Após reset, conta fica temporariamente bloqueada até nova configuração de MFA</li>
                  </ul>

                  <h4>3.3. Auditoria de Alterações</h4>
                  <ul>
                    <li><strong>Registro Obrigatório:</strong> Todas as alterações de segurança (MFA, senha, métodos alternativos) são registradas em logs de auditoria</li>
                    <li><strong>Dados Protegidos:</strong> Logs nunca contêm códigos MFA, senhas ou dados pessoais sensíveis</li>
                    <li><strong>Rastreabilidade:</strong> Cada alteração registra: usuário (anonimizado), timestamp, IP, user-agent e tipo de alteração</li>
                  </ul>
                </div>
              </Card>

              {/* LGPD e Privacidade */}
              <Card className="security-section">
                <h3>4. LGPD e Privacidade</h3>
                <div className="policy-content">
                  <h4>4.1. Criptografia de Dados</h4>
                  <ul>
                    <li><strong>Criptografia em Repouso:</strong> Todos os dados sensíveis são criptografados em repouso usando AES-256</li>
                    <li><strong>Criptografia em Trânsito:</strong> Todas as comunicações utilizam TLS 1.2+ (HTTPS obrigatório)</li>
                    <li><strong>Chaves de Criptografia:</strong> Gerenciadas de forma segura, com rotação periódica</li>
                  </ul>

                  <h4>4.2. Minimização e Necessidade</h4>
                  <ul>
                    <li><strong>Mascaramento de Dados:</strong> Telefones são exibidos apenas mascarados (ex: +55 (XX) XXXXX-XXXX)</li>
                    <li><strong>Proteção de Secrets:</strong> Secrets TOTP nunca são exibidos após a configuração inicial</li>
                    <li><strong>Princípio da Necessidade:</strong> Apenas dados estritamente necessários são coletados e processados</li>
                  </ul>

                  <h4>4.3. Logs e Anonimização</h4>
                  <ul>
                    <li><strong>Anonimização Automática:</strong> Logs são automaticamente anonimizados, utilizando identificadores únicos (userAnonId) em vez de dados pessoais</li>
                    <li><strong>Dados Excluídos dos Logs:</strong> Senhas, códigos MFA, números de documentos completos, endereços completos</li>
                    <li><strong>Retenção:</strong> Logs são mantidos conforme política de retenção configurável (padrão: 365 dias)</li>
                  </ul>

                  <h4>4.4. Princípios LGPD</h4>
                  <ul>
                    <li><strong>Segurança:</strong> Medidas técnicas e administrativas para proteção de dados</li>
                    <li><strong>Prevenção:</strong> Adoção de medidas para prevenir danos por tratamento de dados</li>
                    <li><strong>Responsabilização:</strong> Demonstração de conformidade e adoção de medidas eficazes</li>
                  </ul>

                  <h4>4.5. HTTPS e HSTS</h4>
                  <ul>
                    <li><strong>HTTPS Obrigatório:</strong> Força uso de HTTPS com HSTS (HTTP Strict Transport Security)</li>
                    <li><strong>Bloqueio de HTTP:</strong> Acesso por HTTP é bloqueado em produção</li>
                    <li><strong>Certificados Válidos:</strong> Utilização de certificados SSL/TLS válidos e atualizados</li>
                  </ul>
                </div>
              </Card>

              {/* Boas Práticas */}
              <Card className="security-section">
                <h3>5. Boas Práticas de Segurança</h3>
                <div className="policy-content">
                  <h4>5.1. Security Headers (Helmet.js)</h4>
                  <ul>
                    <li><strong>CSP (Content Security Policy):</strong> Define políticas de conteúdo permitidas, prevenindo XSS</li>
                    <li><strong>X-Frame-Options:</strong> Previne clickjacking (DENY ou SAMEORIGIN)</li>
                    <li><strong>X-Content-Type-Options:</strong> Força verificação de MIME type (nosniff)</li>
                    <li><strong>Referrer-Policy:</strong> Controla informações de referrer enviadas</li>
                    <li><strong>Permissions-Policy:</strong> Controla recursos do navegador (câmera, geolocalização, etc.)</li>
                  </ul>

                  <h4>5.2. Rate Limiting e Bloqueio</h4>
                  <ul>
                    <li><strong>Rate Limiting:</strong> Implementado em todas as rotas críticas (login, autenticação, alterações de segurança)</li>
                    <li><strong>Bloqueio por Tentativas:</strong> Após 5 tentativas inválidas de login, conta é bloqueada temporariamente (30 minutos)</li>
                    <li><strong>Bloqueio por IP:</strong> Após 10 tentativas inválidas do mesmo IP, bloqueio automático por 1 hora</li>
                    <li><strong>Rastreamento:</strong> Todas as tentativas são registradas para análise de segurança</li>
                  </ul>

                  <h4>5.3. CORS Restrito</h4>
                  <ul>
                    <li><strong>Origins Permitidas:</strong> CORS configurado apenas para domínios autorizados do sistema</li>
                    <li><strong>Credenciais:</strong> Credenciais (cookies, tokens) são enviadas apenas para origins permitidas</li>
                    <li><strong>Métodos Permitidos:</strong> Apenas métodos HTTP necessários (GET, POST, PUT, DELETE, PATCH)</li>
                  </ul>

                  <h4>5.4. Tokens JWT</h4>
                  <ul>
                    <li><strong>Rotação Periódica:</strong> Tokens JWT são rotacionados periodicamente (renovação por atividade)</li>
                    <li><strong>Expiração:</strong> Tokens expiram após 12 horas de inatividade ou 12 horas totais</li>
                    <li><strong>Assinatura Segura:</strong> Tokens são assinados com algoritmo HS256 e secret forte</li>
                    <li><strong>Validação Rigorosa:</strong> Todas as requisições validam assinatura e expiração do token</li>
                  </ul>

                  <h4>5.5. Verificação Anticlonagem</h4>
                  <ul>
                    <li><strong>Detecção de Sessões Suspeitas:</strong> Sistema detecta múltiplas sessões do mesmo usuário de IPs diferentes</li>
                    <li><strong>Alertas:</strong> Administradores são alertados sobre atividades suspeitas</li>
                    <li><strong>Bloqueio Preventivo:</strong> Sessões suspeitas podem ser bloqueadas automaticamente</li>
                  </ul>
                </div>
              </Card>

              {/* Painel do Usuário */}
              <Card className="security-section">
                <h3>6. Painel de Segurança do Usuário</h3>
                <div className="policy-content">
                  <p>O sistema disponibiliza um painel de segurança onde o usuário pode:</p>
                  <ul>
                    <li><strong>Status do MFA:</strong> Visualizar status de ativação e métodos configurados</li>
                    <li><strong>Expiração de Senha:</strong> Verificar data de expiração e dias restantes</li>
                    <li><strong>Logs Recentes:</strong> Acessar histórico de atividades de segurança (anonimizado)</li>
                    <li><strong>Métodos Alternativos:</strong> Cadastrar, visualizar e remover métodos MFA alternativos</li>
                    <li><strong>Reset Seguro:</strong> Solicitar reset de MFA ou senha com verificação forte</li>
                  </ul>
                </div>
              </Card>

              {/* Checklist de Conformidade */}
              <Card className="security-section">
                <h3>7. Checklist de Conformidade de Segurança</h3>
                <div className="policy-content">
                  <div className="compliance-checklist">
                    <div className="checklist-category">
                      <h4>✓ Autenticação e MFA</h4>
                      <ul className="checklist-items">
                        <li>☑ MFA TOTP obrigatório no primeiro acesso</li>
                        <li>☑ Bloqueio de acesso até configuração de MFA</li>
                        <li>☑ Geração e validação de QR Code TOTP</li>
                        <li>☑ Armazenamento seguro de secrets (criptografado)</li>
                        <li>☑ Métodos alternativos opcionais (SMS, Passkey, Recovery Codes)</li>
                        <li>☑ Reset de MFA com verificação forte</li>
                      </ul>
                    </div>

                    <div className="checklist-category">
                      <h4>✓ Política de Senha</h4>
                      <ul className="checklist-items">
                        <li>☑ Senha mínima de 12 caracteres</li>
                        <li>☑ Complexidade obrigatória (maiúsculas, minúsculas, números, especiais)</li>
                        <li>☑ Verificação contra senhas vazadas</li>
                        <li>☑ Expiração obrigatória a cada 90 dias</li>
                        <li>☑ Bloqueio de reutilização das últimas 5 senhas</li>
                        <li>☑ Troca forçada após expiração</li>
                        <li>☑ Alerta 10 dias antes da expiração</li>
                        <li>☑ Armazenamento com Argon2id/bcrypt/PBKDF2</li>
                      </ul>
                    </div>

                    <div className="checklist-category">
                      <h4>✓ Criptografia e Proteção de Dados</h4>
                      <ul className="checklist-items">
                        <li>☑ Criptografia AES-256 em repouso</li>
                        <li>☑ TLS 1.2+ para dados em trânsito</li>
                        <li>☑ HTTPS obrigatório com HSTS</li>
                        <li>☑ Bloqueio de acesso HTTP</li>
                        <li>☑ Mascaramento de dados sensíveis na exibição</li>
                        <li>☑ Minimização de dados coletados</li>
                      </ul>
                    </div>

                    <div className="checklist-category">
                      <h4>✓ Logs e Auditoria</h4>
                      <ul className="checklist-items">
                        <li>☑ Logs de auditoria para todas as alterações de segurança</li>
                        <li>☑ Anonimização automática de dados sensíveis nos logs</li>
                        <li>☑ Nunca registrar códigos MFA ou senhas</li>
                        <li>☑ Rastreabilidade completa (usuário anonimizado, timestamp, IP, user-agent)</li>
                        <li>☑ Retenção configurável de logs (padrão: 365 dias)</li>
                        <li>☑ Exportação de logs com filtros e anonimização</li>
                      </ul>
                    </div>

                    <div className="checklist-category">
                      <h4>✓ Security Headers e Proteções</h4>
                      <ul className="checklist-items">
                        <li>☑ Helmet.js configurado (CSP, X-Frame-Options, X-Content-Type-Options)</li>
                        <li>☑ Referrer-Policy configurado</li>
                        <li>☑ Permissions-Policy configurado</li>
                        <li>☑ Rate limiting em rotas críticas</li>
                        <li>☑ Bloqueio após tentativas inválidas</li>
                        <li>☑ CORS restrito a domínios autorizados</li>
                        <li>☑ Rotação periódica de tokens JWT</li>
                        <li>☑ Verificação anticlonagem de sessões</li>
                      </ul>
                    </div>

                    <div className="checklist-category">
                      <h4>✓ LGPD e Privacidade</h4>
                      <ul className="checklist-items">
                        <li>☑ Princípio de segurança implementado</li>
                        <li>☑ Princípio de prevenção implementado</li>
                        <li>☑ Princípio de responsabilização implementado</li>
                        <li>☑ Anonimização de dados em logs</li>
                        <li>☑ Mascaramento de dados sensíveis na interface</li>
                        <li>☑ Consentimento quando necessário</li>
                        <li>☑ Direito ao esquecimento (exclusão de dados)</li>
                        <li>☑ Portabilidade de dados (exportação anonimizada)</li>
                      </ul>
                    </div>

                    <div className="checklist-category">
                      <h4>✓ Recuperação e Resiliência</h4>
                      <ul className="checklist-items">
                        <li>☑ Recuperação de acesso via métodos alternativos</li>
                        <li>☑ Recovery codes criptografados e de uso único</li>
                        <li>☑ Reset seguro com verificação forte</li>
                        <li>☑ Backup regular e seguro de dados</li>
                        <li>☑ Plano de recuperação de desastres</li>
                        <li>☑ Monitoramento contínuo de segurança</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </Card>

              {/* Informações Técnicas */}
              <Card className="security-section">
                <h3>8. Especificações Técnicas</h3>
                <div className="policy-content">
                  <h4>8.1. Algoritmos e Padrões Utilizados</h4>
                  <ul>
                    <li><strong>Hash de Senha:</strong> Argon2id (preferencial), bcrypt ou PBKDF2</li>
                    <li><strong>Criptografia:</strong> AES-256-GCM para dados em repouso</li>
                    <li><strong>TLS:</strong> TLS 1.2+ (recomendado TLS 1.3)</li>
                    <li><strong>JWT:</strong> HS256 com secret forte (mínimo 256 bits)</li>
                    <li><strong>TOTP:</strong> RFC 6238 (SHA-1, período de 30 segundos, 6 dígitos)</li>
                    <li><strong>FIDO2/WebAuthn:</strong> W3C Web Authentication API</li>
                  </ul>

                  <h4>8.2. Requisitos de Infraestrutura</h4>
                  <ul>
                    <li><strong>Servidor:</strong> Node.js 18+ com Express.js</li>
                    <li><strong>Banco de Dados:</strong> MongoDB com criptografia de conexão</li>
                    <li><strong>Certificados SSL/TLS:</strong> Válidos e atualizados</li>
                    <li><strong>Firewall:</strong> Configurado para permitir apenas tráfego necessário</li>
                    <li><strong>Monitoramento:</strong> Logs centralizados e análise de segurança</li>
                  </ul>
                </div>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


