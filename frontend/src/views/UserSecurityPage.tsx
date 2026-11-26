import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../components/UI/Card';
import Button from '../components/UI/Button';
import Modal from '../components/UI/Modal';
import { useLanguage } from '../contexts/LanguageContext';
import { 
  Shield, 
  Lock, 
  Smartphone, 
  Key, 
  AlertTriangle, 
  CheckCircle, 
  XCircle,
  Eye,
  EyeOff,
  Download,
  Plus,
  LogOut,
  FileText,
  ChevronRight,
  Settings
} from 'lucide-react';
import { useUserSecurity } from '../hooks/useUserSecurity';
import { useToast } from '../components/UI/ToastContainer';
import { validatePasswordAndGetError } from '../utils/passwordValidator';
import { getPasswordIssues, passwordRequirementItems, rulesForAccount } from '../utils/passwordRules';
import { usePasswordPolicy, usePasswordResetAllowed } from '../hooks/usePasswordPolicy';
import { useAuth } from '../contexts/AuthContext';
import { userSecurityService } from '../services/api';

export default function UserSecurityPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { logout } = useAuth();
  const {
    securityStatus,
    mfaStatus,
    passwordStatus,
    sessions,
    loading,
    refreshData,
    updatePassword,
    generateRecoveryCodes,
    revokeSession,
    revokeAllSessions
  } = useUserSecurity();

  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  const [showRecoveryCodesModal, setShowRecoveryCodesModal] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmAction, setConfirmAction] = useState<(() => void) | null>(null);
  const [confirmMessage, setConfirmMessage] = useState('');
  const [newPassword, setNewPassword] = useState({ current: '', new: '', confirm: '' });
  const [showPasswords, setShowPasswords] = useState({ current: false, new: false, confirm: false });
  const [passwordError, setPasswordError] = useState('');

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  const getSecurityLevelColor = (level: number) => {
    if (level >= 80) return 'var(--success)';
    if (level >= 50) return 'var(--warning)';
    return 'var(--danger)';
  };

  const getSecurityLevelLabel = (level: number) => {
    if (level >= 80) return t('userSecurity.securityLevel.strong');
    if (level >= 50) return t('userSecurity.securityLevel.medium');
    return t('userSecurity.securityLevel.weak');
  };

  const handleChangePassword = async () => {
    setPasswordError('');
    
    if (!newPassword.current || !newPassword.new || !newPassword.confirm) {
      setPasswordError(t('userSecurity.password.allFieldsRequired'));
      return;
    }

    // Valida complexidade da senha
    const passwordError = validatePasswordAndGetError(newPassword.new, passwordRules);
    if (passwordError) {
      setPasswordError(passwordError);
      return;
    }

    if (newPassword.new !== newPassword.confirm) {
      setPasswordError(t('userSecurity.password.mismatch'));
      return;
    }

    try {
      await updatePassword(newPassword.current, newPassword.new);
      setShowChangePasswordModal(false);
      setNewPassword({ current: '', new: '', confirm: '' });
      refreshData();
    } catch (err: any) {
      setPasswordError(err.message || t('userSecurity.password.changeError'));
    }
  };

  const handleConfirmAction = (action: () => void, message: string) => {
    setConfirmAction(() => action);
    setConfirmMessage(message);
    setShowConfirmModal(true);
  };

  // #1434: the hook's revoke mutations rethrow with the message to show.
  const revokeOrToast = async (revoke: () => Promise<void>) => {
    try {
      await revoke();
    } catch (err: unknown) {
      showToast((err as Error).message, 'error');
    }
  };

  // Remove os códigos do estado após fechar o modal (por segurança): o refresh
  // atualiza o remaining e remove os códigos. #1434: Close and the overlay both
  // close through here.
  const closeRecoveryCodes = () => {
    setShowRecoveryCodesModal(false);
    refreshData();
  };

  const executeConfirmAction = () => {
    if (confirmAction) {
      confirmAction();
      setShowConfirmModal(false);
      setConfirmAction(null);
    }
  };

  const formatDate = (date: string | Date) => {
    return new Date(date).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getDaysUntilExpiration = (expirationDate: string | Date) => {
    const days = Math.ceil((new Date(expirationDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return days;
  };

  // #1246: the server's passwordRules, not a fixed copy.
  // #1257: an account enrolled in MFA has the shorter MFA floor.
  const passwordRules = rulesForAccount(usePasswordPolicy(), Boolean(mfaStatus?.primaryEnabled));
  // #1249: the reset request is hidden while the policy turns the flow off.
  const allowPasswordReset = usePasswordResetAllowed();
  const passwordIssues = getPasswordIssues(newPassword.new, passwordRules);
  const confirmMismatch = newPassword.new && newPassword.confirm && newPassword.new !== newPassword.confirm;

  if (loading && !securityStatus) {
    return (
      <div className="user-security-page">
        <div className="loading-skeleton">
          <div className="skeleton-header"></div>
          <div className="skeleton-card"></div>
          <div className="skeleton-card"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="user-security-page">
      {/* Cabeçalho */}
      <div className="security-header">
        <div className="header-content">
          <div className="header-icon">
            <Shield size={36} />
          </div>
          <div className="header-text">
            <h1 data-testid="security-page-title">{t('userSecurity.title')}</h1>
            <p>{t('userSecurity.subtitle')}</p>
          </div>
        </div>
        <div className="breadcrumb">
          <span>{t('userSecurity.breadcrumb.settings')}</span>
          <ChevronRight size={14} />
          <span>{t('userSecurity.breadcrumb.security')}</span>
        </div>
      </div>

      {/* Status Geral da Conta */}
      <Card className="security-status-card">
        <div className="status-header">
          <h2>{t('userSecurity.status.title')}</h2>
          <div className={`status-badge status-${securityStatus?.overallLevel || 'weak'}`}>
            {getSecurityLevelLabel(securityStatus?.securityScore || 0)}
          </div>
        </div>
        <div className="security-progress">
          <div className="progress-bar">
            <div 
              className="progress-fill"
              style={{ 
                width: `${securityStatus?.securityScore || 0}%`,
                backgroundColor: getSecurityLevelColor(securityStatus?.securityScore || 0)
              }}
            />
          </div>
          <span className="progress-text">{securityStatus?.securityScore || 0}%</span>
        </div>
        <div className="status-grid">
          <div className="status-item">
            <div className="status-icon">
              {mfaStatus?.primaryEnabled ? (
                <CheckCircle size={20} className="status-success" />
              ) : (
                <XCircle size={20} className="status-danger" />
              )}
            </div>
            <div className="status-info">
              <span className="status-label">{t('userSecurity.status.mfaPrimary')}</span>
              <span className="status-value">
                {mfaStatus?.primaryEnabled ? t('userSecurity.status.active') : t('userSecurity.status.inactive')}
              </span>
            </div>
          </div>
          <div className="status-item">
            <div className="status-icon">
              <Lock size={20} />
            </div>
            <div className="status-info">
              <span className="status-label">{t('userSecurity.status.lastPasswordChange')}</span>
              <span className="status-value">
                {passwordStatus?.lastChanged 
                  ? formatDate(passwordStatus.lastChanged)
                  : t('userSecurity.status.never')}
              </span>
            </div>
          </div>
          <div className="status-item">
            <div className="status-icon">
              <Key size={20} />
            </div>
            <div className="status-info">
              <span className="status-label">{t('userSecurity.status.alternativeMethods')}</span>
              <span className="status-value">
                {securityStatus?.alternativeMethodsCount || 0} {t('userSecurity.status.configured')}
              </span>
            </div>
          </div>
        </div>
        {passwordStatus?.expiresAt && getDaysUntilExpiration(passwordStatus.expiresAt) <= 10 && (
          <div className="status-warning">
            <AlertTriangle size={18} />
            <span>
              {t('userSecurity.status.passwordExpiresIn').replace('{days}', String(getDaysUntilExpiration(passwordStatus.expiresAt)))}
            </span>
          </div>
        )}
      </Card>

      {/* Autenticação Multifator */}
      <div className="security-section">
        <h2 className="section-title">
          <Key size={28} />
          {t('userSecurity.mfa.title')}
        </h2>
        
        {/* MFA Primário */}
        <Card className="mfa-card">
          <div className="mfa-header">
            <div className="mfa-info">
              <div className="mfa-icon">
                <Smartphone size={24} />
              </div>
              <div>
                <h3>{t('userSecurity.mfa.primary.title')}</h3>
                <p className="mfa-description">{t('userSecurity.mfa.primary.description')}</p>
              </div>
            </div>
            <div className={`mfa-status ${mfaStatus?.primaryEnabled ? 'active' : 'inactive'}`}>
              {mfaStatus?.primaryEnabled ? (
                <>
                  <CheckCircle size={18} />
                  <span>{t('userSecurity.mfa.primary.active')}</span>
                </>
              ) : (
                <>
                  <XCircle size={18} />
                  <span>{t('userSecurity.mfa.primary.inactive')}</span>
                </>
              )}
            </div>
          </div>
          {mfaStatus?.primaryEnabled && mfaStatus?.primarySetupDate && (
            <div className="mfa-details">
              <span>{t('userSecurity.mfa.primary.setupDate')}: {formatDate(mfaStatus.primarySetupDate)}</span>
            </div>
          )}
          <div className="mfa-actions">
            {mfaStatus?.primaryEnabled ? (
              <>
                <Button 
                  variant="secondary" 
                  onClick={() => navigate('/security/mfa-setup', { state: { from: '/user/security' } })}
                >
                  <Settings size={18} />
                  {t('userSecurity.mfa.primary.reconfigure')}
                </Button>
                <Button 
                  variant="secondary" 
                  onClick={() => navigate('/security/mfa-setup', { state: { from: '/user/security' } })}
                >
                  <Eye size={18} />
                  {t('userSecurity.mfa.primary.viewSettings')}
                </Button>
              </>
            ) : (
              <Button 
                variant="primary" 
                onClick={() => navigate('/security/mfa-setup', { state: { from: '/user/security' } })}
                className="action-primary"
              >
                <Plus size={18} />
                {t('userSecurity.mfa.primary.activateNow')}
              </Button>
            )}
          </div>
        </Card>

        <Card className="mfa-card">
          <div className="mfa-header">
            <div className="mfa-info">
              <div className="mfa-icon">
                <FileText size={24} />
              </div>
              <div>
                <h3>{t('userSecurity.mfa.alternatives.recovery.title')}</h3>
                <p className="mfa-description">{t('userSecurity.mfa.alternatives.recovery.description')}</p>
                {mfaStatus?.recoveryCodes && (
                  <p className="mfa-value">
                    {t('userSecurity.mfa.alternatives.recovery.remaining').replace('{count}', String(mfaStatus.recoveryCodes.remaining ?? 0))}
                  </p>
                )}
              </div>
            </div>
            <div className={`mfa-status ${
              (mfaStatus?.recoveryCodes?.remaining ?? 0) >= 5 ? 'active' : 
              (mfaStatus?.recoveryCodes?.remaining ?? 0) > 0 ? 'warning' : 'danger'
            }`}>
              {(mfaStatus?.recoveryCodes?.remaining ?? 0) >= 5 ? (
                <>
                  <CheckCircle size={18} />
                  <span>{t('userSecurity.status.secure')}</span>
                </>
              ) : (mfaStatus?.recoveryCodes?.remaining ?? 0) > 0 ? (
                <>
                  <AlertTriangle size={18} />
                  <span>{t('userSecurity.status.needsRenewal')}</span>
                </>
              ) : (
                <>
                  <XCircle size={18} />
                  <span>{t('userSecurity.status.none')}</span>
                </>
              )}
            </div>
          </div>
          <div className="mfa-actions">
            <Button 
              variant="primary" 
              data-testid="generate-recovery-codes-button"
              onClick={async () => {
                try {
                  const codes = await generateRecoveryCodes();
                  if (codes && codes.length > 0) {
                    setShowRecoveryCodesModal(true);
                  } else {
                    showToast(t('userSecurity.mfa.alternatives.recovery.generateError') || 'Erro ao gerar códigos', 'error');
                  }
                } catch (err: any) {
                  showToast(err.message || t('userSecurity.mfa.alternatives.recovery.generateError') || 'Erro ao gerar códigos', 'error');
                }
              }}
            >
              <Plus size={18} />
              {t('userSecurity.mfa.alternatives.recovery.generate')}
            </Button>
            {mfaStatus?.recoveryCodes?.codes && mfaStatus.recoveryCodes.codes.length > 0 && (
              <Button 
                variant="secondary" 
                data-testid="download-recovery-codes-button"
                onClick={() => {
                  if (mfaStatus?.recoveryCodes?.codes) {
                    const blob = new Blob([mfaStatus.recoveryCodes.codes.join('\n')], { type: 'text/plain' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'recovery-codes.txt';
                    a.click();
                    URL.revokeObjectURL(url);
                  }
                }}
              >
                <Download size={18} />
                {t('userSecurity.mfa.alternatives.recovery.download')}
              </Button>
            )}
          </div>
        </Card>
      </div>

      {/* Senha e Credenciais */}
      <Card className="security-section-card" data-testid="sessions-card">
        <div className="section-header">
          <h2>
            <Lock size={24} />
            {t('userSecurity.password.title')}
          </h2>
        </div>
        <div className="password-status">
          <div className="password-info">
            <div className="info-item">
              <span className="info-label">{t('userSecurity.password.lastChange')}</span>
              <span className="info-value">
                {passwordStatus?.lastChanged 
                  ? formatDate(passwordStatus.lastChanged)
                  : t('userSecurity.status.never')}
              </span>
            </div>
            {passwordStatus?.expiresAt && (
              <div className="info-item">
                <span className="info-label">{t('userSecurity.password.expiresIn')}</span>
                <span className={`info-value ${getDaysUntilExpiration(passwordStatus.expiresAt) <= 10 ? 'warning' : ''}`}>
                  {getDaysUntilExpiration(passwordStatus.expiresAt)} {t('userSecurity.password.days')}
                </span>
              </div>
            )}
            <div className="info-item">
              <span className="info-label">{t('userSecurity.password.strength')}</span>
              <div className="strength-indicator">
                <div 
                  className={`strength-bar strength-${passwordStatus?.strength || 'weak'}`}
                  style={{ width: `${(passwordStatus?.strengthScore || 0) * 20}%` }}
                />
              </div>
              <span className="strength-label">
                {passwordStatus?.strength || t('userSecurity.password.strengthWeak')}
              </span>
            </div>
          </div>
          {passwordStatus?.expiresAt && getDaysUntilExpiration(passwordStatus.expiresAt) <= 10 && (
            <div className="password-warning">
              <AlertTriangle size={18} />
              <span>{t('userSecurity.password.expirationWarning')}</span>
            </div>
          )}
          <div className="password-actions">
            <Button variant="primary" data-testid="change-password-button" onClick={() => setShowChangePasswordModal(true)}>
              <Lock size={18} />
              {t('userSecurity.password.change')}
            </Button>
            {allowPasswordReset && (
            <Button 
              variant="secondary" 
              data-testid="request-password-reset-button"
              onClick={() => handleConfirmAction(
                async () => {
                  try {
                    await userSecurityService.requestPasswordReset();
                    showToast(t('userSecurity.password.resetRequestSuccess'), 'success');
                  } catch (err: any) {
                    showToast(err.message || t('userSecurity.password.resetRequestError'), 'error');
                  }
                },
                t('userSecurity.password.resetRequestConfirm')
              )}
            >
              <Key size={18} />
              {t('userSecurity.password.requestReset')}
            </Button>
            )}
          </div>
          <div className="password-policy">
            <p>{t('userSecurity.password.policy')}</p>
          </div>
        </div>
      </Card>

      {/* Sessões e Dispositivos */}
      <Card className="security-section-card">
        <div className="section-header">
            <h2 data-testid="sessions-title">
            <Smartphone size={24} />
            {t('userSecurity.sessions.title')}
          </h2>
          {sessions && sessions.length > 1 && (
            <Button 
              variant="danger" 
              data-testid="revoke-all-sessions-button"
              onClick={() => handleConfirmAction(
                () => revokeOrToast(revokeAllSessions),
                t('userSecurity.sessions.revokeAllConfirm')
              )}
            >
              <LogOut size={18} />
              {t('userSecurity.sessions.revokeAll')}
            </Button>
          )}
        </div>
        <div className="sessions-list" data-testid="sessions-list">
          {sessions && sessions.length > 0 ? (
            sessions.map((session: any, index: number) => (
              <div
                key={session.id}
                className="session-item"
                data-testid="session-item"
                data-session-id={String(session.id || session.sessionID || '')}
                data-session-current={session.isCurrent ? 'true' : 'false'}
              >
                <div className="session-info">
                  <div className="session-device">
                    <Smartphone size={20} />
                    <div>
                      <span className="session-name" data-testid={`session-device-name-${index}`}>{session.deviceName || t('userSecurity.sessions.unknownDevice')}</span>
                      <span className="session-details" data-testid={`session-device-details-${index}`}>
                        {session.browser} • {session.os} • {session.location || t('userSecurity.sessions.unknownLocation')}
                      </span>
                      <span className="sr-only" data-testid={`session-ip-${index}`}>{session.ipAddress || ''}</span>
                    </div>
                  </div>
                  <div className="session-meta">
                    <span className="session-time">{formatDate(session.lastAccess)}</span>
                    {session.isCurrent && (
                      <span className="session-badge current" data-testid="session-current-badge">{t('userSecurity.sessions.current')}</span>
                    )}
                  </div>
                </div>
                {!session.isCurrent && (
                  <Button 
                    variant="danger" 
                    className="btn-small"
                    data-testid={`revoke-session-button-${index}`}
                    onClick={() => handleConfirmAction(
                      () => revokeOrToast(() => revokeSession(session.id)),
                      t('userSecurity.sessions.revokeConfirm')
                    )}
                  >
                    <LogOut size={16} />
                    {t('userSecurity.sessions.revoke')}
                  </Button>
                )}
                {session.isCurrent && (
                  <Button
                    variant="secondary"
                    className="btn-small"
                    data-testid={`logout-current-session-button-${index}`}
                    onClick={() => handleConfirmAction(
                      async () => {
                        await logout();
                      },
                      t('userSecurity.sessions.revokeConfirm')
                    )}
                  >
                    <LogOut size={16} />
                    {t('common.logout') || 'Encerrar Sessão Atual'}
                  </Button>
                )}
              </div>
            ))
          ) : (
            <div className="empty-state">
              <Smartphone size={48} />
              <p>{t('userSecurity.sessions.empty')}</p>
            </div>
          )}
        </div>
      </Card>

      {/* Modals */}
      {/* Change Password Modal */}
      <Modal 
        isOpen={showChangePasswordModal} 
        onClose={() => {
          setShowChangePasswordModal(false);
          setNewPassword({ current: '', new: '', confirm: '' });
          setPasswordError('');
        }}
        title={t('userSecurity.password.change')}
      >
        <div className="modal-content">
          <div className="form-group">
            <label>{t('userSecurity.password.current')}</label>
            <div className="input-with-icon">
              <input
                data-testid="current-password-input"
                type={showPasswords.current ? 'text' : 'password'}
                value={newPassword.current}
                onChange={(e) => setNewPassword({ ...newPassword, current: e.target.value })}
                placeholder={t('userSecurity.password.currentPlaceholder')}
              />
              <Button 
                variant="primary" 
                data-testid="current-password-visibility-toggle"
                className="password-toggle"
                onClick={() => setShowPasswords({ ...showPasswords, current: !showPasswords.current })}
              >
                {showPasswords.current ? <EyeOff size={18} /> : <Eye size={18} />}
              </Button>
            </div>
          </div>
          <div className="form-group">
            <label>{t('userSecurity.password.new')}</label>
            <div className="input-with-icon">
              <input
                data-testid="new-password-input"
                type={showPasswords.new ? 'text' : 'password'}
                value={newPassword.new}
                onChange={(e) => setNewPassword({ ...newPassword, new: e.target.value })}
                placeholder={t('userSecurity.password.newPlaceholder')}
              />
              <Button 
                variant="secondary" 
                data-testid="new-password-visibility-toggle"
                className="password-toggle"
                onClick={() => setShowPasswords({ ...showPasswords, new: !showPasswords.new })}
              >
                {showPasswords.new ? <EyeOff size={18} /> : <Eye size={18} />}
              </Button>
            </div>
          </div>
          <div className="form-group">
            <label>{t('userSecurity.password.confirm')}</label>
            <div className="input-with-icon">
              <input
                data-testid="confirm-password-input"
                type={showPasswords.confirm ? 'text' : 'password'}
                value={newPassword.confirm}
                onChange={(e) => setNewPassword({ ...newPassword, confirm: e.target.value })}
                placeholder={t('userSecurity.password.confirmPlaceholder')}
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPasswords({ ...showPasswords, confirm: !showPasswords.confirm })}
              >
                {showPasswords.confirm ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>
          <div className="password-requirements" style={{ margin: '0.75rem 0' }}>
            <p style={{ fontWeight: 600, marginBottom: '0.5rem' }}>{t('password.requirements.title')}</p>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.35rem' }}>
              {passwordRequirementItems(passwordRules, t).map((item) => {
                const ok = !passwordIssues.includes(item.key as any);
                return (
                  <li key={item.key} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: ok ? 'var(--success)' : 'var(--text)' }}>
                    {ok ? <CheckCircle size={16} /> : <XCircle size={16} color="var(--danger)" />}
                    <span style={{ color: ok ? 'var(--success)' : 'var(--text)' }}>{item.label}</span>
                  </li>
                );
              })}
            </ul>
            {confirmMismatch && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.5rem', color: 'var(--danger)' }}>
                <AlertTriangle size={16} />
                <span>{t('password.mismatch')}</span>
              </div>
            )}
          </div>
          {passwordError && (
            <div className="form-error">
              <AlertTriangle size={18} />
              <span>{passwordError}</span>
            </div>
          )}
          <div className="modal-actions">
            <Button variant="secondary" data-testid="change-password-cancel-button" onClick={() => {
              setShowChangePasswordModal(false);
              setNewPassword({ current: '', new: '', confirm: '' });
              setPasswordError('');
            }}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" data-testid="change-password-submit-button" onClick={handleChangePassword}>
              {t('userSecurity.password.change')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Recovery Codes Modal */}
      <Modal 
        isOpen={showRecoveryCodesModal} 
        onClose={closeRecoveryCodes}
        title={t('userSecurity.mfa.alternatives.recovery.codes')}
      >
        <div className="modal-content" style={{ padding: '1rem' }}>
          <div className="recovery-codes-warning">
            <AlertTriangle size={16} />
            <p>{t('userSecurity.mfa.alternatives.recovery.warning')}</p>
          </div>
          {mfaStatus?.recoveryCodes?.codes && mfaStatus.recoveryCodes.codes.length > 0 ? (
            <div className="recovery-codes-list">
              {mfaStatus.recoveryCodes.codes.map((code: string, idx: number) => (
                <div key={idx} className="recovery-code-item">
                  <code>{code}</code>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state" style={{ padding: '1rem', textAlign: 'center' }}>
              <p style={{ color: 'var(--text-light)', fontSize: '0.875rem', margin: 0 }}>
                {t('userSecurity.mfa.alternatives.recovery.noCodes') || 'Nenhum código disponível. Gere novos códigos.'}
              </p>
            </div>
          )}
          <div className="modal-actions">
            <Button variant="primary" data-testid="close-recovery-codes-button" onClick={closeRecoveryCodes}>
              {t('common.close')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Confirm Action Modal */}
      <Modal 
        isOpen={showConfirmModal} 
        onClose={() => setShowConfirmModal(false)}
        title={t('userSecurity.confirm.title')}
      >
        <div className="modal-content">
          <p>{confirmMessage}</p>
          <div className="modal-actions">
            <Button variant="secondary" data-testid="security-confirm-cancel-button" onClick={() => setShowConfirmModal(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={executeConfirmAction} data-testid="security-confirm-proceed-button">
              {t('userSecurity.confirm.proceed')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

