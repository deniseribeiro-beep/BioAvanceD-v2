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
  Trash2,
  Edit,
  Plus,
  LogOut,
  Smartphone as PhoneIcon,
  Fingerprint,
  FileText,
  ChevronRight,
  Settings
} from 'lucide-react';
import { useUserSecurity } from '../hooks/useUserSecurity';
import { useToast } from '../components/UI/ToastContainer';
import { userSecurityService } from '../services/api';
import { validatePasswordAndGetError } from '../utils/passwordValidator';
import { getPasswordIssues } from '../utils/passwordRules';
import './UserSecurityPage.css';

export default function UserSecurityPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const {
    securityStatus,
    mfaStatus,
    passwordStatus,
    sessions,
    loading,
    refreshData,
    updateMFA,
    updatePassword,
    updatePhone,
    addPasskey,
    removePasskey,
    generateRecoveryCodes,
    revokeSession,
    revokeAllSessions
  } = useUserSecurity();

  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  const [showAddPhoneModal, setShowAddPhoneModal] = useState(false);
  const [showRecoveryCodesModal, setShowRecoveryCodesModal] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmAction, setConfirmAction] = useState<(() => void) | null>(null);
  const [confirmMessage, setConfirmMessage] = useState('');
  const [newPassword, setNewPassword] = useState({ current: '', new: '', confirm: '' });
  const [newPhone, setNewPhone] = useState('');
  const [showPasswords, setShowPasswords] = useState({ current: false, new: false, confirm: false });
  const [passwordError, setPasswordError] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [addingPasskey, setAddingPasskey] = useState(false);

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
    const passwordError = validatePasswordAndGetError(newPassword.new);
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

  const passwordIssues = getPasswordIssues(newPassword.new);
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
            <h1>{t('userSecurity.title')}</h1>
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

        {/* Métodos Alternativos */}
        <div className="alternative-methods">
          <h3 className="subsection-title">{t('userSecurity.mfa.alternatives.title')}</h3>

          {/* Telefone/SMS */}
          <Card className="mfa-card">
            <div className="mfa-header">
              <div className="mfa-info">
                <div className="mfa-icon">
                  <PhoneIcon size={24} />
                </div>
                <div>
                  <h3>{t('userSecurity.mfa.alternatives.phone.title')}</h3>
                  <p className="mfa-description">{t('userSecurity.mfa.alternatives.phone.description')}</p>
                  {mfaStatus?.phoneNumber && (
                    <p className="mfa-value" style={{ fontSize: '0.875rem', color: 'var(--text)', marginTop: '0.25rem', fontWeight: 500 }}>
                      {mfaStatus.phoneNumber}
                    </p>
                  )}
                  {mfaStatus?.phoneEnabled && !mfaStatus?.phoneNumber && (
                    <p className="mfa-value" style={{ fontSize: '0.875rem', color: 'var(--text-light)', marginTop: '0.25rem', fontStyle: 'italic' }}>
                      {t('userSecurity.mfa.alternatives.phone.numberNotDisplayed') || 'Telefone cadastrado'}
                    </p>
                  )}
                </div>
              </div>
              <div className={`mfa-status ${mfaStatus?.phoneEnabled ? 'active' : 'inactive'}`}>
                {mfaStatus?.phoneEnabled ? (
                  <>
                    <CheckCircle size={18} />
                    <span>{t('userSecurity.status.active')}</span>
                  </>
                ) : (
                  <>
                    <XCircle size={18} />
                    <span>{t('userSecurity.status.notConfigured')}</span>
                  </>
                )}
              </div>
            </div>
            <div className="mfa-actions">
              {mfaStatus?.phoneEnabled ? (
                <>
                  <Button variant="secondary" onClick={() => setShowAddPhoneModal(true)}>
                    <Edit size={18} />
                    {t('userSecurity.mfa.alternatives.phone.change')}
                  </Button>
                  <Button 
                    variant="danger" 
                    onClick={() => handleConfirmAction(
                      async () => {
                        try {
                          await updateMFA('phone', false);
                          showToast(t('userSecurity.mfa.alternatives.phone.removeSuccess') || 'Telefone removido com sucesso', 'success');
                          refreshData();
                        } catch (err: any) {
                          showToast(err.message || t('userSecurity.mfa.alternatives.phone.removeError') || 'Erro ao remover telefone', 'error');
                        }
                      },
                      t('userSecurity.mfa.alternatives.phone.removeConfirm')
                    )}
                  >
                    <Trash2 size={18} />
                    {t('userSecurity.mfa.alternatives.phone.remove')}
                  </Button>
                </>
              ) : (
                <Button variant="primary" onClick={() => setShowAddPhoneModal(true)}>
                  <Plus size={18} />
                  {t('userSecurity.mfa.alternatives.phone.add')}
                </Button>
              )}
            </div>
          </Card>

          {/* Passkey */}
          <Card className="mfa-card">
            <div className="mfa-header">
              <div className="mfa-info">
                <div className="mfa-icon">
                  <Fingerprint size={24} />
                </div>
                <div>
                  <h3>{t('userSecurity.mfa.alternatives.passkey.title')}</h3>
                  <p className="mfa-description">{t('userSecurity.mfa.alternatives.passkey.description')}</p>
                  {mfaStatus?.passkeys && mfaStatus.passkeys.length > 0 && (
                    <div className="passkey-list">
                      {mfaStatus.passkeys.map((pk: any, idx: number) => (
                        <div key={idx} className="passkey-item">
                          <span>{pk.name || pk.deviceName || `${t('userSecurity.mfa.alternatives.passkey.device')} ${idx + 1}`}</span>
                          <Button 
                            variant="danger" 
                            className="btn-small"
                            onClick={() => handleConfirmAction(
                              async () => {
                                try {
                                  await removePasskey(pk.id);
                                  showToast(t('userSecurity.mfa.alternatives.passkey.removeSuccess') || 'Passkey removida com sucesso', 'success');
                                  refreshData();
                                } catch (err: any) {
                                  showToast(err.message || t('userSecurity.mfa.alternatives.passkey.removeError') || 'Erro ao remover passkey', 'error');
                                }
                              },
                              t('userSecurity.mfa.alternatives.passkey.removeConfirm')
                            )}
                          >
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className={`mfa-status ${(mfaStatus?.passkeys?.length ?? 0) > 0 ? 'active' : 'inactive'}`}>
                {(mfaStatus?.passkeys?.length ?? 0) > 0 ? (
                  <>
                    <CheckCircle size={18} />
                    <span>{mfaStatus?.passkeys?.length ?? 0} {t('userSecurity.mfa.alternatives.passkey.configured')}</span>
                  </>
                ) : (
                  <>
                    <XCircle size={18} />
                    <span>{t('userSecurity.status.notConfigured')}</span>
                  </>
                )}
              </div>
            </div>
            <div className="mfa-actions">
              <Button 
                variant="primary" 
                disabled={addingPasskey}
                onClick={async () => {
                  setAddingPasskey(true);
                  try {
                    await addPasskey();
                    showToast(t('userSecurity.mfa.alternatives.passkey.addSuccess') || 'Passkey adicionada com sucesso', 'success');
                  } catch (err: any) {
                    console.error('Erro ao adicionar passkey:', err);
                    const errorMessage = err.message || t('userSecurity.mfa.alternatives.passkey.addError') || 'Erro ao adicionar passkey';
                    showToast(errorMessage, 'error');
                  } finally {
                    setAddingPasskey(false);
                  }
                }}
              >
                <Plus size={18} />
                {addingPasskey ? t('common.loading') || 'Adicionando...' : t('userSecurity.mfa.alternatives.passkey.add')}
              </Button>
            </div>
          </Card>

          {/* Recovery Codes */}
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
                onClick={async () => {
                  try {
                    const codes = await generateRecoveryCodes();
                    // Garante que os códigos estão no estado antes de abrir o modal
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
      </div>

      {/* Senha e Credenciais */}
      <Card className="security-section-card">
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
            <Button variant="primary" onClick={() => setShowChangePasswordModal(true)}>
              <Lock size={18} />
              {t('userSecurity.password.change')}
            </Button>
            <Button 
              variant="secondary" 
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
          </div>
          <div className="password-policy">
            <p>{t('userSecurity.password.policy')}</p>
          </div>
        </div>
      </Card>

      {/* Sessões e Dispositivos */}
      <Card className="security-section-card">
        <div className="section-header">
          <h2>
            <Smartphone size={24} />
            {t('userSecurity.sessions.title')}
          </h2>
          {sessions && sessions.length > 1 && (
            <Button 
              variant="danger" 
              onClick={() => handleConfirmAction(
                () => revokeAllSessions(),
                t('userSecurity.sessions.revokeAllConfirm')
              )}
            >
              <LogOut size={18} />
              {t('userSecurity.sessions.revokeAll')}
            </Button>
          )}
        </div>
        <div className="sessions-list">
          {sessions && sessions.length > 0 ? (
            sessions.map((session: any, idx: number) => (
              <div key={idx} className="session-item">
                <div className="session-info">
                  <div className="session-device">
                    <Smartphone size={20} />
                    <div>
                      <span className="session-name">{session.deviceName || t('userSecurity.sessions.unknownDevice')}</span>
                      <span className="session-details">
                        {session.browser} • {session.os} • {session.location || t('userSecurity.sessions.unknownLocation')}
                      </span>
                    </div>
                  </div>
                  <div className="session-meta">
                    <span className="session-time">{formatDate(session.lastAccess)}</span>
                    {session.isCurrent && (
                      <span className="session-badge current">{t('userSecurity.sessions.current')}</span>
                    )}
                  </div>
                </div>
                {!session.isCurrent && (
                  <Button 
                    variant="danger" 
                    className="btn-small"
                    onClick={() => handleConfirmAction(
                      () => revokeSession(session.id),
                      t('userSecurity.sessions.revokeConfirm')
                    )}
                  >
                    <LogOut size={16} />
                    {t('userSecurity.sessions.revoke')}
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
                type={showPasswords.current ? 'text' : 'password'}
                value={newPassword.current}
                onChange={(e) => setNewPassword({ ...newPassword, current: e.target.value })}
                placeholder={t('userSecurity.password.currentPlaceholder')}
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPasswords({ ...showPasswords, current: !showPasswords.current })}
              >
                {showPasswords.current ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>
          <div className="form-group">
            <label>{t('userSecurity.password.new')}</label>
            <div className="input-with-icon">
              <input
                type={showPasswords.new ? 'text' : 'password'}
                value={newPassword.new}
                onChange={(e) => setNewPassword({ ...newPassword, new: e.target.value })}
                placeholder={t('userSecurity.password.newPlaceholder')}
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPasswords({ ...showPasswords, new: !showPasswords.new })}
              >
                {showPasswords.new ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>
          <div className="form-group">
            <label>{t('userSecurity.password.confirm')}</label>
            <div className="input-with-icon">
              <input
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
              {[{
                key: 'minLength',
                label: t('password.requirements.minLength')
              }, {
                key: 'upper',
                label: t('password.requirements.upper')
              }, {
                key: 'lower',
                label: t('password.requirements.lower')
              }, {
                key: 'number',
                label: t('password.requirements.number')
              }, {
                key: 'symbol',
                label: t('password.requirements.symbol')
              }].map((item) => {
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
            <Button variant="secondary" onClick={() => {
              setShowChangePasswordModal(false);
              setNewPassword({ current: '', new: '', confirm: '' });
              setPasswordError('');
            }}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={handleChangePassword}>
              {t('userSecurity.password.change')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Add Phone Modal */}
      <Modal 
        isOpen={showAddPhoneModal} 
        onClose={() => {
          setShowAddPhoneModal(false);
          setNewPhone('');
          setPhoneError('');
        }}
        title={mfaStatus?.phoneEnabled ? t('userSecurity.mfa.alternatives.phone.change') : t('userSecurity.mfa.alternatives.phone.add')}
      >
        <div className="modal-content">
          <div className="form-group">
            <label>{t('userSecurity.mfa.alternatives.phone.number')}</label>
            <input
              type="tel"
              value={newPhone}
              onChange={(e) => {
                // Aplica máscara de telefone brasileiro
                let value = e.target.value.replace(/\D/g, '');
                if (value.length <= 11) {
                  if (value.length <= 2) {
                    value = value;
                  } else if (value.length <= 7) {
                    value = `(${value.slice(0, 2)}) ${value.slice(2)}`;
                  } else if (value.length <= 10) {
                    value = `(${value.slice(0, 2)}) ${value.slice(2, 6)}-${value.slice(6)}`;
                  } else {
                    value = `(${value.slice(0, 2)}) ${value.slice(2, 7)}-${value.slice(7, 11)}`;
                  }
                  setNewPhone(value);
                }
              }}
              placeholder="(11) 99999-9999"
              maxLength={15}
            />
            <p style={{ fontSize: '0.75rem', color: 'var(--text-light)', marginTop: '0.25rem' }}>
              Formato: (XX) XXXXX-XXXX ou (XX) XXXX-XXXX
            </p>
          </div>
          {phoneError && (
            <div className="form-error" style={{ marginBottom: '1rem' }}>
              <AlertTriangle size={18} />
              <span>{phoneError}</span>
            </div>
          )}
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => {
              setShowAddPhoneModal(false);
              setNewPhone('');
              setPhoneError('');
            }}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={async () => {
              setPhoneError('');
              
              // Valida telefone
              const cleaned = newPhone.replace(/\D/g, '');
              if (cleaned.length < 10 || cleaned.length > 11) {
                setPhoneError('Telefone inválido. Use o formato: (XX) XXXXX-XXXX ou (XX) XXXX-XXXX');
                return;
              }
              
              try {
                await updatePhone(newPhone);
                showToast(t('userSecurity.mfa.alternatives.phone.updateSuccess') || 'Telefone atualizado com sucesso', 'success');
                setShowAddPhoneModal(false);
                setNewPhone('');
                setPhoneError('');
                // Aguarda um pouco antes de atualizar para garantir que o backend processou
                setTimeout(() => {
                  refreshData();
                }, 500);
              } catch (err: any) {
                console.error('Erro ao atualizar telefone:', err);
                const errorMsg = err.message || t('userSecurity.mfa.alternatives.phone.updateError') || 'Erro ao atualizar telefone';
                setPhoneError(errorMsg);
                showToast(errorMsg, 'error');
              }
            }}>
              {mfaStatus?.phoneEnabled ? t('common.save') : t('userSecurity.mfa.alternatives.phone.add')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Recovery Codes Modal */}
      <Modal 
        isOpen={showRecoveryCodesModal} 
        onClose={() => {
          setShowRecoveryCodesModal(false);
          // Remove os códigos do estado após fechar o modal (por segurança)
          // Faz refresh para atualizar o remaining, mas remove os códigos
          refreshData();
        }}
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
            <Button variant="primary" onClick={() => setShowRecoveryCodesModal(false)}>
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
            <Button variant="secondary" onClick={() => setShowConfirmModal(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={executeConfirmAction}>
              {t('userSecurity.confirm.proceed')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

