import { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import Card from '../components/UI/Card';
import Button from '../components/UI/Button';
import Input from '../components/UI/Input';
import Modal from '../components/UI/Modal';
import LanguageSelector from '../components/LanguageSelector';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { authService } from '../services/api';
import { usePasswordResetAllowed } from '../hooks/usePasswordPolicy';
import { getPostLoginRoute } from '../utils/rolePermissions';
import { Mail, CheckCircle, AlertCircle } from 'lucide-react';
import { LIMITS } from '../config/constants/limits.constants';
import { VALIDATION_PATTERNS } from '../config/constants/validation.constants';
import './LoginPage.css';

export default function LoginPage() {
  // #1250: MFASetupPage returns here after a first-login enrolment whose
  // password an administrator set; the next login asks for the new one.
  const location = useLocation();
  const loginState = (location.state || {}) as { username?: string; notice?: string };
  const [username, setUsername] = useState(loginState.username || '');
  const [password, setPassword] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [requiresTwoFactor, setRequiresTwoFactor] = useState(false);
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | undefined>();
  const [requiresPasswordChange, setRequiresPasswordChange] = useState(false);
  const [passwordChangeReason, setPasswordChangeReason] = useState<string | undefined>();
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState('');
  const [forgotPasswordLoading, setForgotPasswordLoading] = useState(false);
  const [forgotPasswordSuccess, setForgotPasswordSuccess] = useState(false);
  const [forgotPasswordError, setForgotPasswordError] = useState('');
  const [resetLink, setResetLink] = useState('');
  // #1249: the forgot-password link shows unless the policy turns the flow off.
  const allowPasswordReset = usePasswordResetAllowed();
  const { login, isAuthenticated, user } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();

  // Se já estiver autenticado, redireciona
  useEffect(() => {
    if (isAuthenticated) {
      navigate(getPostLoginRoute(user?.roleName, user?.accessType));
    }
  }, [isAuthenticated, navigate, user?.roleName, user?.accessType]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (requiresPasswordChange && newPassword !== confirmNewPassword) {
      setError(t('auth.passwordsDoNotMatch'));
      return;
    }

    setLoading(true);

    try {
      // #1252: the code accepted before a required password change rides
      // along with the change, so an enrolled user is not asked for a second.
      const result = await login(
        username,
        password,
        requiresTwoFactor || requiresPasswordChange ? twoFactorCode || undefined : undefined,
        requiresPasswordChange ? newPassword : undefined
      );

      if (result && result.requiresTwoFactorSetup) {
        // Redireciona para página de configuração de MFA
        navigate('/mfa-setup', {
          state: {
            isFirstLogin: true,
            username: username,
            password: password
          }
        });
        setLoading(false);
        return;
      }

      if (result && result.requiresTwoFactor) {
        // During a password change this means the carried code has expired.
        if (requiresPasswordChange) setTwoFactorCode('');
        setRequiresTwoFactor(true);
        setLoading(false);
        return;
      }

      // RF014 AC#4 (#648): admin forçou redefinição de senha -- pede a nova
      // senha inline (mesmo padrão do 2FA acima), sem navegar para outra
      // página, já que username/password já foram validados.
      if (result && result.requiresPasswordChange) {
        setRequiresTwoFactor(false);
        setRequiresPasswordChange(true);
        setPasswordChangeReason(result.passwordChangeReason);
        setLoading(false);
        return;
      }

      // Login bem-sucedido - redireciona por perfil
      const targetRoute = getPostLoginRoute(result?.user?.roleName, result?.user?.accessType);
      navigate(targetRoute, { replace: true });
    } catch (err: any) {
      if (err.requiresTwoFactor) {
        setRequiresTwoFactor(true);
        setAttemptsRemaining(err.attemptsRemaining);
        setError(err.message || t('auth.mfaRequired'));
      } else if (err.response?.data?.code === 'MFA_LOCKED') {
        setError(t('auth.mfaLockedContactAdmin'));
        setRequiresTwoFactor(false);
        setTwoFactorCode('');
      } else {
        const errorMessage = err.response?.data?.error || 
                           err.response?.data?.message || 
                           err.message || 
                           t('auth.loginError');
        setError(errorMessage);
        setRequiresTwoFactor(false);
        setTwoFactorCode('');
        setRequiresPasswordChange(false);
        setNewPassword('');
        setConfirmNewPassword('');

        if (import.meta.env.DEV && !(String(errorMessage).includes('credentials') || String(errorMessage).includes('Credenciais'))) {
          console.warn('Falha inesperada no login:', err);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page" data-testid="login-page">
      <div className="login-container">
        <Card className="login-card">
          <div className="login-header">
            <h1 className="login-title">{t('app.title')}</h1>
            <p className="login-subtitle">{t('app.subtitle')}</p>
          </div>

          <form onSubmit={handleSubmit} className="login-form" data-testid="login-form">
            {error && (
              <div className="error-message" data-testid="login-error">
                {error}
              </div>
            )}
            {!error && loginState.notice === 'mfaEnrolledPasswordChange' && (
              <div role="status" data-testid="login-notice" style={{ marginBottom: '1rem' }}>
                {t('auth.mfaEnrolledPasswordChange')}
              </div>
            )}

            <Input
              data-testid="login-username-input"
              label={t('auth.username')}
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
              placeholder={t('auth.username')}
            />

            <Input
              data-testid="login-password-input"
              label={t('auth.password')}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder={t('auth.password')}
              disabled={requiresTwoFactor || requiresPasswordChange}
            />

            {requiresPasswordChange && (
              <div className="two-factor-section" data-testid="force-password-change-section">
                <p className="two-factor-info" data-testid="force-password-change-reason">
                  {/* #1291: only a forceReset is the administrator's request. */}
                  {passwordChangeReason === 'expired'
                    ? t('auth.passwordChangeRequiredExpired')
                    : passwordChangeReason === 'below_policy'
                      ? t('auth.passwordChangeRequiredBelowPolicy')
                      : t('auth.passwordChangeRequired')}
                </p>
                <Input
                  data-testid="login-new-password-input"
                  label={t('auth.newPassword')}
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  autoFocus
                  placeholder={t('auth.newPassword')}
                />
                <Input
                  data-testid="login-confirm-new-password-input"
                  label={t('auth.confirmPassword')}
                  type="password"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  required
                  placeholder={t('auth.confirmPassword')}
                />
              </div>
            )}

            {requiresTwoFactor && (
              <div className="two-factor-section" data-testid="two-factor-section">
                <Input
                  data-testid="login-mfa-code-input"
                  label={t('auth.twoFactorCode')}
                  type="text"
                  value={twoFactorCode}
                  onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  required
                  placeholder={t('mfa.enterCode')}
                  autoFocus
                  inputMode="numeric"
                  maxLength={LIMITS.MFA_CODE_LENGTH}
                  pattern={VALIDATION_PATTERNS.numericCode6.source}
                />
                {attemptsRemaining !== undefined && attemptsRemaining > 0 && (
                  <p className="attempts-warning">
                    {t('auth.attemptsRemaining')}: {attemptsRemaining}
                  </p>
                )}
                <p className="two-factor-info">
                  {t('auth.twoFactorInfo')}
                </p>
              </div>
            )}

            <Button 
              type="submit" 
              className="login-button"
              data-testid="login-submit-button"
              disabled={loading}
            >
              {loading
                ? t('common.loading')
                : requiresPasswordChange
                ? t('auth.changePasswordAndLogin')
                : requiresTwoFactor
                ? t('mfa.verify')
                : t('auth.login')}
            </Button>

            {allowPasswordReset && (
              <div className="forgot-password-link">
                <button
                  type="button"
                  onClick={() => setShowForgotPassword(true)}
                  className="link-button"
                  data-testid="login-forgot-password-button"
                >
                  {t('auth.forgotPassword')}
                </button>
              </div>
            )}
          </form>

          <div className="login-language-selector">
            <LanguageSelector />
          </div>
        </Card>
      </div>


      {/* Modal de recuperação de senha */}
      <Modal
        data-testid="forgot-password-modal"
        isOpen={showForgotPassword}
        onClose={() => {
          setShowForgotPassword(false);
          setForgotPasswordEmail('');
          setForgotPasswordSuccess(false);
          setForgotPasswordError('');
          setResetLink('');
        }}
        title={t('auth.resetPassword')}
      >
        <div className="forgot-password-modal" data-testid="forgot-password-modal-content">
          {forgotPasswordError && (
            <div className="error-message" style={{ marginBottom: '1rem' }}>
              <AlertCircle size={16} />
              {forgotPasswordError}
            </div>
          )}
          {!forgotPasswordSuccess ? (
            <>
              <p style={{ marginBottom: '1.5rem', color: 'var(--text-secondary)' }}>
                {t('auth.resetPasswordInstructions', 'Digite seu email cadastrado. Enviaremos um link para redefinir sua senha.')}
              </p>
              <Input
                data-testid="forgot-password-email-input"
                label={t('auth.email', 'Email')}
                type="email"
                value={forgotPasswordEmail}
                onChange={(e) => setForgotPasswordEmail(e.target.value)}
                placeholder={t('auth.emailPlaceholder', 'seu@email.com')}
                required
                autoFocus
              />
              <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
                <Button
                  data-testid="forgot-password-send-button"
                  onClick={async () => {
                    if (!forgotPasswordEmail) {
                      setForgotPasswordError(t('auth.enterEmail', 'Digite seu email'));
                      return;
                    }
                    setForgotPasswordLoading(true);
                    setForgotPasswordError('');
                    try {
                      const response = await authService.requestPasswordReset(forgotPasswordEmail);
                      setForgotPasswordSuccess(true);
                      if (response.data.resetLink) {
                        setResetLink(response.data.resetLink);
                      }
                      if (response.data.token) {
                        // Em desenvolvimento, mostra o token
                        setResetLink(`${window.location.origin}/reset-password?token=${response.data.token}`);
                      }
                    } catch (err: any) {
                      setForgotPasswordError(err.response?.data?.error || t('auth.passwordResetError', 'Erro ao solicitar recuperação de senha'));
                    } finally {
                      setForgotPasswordLoading(false);
                    }
                  }}
                  disabled={forgotPasswordLoading || !forgotPasswordEmail}
                >
                  <Mail size={18} />
                  {t('auth.sendResetLink')}
                </Button>
                <Button
                  data-testid="forgot-password-cancel-button"
                  variant="secondary"
                  onClick={() => {
                    setShowForgotPassword(false);
                    setForgotPasswordEmail('');
                  }}
                >
                  {t('common.cancel')}
                </Button>
              </div>
            </>
          ) : (
            <div className="forgot-password-success">
              <CheckCircle size={48} style={{ color: '#28a745', marginBottom: '1rem' }} />
              <h3 style={{ margin: '0 0 1rem 0' }}>{t('auth.resetLinkSentTitle', 'Link de Recuperação Enviado!')}</h3>
              <p style={{ marginBottom: '1rem', color: 'var(--text-secondary)' }}>
                {resetLink ? (
                  <>
                    {t('auth.devResetLinkLabel', 'Em desenvolvimento, o link de recuperação é:')}
                    <div style={{ marginTop: '1rem', padding: '1rem', backgroundColor: '#f8f9fa', borderRadius: '6px' }}>
                      <Link to={resetLink.replace(window.location.origin, '')} style={{ wordBreak: 'break-all', color: 'var(--primary)' }}>
                        {resetLink}
                      </Link>
                    </div>
                    <p style={{ marginTop: '1rem', fontSize: '0.9rem', color: 'var(--text-light)' }}>
                      {t('auth.prodResetLinkNote', 'Em produção, este link seria enviado por email.')}
                    </p>
                  </>
                ) : (
                  t('auth.resetLinkGenericSuccess', 'Se o email existir em nosso sistema, um link de recuperação foi enviado. Verifique sua caixa de entrada.')
                )}
              </p>
              <Button
                data-testid="forgot-password-close-button"
                onClick={() => {
                  setShowForgotPassword(false);
                  setForgotPasswordEmail('');
                  setForgotPasswordSuccess(false);
                  setResetLink('');
                }}
              >
                {t('common.close', 'Fechar')}
              </Button>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}

