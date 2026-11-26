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
import logo from '@/LOGO_BIOAVANCED_CORE.png';

export default function LoginPage() {
  // #1250: MFASetupPage returns here after a first-login enrolment whose
  // password an administrator set; the next login asks for the new one.
  const location = useLocation();
  const loginState = (location.state || {}) as { username?: string; notice?: string };
  const [username, setUsername] = useState(loginState.username || '');
  const [password, setPassword] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  // #1331: a saved recovery code, sent in the same field as a TOTP code; the
  // backend tells the two apart by shape (8 characters against 6 digits).
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
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
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8" data-testid="login-page">
      <div className="w-full max-w-md">
        <Card className="shadow-card">
          <div className="mb-6 flex flex-col items-center text-center">
            <img src={logo} alt="" className="mb-3 h-12 w-12 object-contain" />
            <h1 className="text-xl font-semibold text-foreground">{t('app.title')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t('app.subtitle')}</p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4" data-testid="login-form">
            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" data-testid="login-error" role="alert">
                {error}
              </div>
            )}
            {!error && loginState.notice === 'mfaEnrolledPasswordChange' && (
              <div role="status" data-testid="login-notice" className="rounded-md border border-info/30 bg-info/5 px-3 py-2 text-sm text-info">
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
              <div className="flex flex-col gap-3 rounded-md border border-border bg-muted/40 p-3" data-testid="force-password-change-section">
                <p className="text-sm text-muted-foreground" data-testid="force-password-change-reason">
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
              <div className="flex flex-col gap-3 rounded-md border border-border bg-muted/40 p-3" data-testid="two-factor-section">
                {useRecoveryCode ? (
                  <Input
                    key="recovery-code"
                    data-testid="login-recovery-code-input"
                    label={t('auth.recoveryCodeLabel')}
                    type="text"
                    value={twoFactorCode}
                    onChange={(e) => setTwoFactorCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 9))}
                    required
                    autoFocus
                    autoComplete="one-time-code"
                    maxLength={9}
                  />
                ) : (
                  <Input
                    key="totp-code"
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
                )}
                {attemptsRemaining !== undefined && attemptsRemaining > 0 && (
                  <p className="text-xs text-warning">
                    {t('auth.attemptsRemaining')}: {attemptsRemaining}
                  </p>
                )}
                <p className="text-sm text-muted-foreground">
                  {useRecoveryCode ? t('auth.recoveryCodeInfo') : t('auth.twoFactorInfo')}
                </p>
                <button
                  type="button"
                  className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                  data-testid="login-toggle-recovery-code"
                  onClick={() => {
                    setUseRecoveryCode((current) => !current);
                    setTwoFactorCode('');
                  }}
                >
                  {useRecoveryCode ? t('auth.useAuthenticatorCode') : t('auth.useRecoveryCode')}
                </button>
              </div>
            )}

            <Button 
              type="submit" 
              className="w-full"
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
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => setShowForgotPassword(true)}
                  className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                  data-testid="login-forgot-password-button"
                >
                  {t('auth.forgotPassword')}
                </button>
              </div>
            )}
          </form>

          <div className="mt-6 border-t border-border pt-4">
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
        <div className="flex flex-col gap-4" data-testid="forgot-password-modal-content">
          {forgotPasswordError && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <AlertCircle size={16} />
              {forgotPasswordError}
            </div>
          )}
          {!forgotPasswordSuccess ? (
            <>
              <p className="text-sm text-muted-foreground">
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
              <div className="mt-2 flex gap-3">
                <Button
                  data-testid="forgot-password-send-button"
                  onClick={async () => {
                    setForgotPasswordLoading(true);
                    setForgotPasswordError('');
                    try {
                      const response = await authService.requestPasswordReset(forgotPasswordEmail);
                      setForgotPasswordSuccess(true);
                      // Controller wraps payload as { success, message, data: { resetLink, token } }.
                      const payload = response?.data?.data || response?.data || {};
                      // Prefer same-origin link from the token so tunnel/LB port stays correct
                      // even when the API builds resetLink from a stripped X-Forwarded-Host.
                      if (payload.token) {
                        setResetLink(`${window.location.origin}/reset-password?token=${payload.token}`);
                      } else if (payload.resetLink) {
                        setResetLink(payload.resetLink);
                      }
                    } catch (err: any) {
                      const apiError = err.response?.data?.error || err.response?.data?.message;
                      const status = err.response?.status;
                      setForgotPasswordError(
                        apiError
                        || (status ? `${t('auth.passwordResetError', 'Erro ao solicitar recuperação de senha')} (HTTP ${status})` : null)
                        || t('auth.passwordResetError', 'Erro ao solicitar recuperação de senha')
                      );
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
            <div className="flex flex-col items-center text-center">
              <CheckCircle size={40} className="mb-3 text-success" />
              <h3 className="mb-2 text-base font-semibold">{t('auth.resetLinkSentTitle', 'Link de Recuperação Enviado!')}</h3>
              <p className="mb-3 text-sm text-muted-foreground">
                {resetLink ? (
                  <>
                    {t('auth.devResetLinkLabel', 'Em desenvolvimento, o link de recuperação é:')}
                    <div className="mt-3 rounded-md bg-muted p-3 text-left">
                      <Link to={resetLink.replace(window.location.origin, '')} className="break-all text-primary underline-offset-4 hover:underline">
                        {resetLink}
                      </Link>
                    </div>
                    <p className="mt-3 text-xs text-muted-foreground">
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

